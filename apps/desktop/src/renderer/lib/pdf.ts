import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// Fonts, CMaps, ICC profiles and WASM decoders are copied to /pdfjs by scripts/copy-pdfjs-assets.mjs.
const assets = new URL('./pdfjs/', document.baseURI).toString()

export type PdfDoc = PDFDocumentProxy

export function openPdf(data: Uint8Array): Promise<PdfDoc> {
  return pdfjs.getDocument({
    data,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
    enableXfa: false,
  }).promise
}

/** Render a 0-based page to a canvas at `dpi`, capped to `maxPixels` total. */
export async function renderToCanvas(doc: PdfDoc, pageIndex: number, dpi: number, maxPixels = 40_000_000): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageIndex + 1)
  const base = page.getViewport({ scale: 1 })
  let scale = dpi / 72
  const pixels = base.width * scale * base.height * scale
  if (pixels > maxPixels) scale *= Math.sqrt(maxPixels / pixels)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const ctx = canvas.getContext('2d')!
  // White page background: PDFs assume paper; transparent PNG pages look broken in viewers.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  page.cleanup()
  return canvas
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas encode failed'))), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

/** Plain text of a 0-based page, with line breaks where the PDF has them. */
export async function pageText(doc: PdfDoc, pageIndex: number): Promise<string> {
  const page = await doc.getPage(pageIndex + 1)
  const content = await page.getTextContent()
  let out = ''
  for (const item of content.items) {
    if (!('str' in item)) continue
    out += item.str
    if (item.hasEOL) out += '\n'
  }
  page.cleanup()
  return out.trimEnd()
}

export interface PageLayout {
  /** Visible page size in PDF points. */
  width: number
  height: number
  runs: { str: string; x: number; y: number; h: number; w: number }[]
}

/** Positioned text runs of a 0-based page (PDF space, y up), for paragraph reconstruction. */
export async function pageLayout(doc: PdfDoc, pageIndex: number): Promise<PageLayout> {
  const page = await doc.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const runs: PageLayout['runs'] = []
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue
    const [, , c, d, e, f] = item.transform as number[]
    runs.push({ str: item.str, x: e!, y: f!, h: item.height || Math.hypot(c!, d!), w: item.width })
  }
  page.cleanup()
  return { width: viewport.width, height: viewport.height, runs }
}

export interface PageImageCrop {
  /** Left edge and top edge in PDF points (y up), and size in points. */
  x: number
  top: number
  width: number
  height: number
  png: Uint8Array
}

/**
 * Pictures on a 0-based page, found from the drawing operations (the transform in force when an
 * image is painted places the unit square). Each is cropped from a render of the page, so masks,
 * clipping and odd encodings come out as they look. Page-sized backgrounds and tiny icons are skipped.
 */
export async function pageImages(doc: PdfDoc, pageIndex: number, dpi = 150): Promise<PageImageCrop[]> {
  const page = await doc.getPage(pageIndex + 1)
  const [vx, vy, vx2, vy2] = page.view as number[]
  const [pw, ph] = [vx2! - vx!, vy2! - vy!]
  const ops = await page.getOperatorList()
  const O = pdfjs.OPS
  type M = [number, number, number, number, number, number]
  const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]
  let ctm: M = [1, 0, 0, 1, 0, 0]
  const stack: M[] = []
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    if (fn === O.save) stack.push(ctm)
    else if (fn === O.restore) ctm = stack.pop() ?? ctm
    else if (fn === O.transform) ctm = mul(ops.argsArray[i] as M, ctm)
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageMaskXObject) {
      const xs = [ctm[4], ctm[0] + ctm[4], ctm[2] + ctm[4], ctm[0] + ctm[2] + ctm[4]]
      const ys = [ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5]]
      const b = { x0: Math.min(...xs) - vx!, x1: Math.max(...xs) - vx!, y0: Math.min(...ys) - vy!, y1: Math.max(...ys) - vy! }
      const [w, h] = [b.x1 - b.x0, b.y1 - b.y0]
      if (w < 24 || h < 24 || (w > pw * 0.95 && h > ph * 0.95)) continue
      if (boxes.some((o) => Math.abs(o.x0 - b.x0) < 2 && Math.abs(o.y0 - b.y0) < 2 && Math.abs(o.x1 - b.x1) < 2 && Math.abs(o.y1 - b.y1) < 2)) continue
      boxes.push(b)
    }
  }
  page.cleanup()
  if (!boxes.length || page.rotate % 360 !== 0) return []
  const canvas = await renderToCanvas(doc, pageIndex, dpi, 25_000_000)
  const s = canvas.width / pw
  const out: PageImageCrop[] = []
  for (const b of boxes.slice(0, 40)) {
    const sx = Math.max(0, Math.floor(b.x0 * s))
    const sy = Math.max(0, Math.floor((ph - b.y1) * s))
    const sw = Math.min(canvas.width - sx, Math.ceil((b.x1 - b.x0) * s))
    const sh = Math.min(canvas.height - sy, Math.ceil((b.y1 - b.y0) * s))
    if (sw < 2 || sh < 2) continue
    const c = document.createElement('canvas')
    c.width = sw
    c.height = sh
    c.getContext('2d')!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
    out.push({ x: b.x0, top: b.y1, width: b.x1 - b.x0, height: b.y1 - b.y0, png: await canvasToPng(c) })
  }
  return out
}
