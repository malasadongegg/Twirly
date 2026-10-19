import type { EditorContext, OpenEditorRequest, RunJobRequest, WheelShowPayload } from './ipc'
import type { Settings, SettingsPatch } from './settings'
import type { Capabilities, ExifSummary, InspectResult, JobProgress, MediaInfo } from './types'

export interface ImagePreview {
  dataUrl: string
  /** Full-resolution dimensions after EXIF orientation. */
  width: number
  height: number
  hasAlpha: boolean
  format: string
}

export interface ImageMetadata {
  format: string
  width: number
  height: number
  space?: string
  channels?: number
  hasAlpha: boolean
  density?: number
  orientation?: number
  iccProfile: boolean
  hasExif: boolean
  hasXmp: boolean
  hasIptc: boolean
  exif: ExifSummary
}

export type WheelShowEvent = WheelShowPayload & { cursor: { x: number; y: number } }

export type PdfWorkerRequest =
  | { reqId: number; op: 'open'; bytes: Uint8Array }
  | { reqId: number; op: 'render'; docId: number; page: number; dpi: number; maxPixels: number }
  | { reqId: number; op: 'text'; docId: number; page: number }
  | { reqId: number; op: 'layout'; docId: number; page: number }
  | { reqId: number; op: 'close'; docId: number }

export type PdfWorkerResponse = { reqId: number; ok: true; result: unknown } | { reqId: number; ok: false; error: string }

export interface Diagnostics {
  version: string
  electron: string
  platform: string
  capabilities: Capabilities
  helper: { state: string; detail?: string }
  contextMenuInstalled: boolean
  settingsPath: string
}

/** The only surface the renderer has onto the system. Exposed as `window.twirly`. */
export interface TwirlyApi {
  /** Real filesystem path of a File from a drop event (Electron webUtils). */
  pathForFile(file: File): string
  inspect(paths: string[]): Promise<InspectResult>
  capabilities(): Promise<Capabilities>
  diagnostics(refresh?: boolean): Promise<Diagnostics>
  runJob(req: RunJobRequest): Promise<{ jobId: string }>
  cancelJob(jobId: string): Promise<void>
  onJobProgress(cb: (p: JobProgress) => void): () => void
  openEditor(req: OpenEditorRequest): Promise<void>
  editorContext(): Promise<EditorContext>
  imagePreview(path: string, maxSize: number): Promise<ImagePreview>
  /** The automatic background-removal mask at preview size: PNG data URL, alpha = subject. */
  removeBgMask(path: string, maxSize: number): Promise<string>
  showInFolder(path: string): Promise<void>
  pickFiles(): Promise<string[]>
  pickDirectory(): Promise<string | null>
  closeWindow(): Promise<void>
  minimizeWindow(): Promise<void>
  settings: {
    get(): Promise<Settings>
    set(patch: SettingsPatch): Promise<Settings>
    onChange(cb: (s: Settings) => void): () => void
  }
  contextMenu(action: 'status' | 'install' | 'uninstall'): Promise<{ installed: boolean }>
  /** Install LibreOffice via winget (for Office → PDF when Microsoft Office is missing). */
  installLibreOffice(): Promise<void>
  /** Raw bytes of a PDF the user opened (signature-checked in main). */
  pdfBytes(path: string): Promise<Uint8Array>
  /** Probe a media file and get a playable URL for it (editor windows only). */
  mediaOpen(path: string): Promise<{ url: string; info: MediaInfo }>
  imageMetadata(path: string): Promise<ImageMetadata>
  /** Only meaningful in the hidden PDF render window; main ignores responses from elsewhere. */
  pdfWorker: {
    onRequest(cb: (req: PdfWorkerRequest) => void): () => void
    respond(res: PdfWorkerResponse): void
  }
  wheel: {
    onShow(cb: (e: WheelShowEvent) => void): () => void
    onHide(cb: () => void): () => void
    onDragState(cb: (s: { buttonDown: boolean }) => void): () => void
    /** Right-click mid-drag (reported by the helper). */
    onCancel(cb: () => void): () => void
    dismiss(): Promise<void>
  }
}
