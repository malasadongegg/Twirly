import { readFile } from 'node:fs/promises'
import { degrees, PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { UserFacingError } from '../errors'
import { loadImage } from '../images/process'

/** One page of an edited document: source page index and extra clockwise rotation. */
export interface PageSpec {
  index: number
  rotate: 0 | 90 | 180 | 270
  /** Fractions of the current crop box to cut from each edge (unrotated page space). */
  crop?: { left: number; top: number; right: number; bottom: number }
}

export async function loadPdf(path: string, signal?: AbortSignal): Promise<PDFDocument> {
  const bytes = await readFile(path, { signal })
  let doc: PDFDocument
  let pages: number
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
    // pdf-lib parses leniently: garbage after a %PDF header "loads" and only fails here.
    pages = doc.getPageCount()
  } catch (err) {
    const msg = (err as Error).message
    if (/encrypt/i.test(msg)) throw new UserFacingError('This PDF is password-protected.', msg)
    throw new UserFacingError('The PDF is damaged or not a valid PDF.', msg)
  }
  if (pages === 0) throw new UserFacingError('The PDF is damaged or has no pages.')
  return doc
}

export async function pageCount(path: string): Promise<number> {
  return (await loadPdf(path)).getPageCount()
}

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true })

/** New document with the given pages (any order, duplicates allowed) and rotations. */
export async function rebuild(src: PDFDocument, pages: PageSpec[]): Promise<Uint8Array> {
  const total = src.getPageCount()
  if (pages.length === 0) throw new UserFacingError('No pages selected.')
  for (const p of pages) if (p.index < 0 || p.index >= total) throw new UserFacingError(`Page ${p.index + 1} does not exist.`)
  const out = await PDFDocument.create()
  const copied = await out.copyPages(
    src,
    pages.map((p) => p.index),
  )
  copied.forEach((page, i) => {
    const { rotate: extra, crop } = pages[i]!
    if (extra) page.setRotation(degrees((page.getRotation().angle + extra) % 360))
    if (crop && (crop.left || crop.top || crop.right || crop.bottom)) {
      if (crop.left + crop.right >= 0.95 || crop.top + crop.bottom >= 0.95) throw new UserFacingError('The crop leaves nothing of the page.')
      // PDF space has y going up: "bottom" is measured from the box's y origin.
      const box = page.getCropBox()
      page.setCropBox(box.x + box.width * crop.left, box.y + box.height * crop.bottom, box.width * (1 - crop.left - crop.right), box.height * (1 - crop.top - crop.bottom))
    }
    out.addPage(page)
  })
  return save(out)
}

export async function rotateAll(src: PDFDocument, by: 90 | 180 | 270): Promise<Uint8Array> {
  return rebuild(
    src,
    src.getPageIndices().map((index) => ({ index, rotate: by })),
  )
}

/** One single-page document per page. */
export async function split(src: PDFDocument): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []
  for (const index of src.getPageIndices()) out.push(await rebuild(src, [{ index, rotate: 0 }]))
  return out
}

export async function merge(paths: string[], signal?: AbortSignal): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const path of paths) {
    signal?.throwIfAborted()
    const src = await loadPdf(path, signal)
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page)
  }
  return save(out)
}

/**
 * Re-save with object streams and without unused objects. This is honest "optimization": it
 * shrinks structural overhead but does not recompress images, so big scans barely change.
 */
export async function optimize(src: PDFDocument): Promise<Uint8Array> {
  return rebuild(
    src,
    src.getPageIndices().map((index) => ({ index, rotate: 0 })),
  )
}

/** Images → one PDF, one page per image, page size = image size at 72 dpi (1 px = 1 pt). */
export async function imagesToPdf(paths: string[], signal?: AbortSignal): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const path of paths) {
    signal?.throwIfAborted()
    const input = await loadImage(path, signal)
    // Normalize through sharp: applies EXIF orientation and turns any format into JPEG or PNG.
    const meta = await sharp(input).metadata()
    const pipeline = sharp(input, { animated: false }).autoOrient()
    const image = meta.hasAlpha
      ? await out.embedPng(await pipeline.png().toBuffer())
      : await out.embedJpg(await pipeline.jpeg({ quality: 92 }).toBuffer())
    const page = out.addPage([image.width, image.height])
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  }
  return save(out)
}

/** Parse "1-3, 5, 8-" (1-based, inclusive) into 0-based indices within `total` pages. */
export function parsePageRanges(input: string, total: number): number[] {
  const out: number[] = []
  for (const part of input.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d*)\s*(-)?\s*(\d*)$/.exec(part)
    if (!m) throw new UserFacingError(`Invalid page range "${part}"`)
    const start = m[1] ? Number(m[1]) : 1
    const end = m[2] ? (m[3] ? Number(m[3]) : total) : start
    if (start < 1 || end > total || start > end) throw new UserFacingError(`Page range "${part}" is outside 1–${total}`)
    for (let p = start; p <= end; p++) out.push(p - 1)
  }
  if (out.length === 0) throw new UserFacingError('No pages selected.')
  return out
}
