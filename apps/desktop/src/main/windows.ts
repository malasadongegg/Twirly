import { join } from 'node:path'
import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { placeWheel } from '@core/wheel/geometry'
import type { EditorContext, WheelShowPayload } from '@shared/ipc'
import { IPC } from '@shared/ipc'

export const WHEEL_WINDOW_SIZE = 360
const BG = '#0B0F14'

const preload = join(__dirname, '../preload/index.js')

function secureWebPreferences(): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
  }
}

function load(win: BrowserWindow, page: 'index' | 'wheel' | 'editor', query?: Record<string, string>): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(`${devUrl}/${page}.html`)
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`), { query })
  }
}

export function createMainWindow(opts: { show?: boolean } = {}): BrowserWindow {
  const win = new BrowserWindow({
    width: 440,
    height: 560,
    minWidth: 380,
    minHeight: 480,
    show: false,
    frame: false,
    backgroundColor: BG,
    title: 'Twirly',
    webPreferences: secureWebPreferences(),
  })
  win.once('ready-to-show', () => opts.show !== false && win.show())
  load(win, 'index')
  return win
}

/**
 * The wheel window is created once at startup and kept hidden, so summoning it costs a
 * reposition + show, not a window creation. It is frameless, transparent and never activates,
 * so it cannot steal focus from Explorer mid-drag.
 */
export function createWheelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WHEEL_WINDOW_SIZE,
    height: WHEEL_WINDOW_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    title: 'Twirly wheel',
    webPreferences: secureWebPreferences(),
  })
  win.setAlwaysOnTop(true, 'pop-up-menu')
  load(win, 'wheel')
  return win
}

/** Position the wheel centered on the cursor (clamped to the work area) and show it. */
export function showWheel(win: BrowserWindow, payload: WheelShowPayload, opts: { focus: boolean }): void {
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const pos = placeWheel(cursor, WHEEL_WINDOW_SIZE, workArea, 0)
  win.setBounds({ x: pos.x, y: pos.y, width: WHEEL_WINDOW_SIZE, height: WHEEL_WINDOW_SIZE })
  win.setFocusable(opts.focus)
  win.webContents.send(IPC.wheelShow, { ...payload, cursor: { x: cursor.x - pos.x, y: cursor.y - pos.y } })
  if (opts.focus) {
    win.show()
    win.focus()
  } else {
    win.showInactive()
  }
  raiseToTop(win)
}

/**
 * Put the wheel above everything, now and again shortly after. A drag in progress belongs to
 * another app's drag loop, and the wheel was seen landing behind Explorer despite its topmost
 * flag; re-asserting topmost and the z-order costs nothing.
 */
function raiseToTop(win: BrowserWindow): void {
  const raise = () => {
    if (win.isDestroyed() || !win.isVisible()) return
    win.setAlwaysOnTop(true, 'pop-up-menu')
    win.moveTop()
  }
  raise()
  for (const ms of [60, 250]) setTimeout(raise, ms)
}

const editorContexts = new Map<number, EditorContext>()

export function getEditorContext(webContentsId: number): EditorContext | undefined {
  return editorContexts.get(webContentsId)
}

export function createEditorWindow(ctx: EditorContext): BrowserWindow {
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const width = 520
  const height = 680
  const x = Math.min(Math.max(cursor.x - width / 2, workArea.x + 12), workArea.x + workArea.width - width - 12)
  const y = Math.min(Math.max(cursor.y - height / 2, workArea.y + 12), workArea.y + workArea.height - height - 12)
  const win = new BrowserWindow({
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
    minWidth: 420,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: BG,
    alwaysOnTop: true,
    title: 'Twirly editor',
    webPreferences: secureWebPreferences(),
  })
  const id = win.webContents.id
  editorContexts.set(id, ctx)
  win.on('closed', () => editorContexts.delete(id))
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  load(win, 'editor')
  return win
}
