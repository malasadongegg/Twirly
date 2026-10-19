import type { FileKind } from '@shared/types'

export interface DetectedFormat {
  format: string
  kind: FileKind
}

/** Bytes needed by `detectFormat`. Read this many from the start of the file. */
export const SIGNATURE_BYTES = 64

const ascii = (bytes: Uint8Array, offset: number, text: string): boolean => {
  if (bytes.length < offset + text.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0): boolean =>
  bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b)

/** ISO-BMFF brand → format. Covers HEIF/AVIF images and MP4-family video/audio. */
function detectIsoBmff(bytes: Uint8Array): DetectedFormat | null {
  if (!ascii(bytes, 4, 'ftyp')) return null
  const brand = String.fromCharCode(...bytes.subarray(8, 12))
  if (brand === 'avif' || brand === 'avis') return { format: 'avif', kind: 'image' }
  if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))
    return { format: 'heic', kind: 'image' }
  if (brand === 'qt  ') return { format: 'mov', kind: 'video' }
  if (brand === 'M4A ' || brand === 'M4B ') return { format: 'm4a', kind: 'audio' }
  return { format: 'mp4', kind: 'video' }
}

/**
 * Identify a file from its leading bytes. Extensions are only a tiebreaker for formats that have
 * no reliable signature (plain text, CSV) or share one (ZIP-based Office files).
 */
export function detectFormat(bytes: Uint8Array, ext: string): DetectedFormat {
  const e = ext.toLowerCase()
  // Zero-filled files (failed copies, broken downloads) look like nothing at all; say so.
  if (bytes.length > 0 && bytes.every((b) => b === 0)) return { format: 'empty', kind: 'unknown' }

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { format: 'png', kind: 'image' }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { format: 'jpeg', kind: 'image' }
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return { format: 'webp', kind: 'image' }
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return { format: 'wav', kind: 'audio' }
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'AVI ')) return { format: 'avi', kind: 'video' }
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return { format: 'gif', kind: 'image' }
  if (ascii(bytes, 0, 'BM') && bytes.length >= 26) return { format: 'bmp', kind: 'image' }
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]))
    return { format: 'tiff', kind: 'image' }
  if (ascii(bytes, 0, '%PDF-')) return { format: 'pdf', kind: 'pdf' }

  const iso = detectIsoBmff(bytes)
  if (iso) return iso

  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    // Matroska and WebM share EBML; the doctype string appears in the header.
    const head = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 64)))
    return head.includes('webm') ? { format: 'webm', kind: 'video' } : { format: 'mkv', kind: 'video' }
  }
  if (ascii(bytes, 0, 'ID3') || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0 && e === 'mp3'))
    return { format: 'mp3', kind: 'audio' }
  if (ascii(bytes, 0, 'fLaC')) return { format: 'flac', kind: 'audio' }
  if (ascii(bytes, 0, 'OggS')) return { format: 'ogg', kind: 'audio' }
  if (startsWith(bytes, [0xff, 0xf1]) || startsWith(bytes, [0xff, 0xf9])) return { format: 'aac', kind: 'audio' }

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(e)) return { format: e, kind: 'document' }
    return { format: 'zip', kind: 'archive' }
  }
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { format: '7z', kind: 'archive' }
  if (ascii(bytes, 0, 'Rar!')) return { format: 'rar', kind: 'archive' }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    if (e === 'doc' || e === 'xls' || e === 'ppt') return { format: e, kind: 'document' }
    return { format: 'ole', kind: 'unknown' }
  }
  if (ascii(bytes, 0, '{\\rtf')) return { format: 'rtf', kind: 'document' }

  if (['txt', 'md', 'markdown', 'csv', 'log', 'json', 'xml', 'yml', 'yaml', 'ini'].includes(e) && looksLikeText(bytes)) return { format: e === 'markdown' ? 'md' : e, kind: 'text' }
  return { format: 'unknown', kind: 'unknown' }
}

function looksLikeText(bytes: Uint8Array): boolean {
  for (const b of bytes) {
    if (b === 0) return false
  }
  return true
}

/** Extensions conventionally used for each detected format; used to flag mismatches. */
const EXTENSIONS: Record<string, string[]> = {
  jpeg: ['jpg', 'jpeg', 'jfif', 'jpe'],
  tiff: ['tif', 'tiff'],
  heic: ['heic', 'heif', 'hif'],
  mp4: ['mp4', 'm4v'],
  mov: ['mov', 'qt'],
  mkv: ['mkv'],
  m4a: ['m4a', 'm4b', 'mp4'],
}

export function extensionMatches(format: string, ext: string): boolean {
  if (format === 'unknown') return true
  return (EXTENSIONS[format] ?? [format]).includes(ext.toLowerCase())
}
