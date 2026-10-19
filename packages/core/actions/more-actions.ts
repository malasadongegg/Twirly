import type { Capabilities, FileKind } from '@shared/types'
import type { ActionDefinition } from './types'

/** Every kind, including folders and files Twirly can't otherwise process. */
const ANY: FileKind[] = ['image', 'pdf', 'video', 'audio', 'document', 'text', 'archive', 'folder', 'unknown']
const ANY_FILE: FileKind[] = ANY.filter((k) => k !== 'folder')

const OFFICE_WORD = ['docx', 'doc', 'rtf', 'odt']
const OFFICE_EXCEL = ['xlsx', 'xls', 'ods']
const OFFICE_POWERPOINT = ['pptx', 'ppt', 'odp']

/** Can this machine turn this document into a PDF (installed Office app, else LibreOffice)? */
export function officeEngineFor(format: string, caps: Capabilities): 'word' | 'excel' | 'powerpoint' | 'libreoffice' | null {
  if (OFFICE_WORD.includes(format) && caps.office.word) return 'word'
  if (OFFICE_EXCEL.includes(format) && caps.office.excel) return 'excel'
  if (OFFICE_POWERPOINT.includes(format) && caps.office.powerpoint) return 'powerpoint'
  if ([...OFFICE_WORD, ...OFFICE_EXCEL, ...OFFICE_POWERPOINT].includes(format) && caps.libreoffice.available) return 'libreoffice'
  return null
}

const needsFfmpeg = (caps: Capabilities) =>
  !caps.ffmpeg.available || !caps.ffprobe.available ? 'FFmpeg is not installed' : !['libx264', 'aac'].every((e) => caps.ffmpeg.encoders.includes(e)) ? 'FFmpeg lacks libx264/aac' : null

export const MORE_ACTIONS: ActionDefinition[] = [
  // ----- anything -----
  { id: 'file.copy-path', label: 'COPY PATH', title: 'Copy path', icon: 'clipboard', kinds: ANY, minFiles: 1, maxFiles: 500, mode: 'instant', aggregate: true, suffix: '' },
  { id: 'file.zip', label: 'ZIP', title: 'Compress to ZIP', icon: 'archive', kinds: ANY, minFiles: 1, maxFiles: 500, mode: 'instant', aggregate: true, suffix: '' },
  { id: 'file.checksum', label: 'SHA-256', title: 'Copy SHA-256 checksum', icon: 'fingerprint', kinds: ANY_FILE, minFiles: 1, maxFiles: 50, mode: 'instant', aggregate: true, suffix: '' },

  // ----- archives -----
  { id: 'archive.extract', label: 'EXTRACT', title: 'Extract here', icon: 'folder-open', kinds: ['archive'], formats: ['zip'], minFiles: 1, maxFiles: 20, mode: 'instant', suffix: '' },

  // ----- folders -----
  { id: 'folder.images-to-pdf', label: 'PDF', title: 'Folder images to PDF', icon: 'file-output', kinds: ['folder'], minFiles: 1, maxFiles: 20, mode: 'instant', suffix: '' },

  // ----- documents -----
  {
    id: 'document.to-pdf',
    label: 'PDF',
    title: 'Convert to PDF',
    icon: 'file-output',
    kinds: ['document'],
    formats: [...OFFICE_WORD, ...OFFICE_EXCEL, ...OFFICE_POWERPOINT],
    // Always shown: without Office or LibreOffice the handler offers to install LibreOffice.
    minFiles: 1,
    maxFiles: 50,
    mode: 'instant',
    suffix: '',
  },
  { id: 'document.extract-images', label: 'IMAGES', title: 'Extract images', icon: 'images', kinds: ['document'], formats: ['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'], minFiles: 1, maxFiles: 50, mode: 'instant', suffix: 'images' },

  // ----- PDF -----
  { id: 'pdf.extract-images', label: 'IMAGES', title: 'Extract images', icon: 'images', kinds: ['pdf'], minFiles: 1, maxFiles: 50, mode: 'instant', suffix: 'images' },

  // ----- text -----
  { id: 'text.to-pdf', label: 'PDF', title: 'Text to PDF', icon: 'file-output', kinds: ['text'], minFiles: 1, maxFiles: 100, mode: 'instant', suffix: '' },
  { id: 'text.to-docx', label: 'DOCX', title: 'Text to Word (DOCX)', icon: 'file-type', kinds: ['text'], minFiles: 1, maxFiles: 100, mode: 'instant', suffix: '' },
  { id: 'text.combine', label: 'COMBINE', title: 'Combine text files', icon: 'file-stack', kinds: ['text'], minFiles: 2, maxFiles: 500, mode: 'instant', aggregate: true, suffix: 'combined' },

  // ----- video sharing presets -----
  { id: 'video.fit-25mb', label: '25 MB', title: 'Shrink for Messenger (25 MB)', icon: 'send', kinds: ['video'], minFiles: 1, maxFiles: 20, mode: 'instant', unavailableReason: needsFfmpeg, suffix: '25mb' },
  { id: 'video.fit-10mb', label: '10 MB', title: 'Shrink for Discord (10 MB)', icon: 'send', kinds: ['video'], minFiles: 1, maxFiles: 20, mode: 'instant', unavailableReason: needsFfmpeg, suffix: '10mb' },
]

/** Wheel order for the new kinds. Generic actions also trail every other kind's list. */
export const MORE_ORDERS: Record<string, string[]> = {
  folder: ['file.zip', 'folder.images-to-pdf', 'file.copy-path'],
  archive: ['archive.extract', 'file.copy-path', 'file.checksum', 'file.zip'],
  document: ['document.to-pdf', 'document.extract-images', 'file.zip', 'file.copy-path', 'file.checksum'],
  text: ['text.to-pdf', 'text.to-docx', 'text.combine', 'file.zip', 'file.copy-path', 'file.checksum'],
  unknown: ['file.zip', 'file.copy-path', 'file.checksum'],
}
