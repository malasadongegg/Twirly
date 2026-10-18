import type { FileInfo } from '@shared/types'
import { sameOrPng, type ImageOutputFormat, IMAGE_OUTPUT_IDS } from './image-formats'
import { imageOpsSchema, type ImageOps } from './image-params'

export interface ImagePlan {
  ops: ImageOps
  format: ImageOutputFormat
}

/** Quality used by the one-click "Compress" action, per output format. */
export const COMPRESS_QUALITY: Partial<Record<ImageOutputFormat, number>> = { jpeg: 75, webp: 72, avif: 50, png: 80 }

/**
 * Turn an image action plus user params into concrete operations for one file.
 * Throws a ZodError when editor params are malformed.
 */
export function planImageJob(actionId: string, file: FileInfo, params: Record<string, unknown>): ImagePlan {
  const same = sameOrPng(file.format)

  const convert = /^image\.convert\.(.+)$/.exec(actionId)
  if (convert) {
    const format = convert[1] as ImageOutputFormat
    if (!(IMAGE_OUTPUT_IDS as string[]).includes(format)) throw new Error(`Unknown output format ${format}`)
    return { format, ops: imageOpsSchema.parse({ quality: params.quality }) }
  }

  switch (actionId) {
    case 'image.compress':
      return { format: same, ops: imageOpsSchema.parse({ compress: true, quality: COMPRESS_QUALITY[same] }) }
    case 'image.rotate':
      return { format: same, ops: imageOpsSchema.parse({ rotate: 90 }) }
    case 'image.strip-metadata':
      // Re-encoding JPEG is unavoidable with sharp; use near-lossless quality.
      return { format: same, ops: imageOpsSchema.parse({ stripMetadata: true, quality: same === 'jpeg' ? 95 : undefined }) }
    case 'image.crop':
    case 'image.resize': {
      const ops = imageOpsSchema.parse(params)
      return { format: ops.format ?? same, ops }
    }
    default:
      throw new Error(`Not an image action: ${actionId}`)
  }
}
