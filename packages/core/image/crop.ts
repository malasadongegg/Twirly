/** Crop rectangle math for the image editor. All values are in the same pixel space. */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Size {
  w: number
  h: number
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move'

export const ASPECT_PRESETS = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
] as const

export type AspectId = (typeof ASPECT_PRESETS)[number]['id']

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** Largest rect of `ratio` (w/h) centered in `bounds`; the whole image when ratio is null. */
export function fitAspect(bounds: Size, ratio: number | null): Rect {
  if (!ratio) return { x: 0, y: 0, w: bounds.w, h: bounds.h }
  let w = bounds.w
  let h = w / ratio
  if (h > bounds.h) {
    h = bounds.h
    w = h * ratio
  }
  return { x: (bounds.w - w) / 2, y: (bounds.h - h) / 2, w, h }
}

/** Keep `r` inside `bounds` by moving it (never resizing, unless it is larger than bounds). */
export function clampMove(r: Rect, bounds: Size): Rect {
  const w = Math.min(r.w, bounds.w)
  const h = Math.min(r.h, bounds.h)
  return { x: clamp(r.x, 0, bounds.w - w), y: clamp(r.y, 0, bounds.h - h), w, h }
}

/**
 * Apply a pointer drag of (dx, dy) on `handle` to `start`. Edges stay inside `bounds`, size never
 * drops below `min`, and when `ratio` is set the rectangle keeps it (the opposite corner/edge is
 * the anchor).
 */
export function dragHandle(start: Rect, handle: Handle, dx: number, dy: number, bounds: Size, ratio: number | null, min = 8): Rect {
  if (handle === 'move') return clampMove({ ...start, x: start.x + dx, y: start.y + dy }, bounds)

  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (handle.includes('w')) left = clamp(left + dx, 0, right - min)
  if (handle.includes('e')) right = clamp(right + dx, left + min, bounds.w)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, bounds.h)

  if (!ratio) return { x: left, y: top, w: right - left, h: bottom - top }

  // Aspect-locked: derive the free dimension from the dragged one, anchored on the opposite side.
  let w = right - left
  let h = bottom - top
  const horizontalOnly = handle === 'e' || handle === 'w'
  const verticalOnly = handle === 'n' || handle === 's'
  if (horizontalOnly) h = w / ratio
  else if (verticalOnly) w = h * ratio
  else if (w / h > ratio) w = h * ratio
  else h = w / ratio

  // Fit within bounds from the anchor.
  const anchorX = handle.includes('w') ? start.x + start.w : handle.includes('e') ? start.x : start.x + start.w / 2
  const anchorY = handle.includes('n') ? start.y + start.h : handle.includes('s') ? start.y : start.y + start.h / 2
  const maxW = handle.includes('w') ? anchorX : handle.includes('e') ? bounds.w - anchorX : 2 * Math.min(anchorX, bounds.w - anchorX)
  const maxH = handle.includes('n') ? anchorY : handle.includes('s') ? bounds.h - anchorY : 2 * Math.min(anchorY, bounds.h - anchorY)
  const scale = Math.min(1, maxW / w, maxH / h)
  w *= scale
  h *= scale

  const x = handle.includes('w') ? anchorX - w : handle.includes('e') ? anchorX : anchorX - w / 2
  const y = handle.includes('n') ? anchorY - h : handle.includes('s') ? anchorY : anchorY - h / 2
  return { x, y, w, h }
}

/** Convert a rect between pixel spaces (e.g. preview canvas → full resolution), rounding to ints inside bounds. */
export function scaleRect(r: Rect, factor: number, bounds: Size): { left: number; top: number; width: number; height: number } {
  const left = clamp(Math.round(r.x * factor), 0, bounds.w - 1)
  const top = clamp(Math.round(r.y * factor), 0, bounds.h - 1)
  const width = clamp(Math.round(r.w * factor), 1, bounds.w - left)
  const height = clamp(Math.round(r.h * factor), 1, bounds.h - top)
  return { left, top, width, height }
}
