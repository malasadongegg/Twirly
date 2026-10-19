export type FileKind = 'image' | 'pdf' | 'video' | 'audio' | 'document' | 'text' | 'archive' | 'folder' | 'unknown'

/** A file Twirly has inspected in the main process. */
export interface FileInfo {
  path: string
  name: string
  /** Lowercase extension without the dot ('' when none). */
  ext: string
  size: number
  kind: FileKind
  /** Detected container/format id, e.g. 'png', 'jpeg', 'pdf', 'mp4'. 'unknown' when undetected. */
  format: string
  /** True when the extension disagrees with the detected signature. */
  extensionMismatch: boolean
}

export interface FileRejection {
  path: string
  reason: string
}

export interface InspectResult {
  files: FileInfo[]
  rejected: FileRejection[]
}

/** Runtime capabilities detected on this machine. Actions declare which they need. */
export interface Capabilities {
  /** Image formats sharp can decode / encode, by format id. */
  imageInput: string[]
  imageOutput: string[]
  ffmpeg: { available: boolean; path?: string; version?: string; encoders: string[] }
  ffprobe: { available: boolean; path?: string }
  libreoffice: { available: boolean; path?: string }
  /** Microsoft Office apps registered for automation (used for Office → PDF). */
  office: { word: boolean; excel: boolean; powerpoint: boolean }
  /** The bundled background-removal model is present. */
  removeBg: boolean
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface JobProgress {
  jobId: string
  actionId: string
  title: string
  status: JobStatus
  /** Files finished so far / total. */
  completed: number
  total: number
  /** 0..1 within the current file, or null when indeterminate. */
  fraction: number | null
  outputs: string[]
  /** Replaces "n of m saved" when the job's result is not files (e.g. "Path copied"). */
  message?: string
  error?: { message: string; detail?: string }
}

/** What ffprobe told us about the input (subset). */
export interface MediaInfo {
  durationSec: number
  formatName: string
  sizeBytes: number
  bitRate: number | null
  video?: { codec: string; width: number; height: number; fps: number | null }
  audio?: { codec: string; sampleRate: number | null; channels: number | null; bitRate: number | null }
}

export interface ExifField {
  group: 'Camera' | 'Image' | 'Exposure' | 'Location' | 'Author'
  label: string
  value: string
}

export interface ExifSummary {
  fields: ExifField[]
  gps?: { lat: number; lon: number; altitude?: number }
}
