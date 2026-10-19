import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Capabilities } from '@shared/types'
import { configureHeicDecoder, detectImageInputs, detectImageOutputs } from '@processing/images/process'

const run = promisify(execFile)

async function probe(command: string, args: string[]): Promise<string | null> {
  try {
    // execFile never goes through a shell, so nothing here is interpolated.
    const { stdout } = await run(command, args, { timeout: 5000, windowsHide: true })
    return stdout
  } catch {
    return null
  }
}

async function detectFfmpeg(path: string): Promise<Capabilities['ffmpeg']> {
  const version = await probe(path, ['-hide_banner', '-version'])
  if (!version) return { available: false, encoders: [] }
  const encList = (await probe(path, ['-hide_banner', '-encoders'])) ?? ''
  const encoders = [...encList.matchAll(/^\s[VAS][\w.]{5}\s+(\S+)/gm)].map((m) => m[1]!)
  return { available: true, path, version: /ffmpeg version (\S+)/.exec(version)?.[1], encoders }
}

const LIBREOFFICE_DEFAULT = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'

/** Office apps registered for COM automation (registry only: nothing is launched). */
async function detectOffice(): Promise<Capabilities['office']> {
  if (process.platform !== 'win32') return { word: false, excel: false, powerpoint: false }
  const has = async (progId: string) => (await probe('reg.exe', ['query', `HKCR\\${progId}\\CLSID`])) !== null
  const [word, excel, powerpoint] = await Promise.all([has('Word.Application'), has('Excel.Application'), has('PowerPoint.Application')])
  return { word, excel, powerpoint }
}

/**
 * FFmpeg shipped with the app (resources/ffmpeg in the installer, vendor/ffmpeg in dev), so video,
 * audio and HEIC work out of the box. Falls back to an FFmpeg on PATH.
 */
function bundledFfmpeg(): string | null {
  // process.resourcesPath is only set by Electron; the dev bundle lives in <repo>/out/main.
  const candidates = [process.resourcesPath && join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'), join(__dirname, '..', '..', 'vendor', 'ffmpeg', 'ffmpeg.exe')]
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null
}

let cached: Promise<Capabilities> | null = null

/** Detect once per session; `refresh` re-runs detection (Settings → Diagnostics). */
export function getCapabilities(opts: { ffmpegPath?: string; refresh?: boolean } = {}): Promise<Capabilities> {
  if (cached && !opts.refresh) return cached
  cached = (async () => {
    const ffmpegCmd = opts.ffmpegPath || bundledFfmpeg() || 'ffmpeg'
    const ffprobeCmd = ffmpegCmd.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1')
    const [ffmpeg, ffprobeOut, soffice] = await Promise.all([
      detectFfmpeg(ffmpegCmd),
      probe(ffprobeCmd, ['-hide_banner', '-version']),
      probe('soffice', ['--version']),
    ])
    // HEIC through FFmpeg when it can decode HEVC.
    const decoders = ffmpeg.available ? ((await probe(ffmpegCmd, ['-hide_banner', '-decoders'])) ?? '') : ''
    const heic = /^\s*V\S*\s+hevc\s/m.test(decoders)
    configureHeicDecoder(heic ? ffmpegCmd : null)
    // E2E: pretend this PC has neither Office nor LibreOffice (exercises the install offer).
    const noOffice = process.env.TWIRLY_TEST_NO_OFFICE === '1'
    return {
      imageInput: [...detectImageInputs(), ...(heic ? ['heic'] : [])],
      imageOutput: detectImageOutputs(),
      ffmpeg,
      ffprobe: { available: ffprobeOut !== null, path: ffprobeOut !== null ? ffprobeCmd : undefined },
      libreoffice: noOffice ? { available: false } : { available: soffice !== null || existsSync(LIBREOFFICE_DEFAULT), path: soffice !== null ? 'soffice' : existsSync(LIBREOFFICE_DEFAULT) ? LIBREOFFICE_DEFAULT : undefined },
      office: noOffice ? { word: false, excel: false, powerpoint: false } : await detectOffice(),
    }
  })()
  return cached
}
