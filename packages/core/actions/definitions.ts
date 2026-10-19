import type { Capabilities } from '@shared/types'
import type { ActionDefinition } from './types'
import { IMAGE_OUTPUTS } from './image-formats'
import { DEFAULT_PDF_ORDER, IMAGES_TO_PDF, PDF_ACTIONS } from './pdf-actions'
import { DEFAULT_AUDIO_ORDER, DEFAULT_VIDEO_ORDER, MEDIA_ACTIONS } from './media-actions'
import { MORE_ACTIONS, MORE_ORDERS } from './more-actions'

const needsImageOutput = (format: string) => (caps: Capabilities) =>
  caps.imageOutput.includes(format) ? null : `This build cannot encode ${format.toUpperCase()}`

const IMAGE_KIND: ActionDefinition['kinds'] = ['image']
const IMAGE_EXTS: Record<string, string[]> = { png: ['png'], jpeg: ['jpg', 'jpeg'], webp: ['webp'], avif: ['avif'], tiff: ['tif', 'tiff'], bmp: ['bmp'] }
const canDecodeImage: ActionDefinition['canRead'] = (file, caps) => caps.imageInput.includes(file.format)

const imageConversions: ActionDefinition[] = IMAGE_OUTPUTS.map((f) => ({
  id: `image.convert.${f.id}`,
  label: f.label,
  title: `Convert to ${f.label}`,
  icon: 'file-image',
  kinds: IMAGE_KIND,
  canRead: canDecodeImage,
  // Hidden only when the file already has this format's usual extension, so e.g. a .jfif (which
  // is JPEG inside) still offers "JPG". Drag-time provisional files use the format as their ext.
  excludeExts: IMAGE_EXTS[f.id] ?? [f.id],
  minFiles: 1,
  maxFiles: 500,
  unavailableReason: needsImageOutput(f.id),
  mode: 'instant',
  suffix: 'converted',
}))

export const ACTIONS: ActionDefinition[] = [
  ...imageConversions,
  {
    id: 'image.crop',
    label: 'CROP',
    title: 'Crop image',
    icon: 'crop',
    kinds: IMAGE_KIND,
    canRead: canDecodeImage,
    minFiles: 1,
    maxFiles: 1,
    mode: 'editor',
    editor: 'image',
    suffix: 'cropped',
  },
  {
    id: 'image.resize',
    label: 'RESIZE',
    title: 'Resize image',
    icon: 'scaling',
    kinds: IMAGE_KIND,
    canRead: canDecodeImage,
    minFiles: 1,
    maxFiles: 1,
    mode: 'editor',
    editor: 'image',
    suffix: 'resized',
  },
  {
    id: 'image.compress',
    label: 'COMPRESS',
    title: 'Compress image',
    icon: 'shrink',
    kinds: IMAGE_KIND,
    canRead: canDecodeImage,
    minFiles: 1,
    maxFiles: 500,
    mode: 'instant',
    suffix: 'compressed',
  },
  {
    id: 'image.rotate',
    label: 'ROTATE',
    title: 'Rotate 90° clockwise',
    icon: 'rotate-cw',
    kinds: IMAGE_KIND,
    canRead: canDecodeImage,
    minFiles: 1,
    maxFiles: 500,
    mode: 'instant',
    suffix: 'rotated',
  },
  {
    id: 'image.strip-metadata',
    label: 'STRIP',
    title: 'Strip metadata',
    icon: 'eraser',
    kinds: IMAGE_KIND,
    canRead: canDecodeImage,
    minFiles: 1,
    maxFiles: 500,
    mode: 'instant',
    suffix: 'clean',
  },
  {
    id: 'image.background',
    label: 'ADD BG',
    title: 'Add background',
    icon: 'image-plus',
    kinds: IMAGE_KIND,
    canRead: canDecodeImage,
    minFiles: 1,
    maxFiles: 1,
    mode: 'editor',
    editor: 'background',
    suffix: 'background',
  },
  {
    id: 'image.remove-bg',
    label: 'REMOVE BG',
    title: 'Remove background',
    icon: 'wand-sparkles',
    kinds: IMAGE_KIND,
    canRead: canDecodeImage,
    unavailableReason: (caps) => (caps.removeBg ? null : 'The background-removal model is missing'),
    minFiles: 1,
    maxFiles: 1,
    // Opens with the automatic result; brushes fix what the model got wrong before saving.
    mode: 'editor',
    editor: 'removebg',
    suffix: 'no-bg',
  },
  {
    id: 'image.annotate',
    label: 'ANNOTATE',
    title: 'Annotate',
    icon: 'pen-line',
    kinds: IMAGE_KIND,
    canRead: canDecodeImage,
    minFiles: 1,
    maxFiles: 1,
    mode: 'editor',
    editor: 'annotate',
    suffix: 'annotated',
  },
  {
    id: 'image.redact',
    label: 'REDACT',
    title: 'Redact',
    icon: 'eye-off',
    kinds: IMAGE_KIND,
    canRead: canDecodeImage,
    minFiles: 1,
    maxFiles: 1,
    mode: 'editor',
    editor: 'redact',
    suffix: 'redacted',
  },
  {
    id: 'image.metadata',
    label: 'METADATA',
    title: 'View metadata',
    icon: 'tag',
    kinds: IMAGE_KIND,
    canRead: canDecodeImage,
    minFiles: 1,
    maxFiles: 1,
    mode: 'editor',
    editor: 'metadata',
    suffix: '',
  },
  { ...IMAGES_TO_PDF, canRead: canDecodeImage },
  ...PDF_ACTIONS,
  ...MEDIA_ACTIONS,
  ...MORE_ACTIONS,
]

export const ACTIONS_BY_ID: ReadonlyMap<string, ActionDefinition> = new Map(ACTIONS.map((a) => [a.id, a]))

/** Default wheel order per file kind. Users can reorder this in Settings. */
export const DEFAULT_WHEEL_ORDER: Record<string, string[]> = {
  image: [
    'image.convert.jpeg',
    'image.convert.png',
    'image.convert.webp',
    'image.crop',
    'image.compress',
    'image.annotate',
    'image.background',
    'image.remove-bg',
    'image.redact',
    'image.metadata',
    'image.resize',
    'image.rotate',
    'image.to-pdf',
    'image.convert.avif',
    'image.strip-metadata',
    'image.convert.tiff',
    'image.convert.bmp',
  ],
  pdf: DEFAULT_PDF_ORDER,
  video: [...DEFAULT_VIDEO_ORDER.slice(0, 3), 'video.fit-25mb', ...DEFAULT_VIDEO_ORDER.slice(3), 'video.fit-10mb'],
  audio: DEFAULT_AUDIO_ORDER,
  ...MORE_ORDERS,
}
