import { z } from 'zod'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/** Original Twirly background presets (two-stop linear gradients and solids). */
export const BACKGROUND_PRESETS = [
  { id: 'midnight', kind: 'gradient', from: '#0f172a', to: '#1e3a8a' },
  { id: 'aurora', kind: 'gradient', from: '#3b82f6', to: '#a855f7' },
  { id: 'ember', kind: 'gradient', from: '#f97316', to: '#db2777' },
  { id: 'lagoon', kind: 'gradient', from: '#06b6d4', to: '#3b82f6' },
  { id: 'moss', kind: 'gradient', from: '#22c55e', to: '#0ea5e9' },
  { id: 'dusk', kind: 'gradient', from: '#f59e0b', to: '#7c3aed' },
  { id: 'graphite', kind: 'gradient', from: '#1c2530', to: '#0b0f14' },
  { id: 'white', kind: 'solid', from: '#ffffff', to: '#ffffff' },
  { id: 'paper', kind: 'solid', from: '#f3f6fa', to: '#f3f6fa' },
  { id: 'ink', kind: 'solid', from: '#0b0f14', to: '#0b0f14' },
  { id: 'blue', kind: 'solid', from: '#3b82f6', to: '#3b82f6' },
] as const

export const BG_RATIOS = { auto: null, '1:1': 1, '16:9': 16 / 9, '4:5': 4 / 5 } as const
export type BgRatio = keyof typeof BG_RATIOS

/** A touch-up brush stroke on the background-removal mask, in displayed (oriented) image pixels. */
export const maskStrokeSchema = z.object({
  /** keep = paint the subject back in; erase = remove more. */
  mode: z.enum(['keep', 'erase']),
  /** Brush diameter in image pixels. */
  size: z.number().min(1).max(4000),
  points: z.array(z.tuple([z.number(), z.number()])).min(1).max(20_000),
})
export type MaskStroke = z.output<typeof maskStrokeSchema>
export const strokesSchema = z.array(maskStrokeSchema).max(500).default([])

/** "Remove background": optional touch-up strokes over the automatic mask. */
export const removeBgSchema = z.object({ strokes: strokesSchema })

export const backgroundSchema = z.object({
  from: hex.default('#3b82f6'),
  to: hex.default('#a855f7'),
  /** Gradient angle in degrees (0 = left→right, 90 = top→bottom). */
  angle: z.number().min(0).max(360).default(135),
  /** Space around the image, in source pixels. */
  padding: z.number().int().min(0).max(4000).default(96),
  /** Corner radius applied to the image, in source pixels. */
  corners: z.number().int().min(0).max(2000).default(24),
  /** Shadow blur radius, in source pixels (0 = none). */
  shadow: z.number().int().min(0).max(400).default(32),
  ratio: z.enum(['auto', '1:1', '16:9', '4:5']).default('auto'),
  /** Gradient/solid colors, or a picture (absolute path) scaled to cover the canvas. */
  fill: z.enum(['gradient', 'image']).default('gradient'),
  image: z.string().min(1).max(32_767).optional(),
  /** Blur for a picture background, in canvas pixels. */
  blur: z.number().min(0).max(200).default(0),
  /** Cut the subject out first (IS-Net), so the new background shows around it. */
  removeBg: z.boolean().default(false),
  /** Touch-up strokes for the cut-out (only with removeBg). */
  strokes: strokesSchema,
})
export type BackgroundParams = z.output<typeof backgroundSchema>

/** Canvas size for an image of w×h with padding, grown (never cropped) to the ratio. */
export function backgroundCanvas(w: number, h: number, p: Pick<BackgroundParams, 'padding' | 'ratio'>): { width: number; height: number } {
  let width = w + 2 * p.padding
  let height = h + 2 * p.padding
  const r = BG_RATIOS[p.ratio]
  if (r) {
    if (width / height < r) width = Math.round(height * r)
    else height = Math.round(width / r)
  }
  return { width, height }
}

export const regionSchema = z.object({
  left: z.number().int().min(0),
  top: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
})

export const redactSchema = z.object({
  /** Rectangles in displayed (EXIF-oriented) pixel coordinates. */
  regions: z.array(regionSchema).min(1).max(500),
  fill: z.enum(['black', 'white']).default('black'),
})
export type RedactParams = z.output<typeof redactSchema>
