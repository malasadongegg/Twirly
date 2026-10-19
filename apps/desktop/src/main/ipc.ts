import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IPC, imagePreviewSchema, inspectFilesSchema, openEditorSchema, runJobSchema } from '@shared/ipc'
import { settingsPatchSchema } from '@shared/settings'
import type { Diagnostics, ImageMetadata } from '@shared/api'
import sharp from 'sharp'
import { readExif } from '@core/image/exif'
import { ACTIONS_BY_ID } from '@core/actions/definitions'
import { inspectPaths } from '@processing/fs/inspect'
import { loadImage, previewDataUrl, readImageMeta } from '@processing/images/process'
import { toUserFacing } from '@processing/errors'
import { getCapabilities } from './capabilities'
import { ensureLibreOffice } from './libreoffice'
import { JobRunner } from './jobs/runner'
import { createEditorWindow, getEditorContext } from './windows'
import { getSettings, updateSettings } from './settings'
import { getNativeBridgeStatus } from './native/bridge'
import { allowMedia } from './media-protocol'
import { probeMedia } from '@processing/media/ffmpeg'
import { installContextMenu, isContextMenuInstalled, uninstallContextMenu } from './integration/context-menu'

const absolutePaths = (paths: string[]) => {
  for (const p of paths) if (!isAbsolute(p)) throw new Error(`Not an absolute path: ${p}`)
  return paths
}

/** Wrap a handler so payloads are validated and errors cross IPC as plain, user-facing text. */
function handle<S extends z.ZodType, R>(channel: string, schema: S, fn: (payload: z.output<S>, e: IpcMainInvokeEvent) => Promise<R> | R) {
  ipcMain.handle(channel, async (e, raw: unknown) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new Error(`Invalid request on ${channel}`)
    try {
      return await fn(parsed.data, e)
    } catch (err) {
      throw new Error(toUserFacing(err).message, { cause: err })
    }
  })
}

const senderWindow = (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender) ?? undefined

export interface IpcDeps {
  runner: JobRunner
  onWheelDismiss: () => void
  /** Main window close button: hide to tray or quit, per settings. */
  onMainClose: (win: BrowserWindow) => void
}

export function registerIpc({ runner, onWheelDismiss, onMainClose }: IpcDeps): void {
  handle(IPC.inspectFiles, inspectFilesSchema, (paths) => inspectPaths(absolutePaths(paths)))
  handle(IPC.capabilities, z.undefined(), () => getCapabilities({ ffmpegPath: undefined }))
  handle(IPC.diagnostics, z.boolean().optional(), async (refresh): Promise<Diagnostics> => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: `${process.platform} ${process.getSystemVersion()}`,
    capabilities: await getCapabilities({ refresh: refresh ?? false }),
    helper: getNativeBridgeStatus(),
    contextMenuInstalled: await isContextMenuInstalled(),
    settingsPath: app.getPath('userData'),
  }))

  handle(IPC.runJob, runJobSchema, (req, e) => {
    absolutePaths(req.paths)
    return { jobId: runner.start(req, e.sender) }
  })
  handle(IPC.cancelJob, z.string().uuid(), (jobId) => runner.cancel(jobId))

  handle(IPC.openEditor, openEditorSchema, (req) => {
    const action = ACTIONS_BY_ID.get(req.actionId)
    if (!action || action.mode !== 'editor') throw new Error(`Not an editor action: ${req.actionId}`)
    createEditorWindow({ actionId: req.actionId, paths: absolutePaths(req.paths) })
  })
  handle(IPC.editorContext, z.undefined(), (_p, e) => {
    const ctx = getEditorContext(e.sender.id)
    if (!ctx) throw new Error('This window has no editor context')
    return ctx
  })

  handle(IPC.imagePreview, imagePreviewSchema, async ({ path, maxSize }) => {
    absolutePaths([path])
    const input = await loadImage(path)
    const [meta, dataUrl] = await Promise.all([readImageMeta(input), previewDataUrl(input, maxSize)])
    return { dataUrl, ...meta }
  })

  handle(IPC.showInFolder, z.string().min(1), (path) => {
    absolutePaths([path])
    shell.showItemInFolder(path)
  })

  handle(IPC.pickFiles, z.undefined(), async (_p, e) => {
    const win = senderWindow(e)
    const opts: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'] }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? [] : result.filePaths
  })

  handle(IPC.pickDirectory, z.undefined(), async (_p, e) => {
    const win = senderWindow(e)
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC.closeWindow, z.undefined(), (_p, e) => {
    const win = senderWindow(e)
    if (!win) return
    if (win.webContents.getURL().endsWith('/index.html')) onMainClose(win)
    else win.close()
  })
  handle(IPC.minimizeWindow, z.undefined(), (_p, e) => senderWindow(e)?.minimize())

  handle(IPC.settingsGet, z.undefined(), () => getSettings())
  handle(IPC.settingsSet, settingsPatchSchema, (patch) => updateSettings(patch))

  handle(IPC.contextMenu, z.enum(['status', 'install', 'uninstall']), async (action) => {
    if (action === 'install') await installContextMenu()
    if (action === 'uninstall') await uninstallContextMenu()
    return { installed: await isContextMenuInstalled() }
  })
  handle(IPC.installLibreOffice, z.undefined(), () => ensureLibreOffice({ ask: false }))

  handle(IPC.pdfBytes, z.string().min(1), async (path) => {
    absolutePaths([path])
    const { files } = await inspectPaths([path])
    const file = files[0]
    if (!file || file.kind !== 'pdf') throw new Error('Not a PDF file')
    if (file.size > 1024 * 1024 * 1024) throw new Error('The PDF is too large to preview (over 1 GB).')
    return new Uint8Array(await readFile(path))
  })

  handle(IPC.mediaOpen, z.string().min(1), async (path, e) => {
    absolutePaths([path])
    // Only editor windows, and only for the files they were opened with.
    const ctx = getEditorContext(e.sender.id)
    if (!ctx?.paths.includes(path)) throw new Error('This file was not opened in this editor')
    const { files } = await inspectPaths([path])
    const file = files[0]
    if (!file || (file.kind !== 'video' && file.kind !== 'audio')) throw new Error('Not an audio or video file')
    const caps = await getCapabilities()
    if (!caps.ffprobe.path) throw new Error('FFmpeg is not installed')
    return { url: allowMedia(path), info: await probeMedia(caps.ffprobe.path, path) }
  })

  handle(IPC.imageMetadata, z.string().min(1), async (path): Promise<ImageMetadata> => {
    absolutePaths([path])
    const meta = await sharp(await loadImage(path)).metadata()
    return {
      format: meta.format ?? 'unknown',
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      space: meta.space,
      channels: meta.channels,
      hasAlpha: meta.hasAlpha ?? false,
      density: meta.density,
      orientation: meta.orientation,
      iccProfile: !!meta.icc,
      hasExif: !!meta.exif,
      hasXmp: !!meta.xmp,
      hasIptc: !!meta.iptc,
      exif: readExif(meta.exif),
    }
  })

  handle(IPC.wheelDismiss, z.undefined(), () => onWheelDismiss())
}
