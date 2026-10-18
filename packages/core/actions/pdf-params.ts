import { z } from 'zod'

const margin = z.number().min(0).max(0.45)

/** Crop margins as fractions of the page's current visible box (unrotated page space). */
export const cropMarginsSchema = z.object({ left: margin, top: margin, right: margin, bottom: margin })
export type CropMargins = z.infer<typeof cropMarginsSchema>

export const pageSpecSchema = z.object({
  index: z.number().int().min(0),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  crop: cropMarginsSchema.optional(),
})

/** Page editor result: the new document's pages, in order. */
export const pdfEditSchema = z.object({ pages: z.array(pageSpecSchema).min(1).max(10_000) })

export const pdfRenderSchema = z.object({
  dpi: z.number().int().min(36).max(600).default(150),
})
