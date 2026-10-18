import { join } from 'node:path'
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import { IPC } from '@shared/channels'
import type { PdfWorkerRequest, PdfWorkerResponse } from '@shared/api'
import { UserFacingError } from '@processing/errors'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
type RequestBody = PdfWorkerRequest extends infer R ? (R extends { reqId: number } ? Omit<R, 'reqId'> : never) : never

const IDLE_MS = 90_000
const TIMEOUT_MS = 120_000

let win: BrowserWindow | null = null
let ready: Promise<void> | null = null
let idleTimer: ReturnType<typeof setTimeout> | undefined
let nextReq = 1
const pending = new Map<number, Pending>()

function onResponse(e: IpcMainEvent, res: PdfWorkerResponse) {
  // Only the render window may answer.
  if (!win || e.sender.id !== win.webContents.id) return
  const p = pending.get(res?.reqId)
  if (!p) return
  pending.delete(res.reqId)
  clearTimeout(p.timer)
  if (res.ok) p.resolve(res.result)
  else p.reject(new UserFacingError('The PDF could not be read. It may be damaged or encrypted.', res.error))
}
ipcMain.on(IPC.pdfWorkerResponse, onResponse)

function ensureWindow(): Promise<void> {
  if (win && !win.isDestroyed() && ready) return ready
  win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  win.on('closed', () => {
    win = null
    ready = null
    for (const [id, p] of pending) {
      clearTimeout(p.timer)
      p.reject(new UserFacingError('The PDF renderer stopped unexpectedly.'))
      pending.delete(id)
    }
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  ready = (devUrl ? win.loadURL(`${devUrl}/pdf-worker.html`) : win.loadFile(join(__dirname, '../renderer/pdf-worker.html'))).then(() => undefined)
  return ready
}

function scheduleIdleClose() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (pending.size === 0) win?.destroy()
  }, IDLE_MS)
}

export async function pdfWorker<T>(body: RequestBody): Promise<T> {
  await ensureWindow()
  clearTimeout(idleTimer)
  const reqId = nextReq++
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId)
      reject(new UserFacingError('Rendering the PDF took too long.'))
    }, TIMEOUT_MS)
    pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, timer })
    win!.webContents.send(IPC.pdfWorkerRequest, { ...body, reqId })
  }).finally(scheduleIdleClose)
}

/** Convenience wrapper: open, use, always close. */
export async function withPdf<T>(bytes: Uint8Array, fn: (doc: { docId: number; pageCount: number }) => Promise<T>): Promise<T> {
  const doc = await pdfWorker<{ docId: number; pageCount: number }>({ op: 'open', bytes })
  try {
    return await fn(doc)
  } finally {
    await pdfWorker({ op: 'close', docId: doc.docId }).catch(() => undefined)
  }
}
