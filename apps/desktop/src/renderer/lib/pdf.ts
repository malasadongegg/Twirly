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
