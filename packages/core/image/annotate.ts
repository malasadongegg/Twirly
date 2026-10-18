import { z } from 'zod'

/**
 * Annotations live in full-resolution (EXIF-oriented) image pixels. `annotationElements` turns
 * them into plain SVG element descriptions used both for the live editor overlay (React) and the
 * export (serialized here, rendered by librsvg in main). Main never accepts raw SVG from the
 * renderer: it rebuilds it from validated shapes, so nothing can reference external resources.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const point = z.object({ x: z.number().finite(), y: z.number().finite() })
const style = { color: hex, width: z.number().min(0.5).max(400) }

export const shapeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rect'), from: point, to: point, ...style }),
  z.object({ type: z.literal('ellipse'), from: point, to: point, ...style }),
  z.object({ type: z.literal('line'), from: point, to: point, ...style }),
  z.object({ type: z.literal('arrow'), from: point, to: point, ...style }),
  z.object({ type: z.literal('highlight'), from: point, to: point, ...style }),
  z.object({ type: z.literal('pen'), points: z.array(point).min(2).max(5000), ...style }),
  z.object({ type: z.literal('text'), at: point, text: z.string().min(1).max(500), color: hex, size: z.number().min(4).max(2000) }),
])
export type Shape = z.infer<typeof shapeSchema>

export const annotateSchema = z.object({ shapes: z.array(shapeSchema).min(1).max(2000) })

export interface SvgElement {
  tag: 'rect' | 'ellipse' | 'line' | 'polygon' | 'polyline' | 'text'
  attrs: Record<string, string | number>
  text?: string
}

const r2 = (n: number) => Math.round(n * 100) / 100

function box(from: { x: number; y: number }, to: { x: number; y: number }) {
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y) }
}

/** Arrowhead triangle at `to`, sized from the stroke width. */
export function arrowHead(from: { x: number; y: number }, to: { x: number; y: number }, width: number): string {
  const len = Math.max(width * 4, 10)
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const spread = Math.PI / 7
  const p1 = { x: to.x - len * Math.cos(angle - spread), y: to.y - len * Math.sin(angle - spread) }
  const p2 = { x: to.x - len * Math.cos(angle + spread), y: to.y - len * Math.sin(angle + spread) }
  return `${r2(to.x)},${r2(to.y)} ${r2(p1.x)},${r2(p1.y)} ${r2(p2.x)},${r2(p2.y)}`
}

export function annotationElements(shapes: Shape[]): SvgElement[] {
  const out: SvgElement[] = []
  const stroke = (s: { color: string; width: number }) => ({ fill: 'none', stroke: s.color, 'stroke-width': r2(s.width), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  for (const s of shapes) {
    switch (s.type) {
      case 'rect': {
        const b = box(s.from, s.to)
        out.push({ tag: 'rect', attrs: { x: r2(b.x), y: r2(b.y), width: r2(b.w), height: r2(b.h), rx: r2(s.width), ...stroke(s) } })
        break
      }
      case 'highlight': {
        const b = box(s.from, s.to)
        out.push({ tag: 'rect', attrs: { x: r2(b.x), y: r2(b.y), width: r2(b.w), height: r2(b.h), fill: s.color, 'fill-opacity': 0.35 } })
        break
      }
      case 'ellipse': {
        const b = box(s.from, s.to)
        out.push({ tag: 'ellipse', attrs: { cx: r2(b.x + b.w / 2), cy: r2(b.y + b.h / 2), rx: r2(b.w / 2), ry: r2(b.h / 2), ...stroke(s) } })
        break
      }
      case 'line':
        out.push({ tag: 'line', attrs: { x1: r2(s.from.x), y1: r2(s.from.y), x2: r2(s.to.x), y2: r2(s.to.y), ...stroke(s) } })
        break
      case 'arrow': {
        // Stop the shaft inside the head so the round cap doesn't poke through the tip.
        const len = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y) || 1
        const back = Math.min(Math.max(s.width * 4, 10) * 0.6, len)
        const end = { x: s.to.x - ((s.to.x - s.from.x) / len) * back, y: s.to.y - ((s.to.y - s.from.y) / len) * back }
        out.push({ tag: 'line', attrs: { x1: r2(s.from.x), y1: r2(s.from.y), x2: r2(end.x), y2: r2(end.y), ...stroke(s) } })
        out.push({ tag: 'polygon', attrs: { points: arrowHead(s.from, s.to, s.width), fill: s.color, stroke: s.color, 'stroke-width': r2(s.width / 2), 'stroke-linejoin': 'round' } })
        break
      }
      case 'pen':
        out.push({ tag: 'polyline', attrs: { points: s.points.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' '), ...stroke(s) } })
        break
      case 'text':
        out.push({
          tag: 'text',
          attrs: {
            x: r2(s.at.x),
            y: r2(s.at.y),
            fill: s.color,
            'font-size': r2(s.size),
            'font-family': 'Segoe UI, Arial, sans-serif',
            'font-weight': 600,
            'dominant-baseline': 'hanging',
            // A dark outline keeps light text readable on any background.
            stroke: '#000000',
            'stroke-width': r2(s.size / 14),
            'paint-order': 'stroke',
          },
          text: s.text,
        })
        break
    }
  }
  return out
}

const escapeXml = (v: string) => v.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

/** Standalone SVG document of the annotations for a w×h image. */
export function annotationsSvg(shapes: Shape[], width: number, height: number): string {
  const body = annotationElements(shapes)
    .map((el) => {
      const attrs = Object.entries(el.attrs)
        .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
        .join(' ')
      return el.text !== undefined ? `<${el.tag} ${attrs}>${escapeXml(el.text)}</${el.tag}>` : `<${el.tag} ${attrs}/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
}
