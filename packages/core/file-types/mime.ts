import type { FileInfo, FileKind } from '@shared/types'

const MIME_FORMATS: Record<string, [string, FileKind]> = {
  'image/png': ['png', 'image'],
  'image/jpeg': ['jpeg', 'image'],
  'image/webp': ['webp', 'image'],
  'image/gif': ['gif', 'image'],
  'image/tiff': ['tiff', 'image'],
  'image/bmp': ['bmp', 'image'],
  'image/avif': ['avif', 'image'],
  'image/heic': ['heic', 'image'],
  'image/heif': ['heic', 'image'],
  'application/pdf': ['pdf', 'pdf'],
  'video/mp4': ['mp4', 'video'],
  'video/quicktime': ['mov', 'video'],
  'video/webm': ['webm', 'video'],
  'video/x-matroska': ['mkv', 'video'],
  'audio/mpeg': ['mp3', 'audio'],
  'audio/wav': ['wav', 'audio'],
  'audio/x-wav': ['wav', 'audio'],
  'audio/flac': ['flac', 'audio'],
  'audio/ogg': ['ogg', 'audio'],
  'text/plain': ['txt', 'text'],
}

/**
 * During a drag, browsers expose only each item's MIME type (derived from the extension), not its
 * path or bytes. This builds a *provisional* FileInfo good enough to choose wheel actions. After
 * the drop, main re-inspects the real files by signature and re-validates the chosen action.
 */
export function provisionalFile(mime: string, index: number): FileInfo {
  const [format, kind] = MIME_FORMATS[mime.toLowerCase()] ?? ['unknown', 'unknown' as FileKind]
  return { path: '', name: `item-${index}`, ext: format, size: -1, kind, format, extensionMismatch: false }
}

export interface DragItemLike {
  kind: string
  type: string
}

/** Provisional files for the file items of a DataTransferItemList. */
export function provisionalFiles(items: ArrayLike<DragItemLike>): FileInfo[] {
  const out: FileInfo[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!
    if (it.kind === 'file') out.push(provisionalFile(it.type, i))
  }
  return out
}
