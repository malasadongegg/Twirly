/**
 * Rebuild readable paragraphs from positioned PDF text runs (pdf.js text items).
 * PDF coordinates: y grows upward. Heuristics, deliberately simple and predictable:
 * - runs within half a line height vertically form one line, ordered left to right;
 * - a paragraph ends at a vertical gap clearly larger than the usual line spacing, or when the
 *   font size changes;
 * - lines ending in a hyphen followed by a lowercase start are re-joined without the hyphen;
 * - paragraphs noticeably larger than the body text become headings.
 */

export interface TextRun {
  str: string
  x: number
  y: number
  /** Font height in PDF units. */
  h: number
  /** Advance width of the run, when known. */
  w?: number
}

export interface Paragraph {
  text: string
  /** 0 = body, 1 = title-size heading, 2 = section heading. */
  heading: 0 | 1 | 2
  /** Baseline of the first line in PDF space (y up); used to interleave images. */
  y?: number
  /** A picture instead of text; sized in PDF points. */
  image?: { data: Uint8Array; width: number; height: number }
}

/** A picture on a page, positioned by its top edge in PDF space (y up). */
export interface PageImage {
  data: Uint8Array
  x: number
  top: number
  width: number
  height: number
}

/** Insert each image before the first paragraph that starts below its top edge (reading order). */
export function placeImages(paras: Paragraph[], images: PageImage[]): Paragraph[] {
  const out = [...paras]
  for (const img of [...images].sort((a, b) => b.top - a.top)) {
    let at = out.findIndex((p) => p.y !== undefined && p.y < img.top - img.height * 0.25)
    if (at < 0) at = out.length
    // Keep several images in the same slot in top-to-bottom order.
    while (at > 0 && out[at - 1]!.image && out[at - 1]!.y! < img.top) at--
    out.splice(at, 0, { text: '', heading: 0, y: img.top, image: { data: img.data, width: img.width, height: img.height } })
  }
  return out
}

interface Line {
  y: number
  h: number
  text: string
}

const percentile = (xs: number[], q: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) * q)]!
}
const median = (xs: number[]) => percentile(xs, 0.5)

export function toLines(runs: TextRun[]): Line[] {
  const items = runs.filter((r) => r.str.length > 0 && r.h > 0).sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: { y: number; h: number; runs: TextRun[] }[] = []
  for (const r of items) {
    const line = lines.find((l) => Math.abs(l.y - r.y) < Math.max(l.h, r.h) * 0.5)
    if (line) {
      line.runs.push(r)
      line.h = Math.max(line.h, r.h)
    } else lines.push({ y: r.y, h: r.h, runs: [r] })
  }
  lines.sort((a, b) => b.y - a.y)
  return lines.map((l) => {
    const sorted = l.runs.sort((a, b) => a.x - b.x)
    let text = ''
    let prevEnd: number | null = null
    for (const r of sorted) {
      const gap = prevEnd === null ? 0 : r.x - prevEnd
      if (text && gap > r.h * 0.15 && !text.endsWith(' ') && !r.str.startsWith(' ')) text += ' '
      text += r.str
      prevEnd = r.w !== undefined ? r.x + r.w : r.x + r.str.length * r.h * 0.5
    }
    return { y: l.y, h: l.h, text: text.replace(/\s+/g, ' ').trim() }
  }).filter((l) => l.text.length > 0)
}

function joinLines(a: string, b: string): string {
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b
  return `${a} ${b}`
}

/** Paragraphs as Markdown: title-size text becomes `#`, section headings `##`. */
export function paragraphsToMarkdown(paras: Paragraph[], imageUrl: (p: Paragraph) => string | null = () => null): string {
  return paras
    .map((p) => (p.image ? (imageUrl(p) ? `![](${imageUrl(p)})` : '') : p.heading ? `${'#'.repeat(p.heading)} ${p.text}` : p.text))
    .filter(Boolean)
    .join('\n\n')
}

export function toParagraphs(lines: Line[], bodySize?: number): Paragraph[] {
  if (!lines.length) return []
  const body = bodySize ?? median(lines.map((l) => l.h))
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1]!.y - lines[i]!.y)
  // Normal line spacing: the lower quartile of gaps. The median gets skewed upward by paragraph
  // gaps when a page has only a few lines.
  const spacing = percentile(gaps.filter((g) => g > 0), 0.25) || body * 1.2

  const paras: { text: string; h: number; y: number }[] = []
  let cur: { text: string; h: number; y: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    const prev = lines[i - 1]
    const gap = prev ? prev.y - l.y : 0
    const sizeChange = prev ? Math.abs(l.h - prev.h) / Math.max(l.h, prev.h) > 0.15 : false
    if (!cur || gap > spacing * 1.45 || sizeChange) {
      cur = { text: l.text, h: l.h, y: l.y }
      paras.push(cur)
    } else {
      cur.text = joinLines(cur.text, l.text)
    }
  }
  return paras.map((p) => ({
    text: p.text,
    y: p.y,
    heading: p.h > body * 1.6 ? 1 : p.h > body * 1.2 && p.text.length < 160 ? 2 : 0,
  }))
}
