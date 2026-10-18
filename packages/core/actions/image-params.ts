import { z } from 'zod'
import { IMAGE_OUTPUT_IDS, type ImageOutputFormat } from './image-formats'

/**
 * A non-destructive image edit, applied in this order:
 * auto-orient (EXIF) → rotate → flip → crop → resize → encode.
 * Crop coordinates are in pixels of the image *after* orientation, rotation and flips, which is
 * exactly what the editor preview shows.
 */
export const imageOpsSchema = z.object({
  format: z.enum(IMAGE_OUTPUT_IDS as [ImageOutputFormat, ...ImageOutputFormat[]]).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
  crop: z
    .object({
      left: z.number().int().min(0),
      top: z.number().int().min(0),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
    })
    .optional(),
  resize: z
    .object({
      width: z.number().int().min(1).max(32768),
      height: z.number().int().min(1).max(32768),
    })
    .optional(),
  /** Remove EXIF/XMP/IPTC (GPS included). ICC is converted to sRGB either way. */
  stripMetadata: z.boolean().default(false),
  /** Spend more CPU for smaller files (palette PNG, mozjpeg trellis, higher effort). */
  compress: z.boolean().default(false),
})

export type ImageOps = z.output<typeof imageOpsSchema>
export type ImageOpsInput = z.input<typeof imageOpsSchema>

export const DEFAULT_QUALITY: Record<ImageOutputFormat, number> = {
  jpeg: 88,
  webp: 85,
  avif: 60,
  png: 100,
  tiff: 90,
  bmp: 100,
}

/** Size of the output image for given oriented source dimensions, before encoding. */
export function outputDimensions(source: { width: number; height: number }, ops: ImageOps): { width: number; height: number } {
  const turned = ops.rotate === 90 || ops.rotate === 270
  let width = turned ? source.height : source.width
  let height = turned ? source.width : source.height
  if (ops.crop) {
    width = ops.crop.width
    height = ops.crop.height
  }
  if (ops.resize) {
    width = ops.resize.width
    height = ops.resize.height
  }
  return { width, height }
}
