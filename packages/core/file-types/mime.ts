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
  'audio/mp4': ['m4a', 'audio'],
  'audio/x-m4a': ['m4a', 'audio'],
  'audio/aac': ['aac', 'audio'],
  'video/x-msvideo': ['avi', 'video'],
  'video/avi': ['avi', 'video'],
  'text/plain': ['txt', 'text'],
  'text/markdown': ['md', 'text'],
  'text/csv': ['csv', 'text'],
  'application/json': ['json', 'text'],
  'text/xml': ['xml', 'text'],
  'application/xml': ['xml', 'text'],
  // Office / OpenDocument: Windows reports these long names while dragging.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx', 'document'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx', 'document'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx', 'document'],
  'application/msword': ['doc', 'document'],
  'application/vnd.ms-excel': ['xls', 'document'],
  'application/vnd.ms-powerpoint': ['ppt', 'document'],
  'application/rtf': ['rtf', 'document'],
  'text/rtf': ['rtf', 'document'],
  'application/vnd.oasis.opendocument.text': ['odt', 'document'],
  'application/vnd.oasis.opendocument.spreadsheet': ['ods', 'document'],
  'application/vnd.oasis.opendocument.presentation': ['odp', 'document'],
  // Archives.
  'application/zip': ['zip', 'archive'],
  'application/x-zip-compressed': ['zip', 'archive'],
  'application/x-7z-compressed': ['7z', 'archive'],
  'application/vnd.rar': ['rar', 'archive'],
  'application/x-rar-compressed': ['rar', 'archive'],
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
