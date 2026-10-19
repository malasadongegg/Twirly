import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { IPC } from '@shared/ipc'
import type { Settings } from '@shared/settings'
import { applySecurityPolicy } from './security'
import { registerIpc } from './ipc'
import { JobRunner } from './jobs/runner'
import { createMainWindow, createWheelWindow, showWheel } from './windows'
import { getCapabilities } from './capabilities'
import { setHelperConfig, startNativeBridge } from './native/bridge'
import { spikeLog } from './spike-log'
import { getSettings, onSettingsChanged } from './settings'
import { handleMediaScheme, registerMediaScheme } from './media-protocol'

/** `Twirly.exe --files "C:\a.png" "C:\b.png"` (used by the Explorer context-menu verb). */
export function parseFilesArg(argv: string[]): string[] {
  const i = argv.indexOf('--files')
  return i === -1 ? [] : argv.slice(i + 1).filter((a) => !a.startsWith('--'))
}

/**
 * Distinct identity, set before anything touches userData or the single-instance lock.
 * "Obsidian" alone would collide with the Obsidian note-taking app's %APPDATA%\obsidian folder.
 * TWIRLY_USER_DATA isolates test runs.
 */
export const APP_NAME = 'Twirly'
app.setName(APP_NAME)
app.setPath('userData', process.env.TWIRLY_USER_DATA || join(app.getPath('appData'), APP_NAME))

registerMediaScheme()

const assetPath = (name: string) => (app.isPackaged ? join(process.resourcesPath, 'assets', name) : join(__dirname, '..', '..', 'assets', name))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let wheelWindow: BrowserWindow | null = null
  let tray: Tray | null = null
  let quitting = false
  const runner = new JobRunner()

  const showMain = () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  const hideWheel = () => {
    if (wheelWindow && !wheelWindow.isDestroyed() && wheelWindow.isVisible()) {
      wheelWindow.webContents.send(IPC.wheelHide)
      wheelWindow.hide()
    }
  }

  const openWheelWithFiles = (paths: string[]) => {
    if (!wheelWindow || paths.length === 0) return
    showWheel(wheelWindow, { paths, source: 'context-menu' }, { focus: true })
    spikeLog('wheel-shown-with-files', { paths, bounds: wheelWindow.getBounds() })
  }

  // Explorer launches the verb once per selected file; collect them into one wheel.
  let pendingFiles: string[] = []
  let pendingTimer: ReturnType<typeof setTimeout> | undefined
  const queueFiles = (files: string[]) => {
    pendingFiles.push(...files)
    clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => {
      const batch = [...new Set(pendingFiles)]
      pendingFiles = []
      openWheelWithFiles(batch)
    }, 350)
  }

  const applyTray = (s: Settings) => {
    if (s.tray.enabled && !tray) {
      tray = new Tray(nativeImage.createFromPath(assetPath('tray.png')))
      tray.setToolTip('Twirly')
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Open Twirly', click: showMain },
          { type: 'separator' },
          {
            label: 'Quit',
            click: () => {
              quitting = true
              app.quit()
            },
          },
        ]),
      )
      tray.on('click', showMain)
    } else if (!s.tray.enabled && tray) {
      tray.destroy()
      tray = null
    }
  }

  const applyLoginItem = (s: Settings) => {
    if (!app.isPackaged) return // registering electron.exe itself at login would be wrong in dev
    app.setLoginItemSettings({ openAtLogin: s.startup.launchAtLogin, args: s.startup.startHidden ? ['--hidden'] : [] })
  }

  app.on('second-instance', (_e, argv) => {
    const files = parseFilesArg(argv)
    spikeLog('second-instance', { files })
    if (files.length) queueFiles(files)
    else showMain()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('dev.twirly.app')
    applySecurityPolicy()
    handleMediaScheme()
    const settings = getSettings()

    registerIpc({
      runner,
      onWheelDismiss: hideWheel,
      onMainClose: (win) => {
        const s = getSettings()
        if (s.tray.enabled && s.tray.closeToTray && !quitting) win.hide()
        else app.quit()
      },
    })

    const startHidden = process.argv.includes('--hidden') && settings.tray.enabled
    mainWindow = createMainWindow({ show: !startHidden })
    runner.observe(mainWindow.webContents)
    mainWindow.on('closed', () => {
      mainWindow = null
      app.quit()
    })

    wheelWindow = createWheelWindow()
    void getCapabilities() // warm the cache so the first wheel is instant

    applyTray(settings)
    applyLoginItem(settings)

    // Drag-summon: the native helper reports "Shift pressed during a mouse drag".
    startNativeBridge(
      {
        onSummon: () => {
          // Always (re)open: a wheel left on screen (e.g. an unnoticed error) must never block new summons.
          if (!wheelWindow) return
          showWheel(wheelWindow, { paths: [], source: 'drag-summon' }, { focus: false })
          spikeLog('wheel-shown', { bounds: wheelWindow.getBounds() })
        },
        onMouseUp: () => wheelWindow?.webContents.send(IPC.wheelDragState, { buttonDown: false }),
      },
      settings.dragSummon,
    )

    onSettingsChanged((s, prev) => {
      if (JSON.stringify(s.dragSummon) !== JSON.stringify(prev.dragSummon)) setHelperConfig(s.dragSummon)
      if (s.tray.enabled !== prev.tray.enabled) applyTray(s)
      if (s.startup.launchAtLogin !== prev.startup.launchAtLogin || s.startup.startHidden !== prev.startup.startHidden) applyLoginItem(s)
    })

    const initialFiles = parseFilesArg(process.argv)
    if (initialFiles.length) wheelWindow.webContents.once('did-finish-load', () => queueFiles(initialFiles))
  })

  app.on('before-quit', () => {
    quitting = true
  })
  app.on('window-all-closed', () => app.quit())
}
