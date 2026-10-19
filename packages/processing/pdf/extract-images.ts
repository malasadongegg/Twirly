import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib'
import sharp from 'sharp'
import { UserFacingError } from '../errors'

const N = (n: string) => PDFName.of(n)
const num = (s: PDFRawStream, k: string) => {
  const v = s.dict.lookup(N(k))
  return v instanceof PDFNumber ? v.asNumber() : 0
}
const filters = (s: PDFRawStream): string[] => {
  const f = s.dict.lookup(N('Filter'))
  if (f instanceof PDFName) return [f.asString()]
  if (f instanceof PDFArray) return f.asArray().map((x) => (x instanceof PDFName ? x.asString() : '?'))
  return []
}
function channels(s: PDFRawStream): 1 | 3 | null {
  const cs = s.dict.lookup(N('ColorSpace'))
  if (cs === N('DeviceRGB')) return 3
  if (cs === N('DeviceGray')) return 1
  if (cs instanceof PDFArray && cs.lookup(0) === N('ICCBased')) {
    const p = cs.lookup(1)
    const n = p instanceof PDFRawStream ? num(p, 'N') : 0
    return n === 3 ? 3 : n === 1 ? 1 : null
  }
  return null
}

function rawPixels(s: PDFRawStream, ch: 1 | 3): Buffer | null {
  const f = filters(s)
  if (f.length !== 1 || f[0] !== '/FlateDecode' || num(s, 'BitsPerComponent') !== 8 || s.dict.has(N('DecodeParms'))) return null
  const data = inflateSync(s.contents)
  return data.length === num(s, 'Width') * num(s, 'Height') * ch ? data : null
}

export interface ExtractImagesResult {
  written: string[]
  skipped: number
}

/**
 * Save every embedded image of a PDF into `dest`, keeping the original encoding where it is a
 * standard file format (JPEG → .jpg, JPEG 2000 → .jp2) and turning plain RGB/gray pixel data
 * into PNG (with its transparency mask when there is one). Other encodings are counted as skipped.
 */
export async function extractPdfImages(bytes: Uint8Array, dest: string, signal?: AbortSignal): Promise<ExtractImagesResult> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
    doc.getPageCount()
  } catch (err) {
    throw new UserFacingError('The PDF is damaged, encrypted or not a valid PDF.', (err as Error).message)
  }
  const objects = doc.context.enumerateIndirectObjects()
  const masks = new Set<string>()
  for (const [, o] of objects) {
    const m = o instanceof PDFRawStream ? o.dict.get(N('SMask')) : undefined
    if (m instanceof PDFRef) masks.add(m.toString())
  }
  const written: string[] = []
  let skipped = 0
  for (const [ref, o] of objects) {
    signal?.throwIfAborted()
    if (!(o instanceof PDFRawStream) || o.dict.lookup(N('Subtype')) !== N('Image') || masks.has(ref.toString())) continue
    const w = num(o, 'Width')
    const h = num(o, 'Height')
    if (w < 16 || h < 16) continue // icons, bullets, spacer pixels
    const name = `image-${String(written.length + 1).padStart(3, '0')}`
    const f = filters(o)
    try {
      if (f.length === 1 && f[0] === '/DCTDecode') {
        const path = join(dest, `${name}.jpg`)
        await writeFile(path, o.contents, { flag: 'wx' })
        written.push(path)
        continue
      }
      if (f.length === 1 && f[0] === '/JPXDecode') {
        const path = join(dest, `${name}.jp2`)
        await writeFile(path, o.contents, { flag: 'wx' })
        written.push(path)
        continue
      }
      const ch = channels(o)
      const pixels = ch ? rawPixels(o, ch) : null
      if (!ch || !pixels) {
        skipped++
        continue
      }
      let img = sharp(pixels, { raw: { width: w, height: h, channels: ch } })
      const maskRef = o.dict.get(N('SMask'))
      const mask = maskRef instanceof PDFRef ? doc.context.lookup(maskRef) : undefined
      const alpha = mask instanceof PDFRawStream && num(mask, 'Width') === w && num(mask, 'Height') === h ? rawPixels(mask, 1) : null
      if (alpha) img = img.joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } })
      const path = join(dest, `${name}.png`)
      await writeFile(path, await img.png().toBuffer(), { flag: 'wx' })
      written.push(path)
    } catch {
      skipped++
    }
  }
  return { written, skipped }
}
