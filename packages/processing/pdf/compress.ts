import { inflateSync } from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from 'pdf-lib'
import sharp from 'sharp'
import { UserFacingError } from '../errors'

export type PdfCompressLevel = 'high' | 'balanced' | 'small'

const LEVELS: Record<PdfCompressLevel, { maxDim: number; quality: number }> = {
  high: { maxDim: 3000, quality: 85 },
  balanced: { maxDim: 2000, quality: 72 },
  small: { maxDim: 1400, quality: 58 },
}

export interface CompressStats {
  before: number
  after: number
  imagesFound: number
  imagesRecompressed: number
}

const N = (n: string) => PDFName.of(n)

function num(dict: PDFDict, key: string): number | undefined {
  const v = dict.lookup(N(key))
  return v instanceof PDFNumber ? v.asNumber() : undefined
}

function filters(dict: PDFDict): string[] {
  const f = dict.lookup(N('Filter'))
  if (f instanceof PDFName) return [f.asString()]
  if (f instanceof PDFArray) return f.asArray().map((x) => (x instanceof PDFName ? x.asString() : '?'))
  return []
}

/** 1 (gray) or 3 (RGB) components, or null for anything we leave alone (CMYK, Indexed, Lab…). */
function components(doc: PDFDocument, dict: PDFDict): 1 | 3 | null {
  const cs = dict.lookup(N('ColorSpace'))
  if (cs instanceof PDFName) return cs === N('DeviceRGB') ? 3 : cs === N('DeviceGray') ? 1 : null
  if (cs instanceof PDFArray && cs.size() === 2 && cs.lookup(0) === N('ICCBased')) {
    const profile = cs.lookup(1)
    const n = profile instanceof PDFRawStream ? num(profile.dict, 'N') : undefined
    return n === 3 ? 3 : n === 1 ? 1 : null
  }
  void doc
  return null
}

/** Decode an image XObject we know how to handle into raw pixels, or null to leave it alone. */
async function decode(stream: PDFRawStream, channels: 1 | 3): Promise<{ data: Buffer; width: number; height: number } | null> {
  const d = stream.dict
  const width = num(d, 'Width')
  const height = num(d, 'Height')
  if (!width || !height) return null
  const f = filters(d)
  if (f.length === 1 && f[0] === '/DCTDecode') {
    const { data, info } = await sharp(Buffer.from(stream.contents)).toColourspace(channels === 1 ? 'b-w' : 'srgb').raw().toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  }
  if (f.length === 1 && f[0] === '/FlateDecode' && num(d, 'BitsPerComponent') === 8 && !d.has(N('DecodeParms'))) {
    const data = inflateSync(stream.contents)
    if (data.length !== width * height * channels) return null
    return { data, width, height }
  }
  return null
}

/**
 * Recompress embedded raster images: downscale beyond the level's max dimension, re-encode as
 * JPEG, and keep an image only if it got at least 10 % smaller. Soft masks (SMask) stay attached.
 * Skipped on purpose: CMYK/Indexed/Lab color, stencil masks, color-key masks, Decode arrays and
 * predictor-encoded images, all of which a naive JPEG re-encode would get wrong.
 */
export async function compressPdf(bytes: Uint8Array, level: PdfCompressLevel = 'balanced', signal?: AbortSignal): Promise<{ data: Uint8Array; stats: CompressStats }> {
  const { maxDim, quality } = LEVELS[level]
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
    doc.getPageCount()
  } catch (err) {
    throw new UserFacingError('The PDF is damaged, encrypted or not a valid PDF.', (err as Error).message)
  }

  const stats: CompressStats = { before: bytes.length, after: 0, imagesFound: 0, imagesRecompressed: 0 }
  const objects = doc.context.enumerateIndirectObjects()
  // Soft masks are images too, but JPEG artifacts in alpha cause halos: never touch them.
  const masks = new Set<string>()
  for (const [, obj] of objects) {
    const smask = obj instanceof PDFRawStream ? obj.dict.get(N('SMask')) : undefined
    if (smask instanceof PDFRef) masks.add(smask.toString())
  }
  for (const [ref, obj] of objects) {
    signal?.throwIfAborted()
    if (!(obj instanceof PDFRawStream)) continue
    const d = obj.dict
    if (d.lookup(N('Subtype')) !== N('Image')) continue
    stats.imagesFound++
    if (masks.has(ref.toString())) continue
    if (obj.contents.length < 30_000) continue
    if (d.lookup(N('ImageMask')) || d.lookup(N('Mask')) instanceof PDFArray || d.has(N('Decode'))) continue
    const channels = components(doc, d)
    if (!channels) continue

    let decoded
    try {
      decoded = await decode(obj, channels)
    } catch {
      continue // undecodable image data: leave it exactly as it was
    }
    if (!decoded) continue

    let img = sharp(decoded.data, { raw: { width: decoded.width, height: decoded.height, channels } })
    if (Math.max(decoded.width, decoded.height) > maxDim) img = img.resize(maxDim, maxDim, { fit: 'inside', kernel: 'lanczos3' })
    if (channels === 1) img = img.toColourspace('b-w')
    const { data: jpeg, info } = await img.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer({ resolveWithObject: true })
    if (jpeg.length > obj.contents.length * 0.9) continue

    // Keep every other entry (SMask, Interpolate, Intent, …); replace the encoding-related ones.
    const literal: Record<string, PDFObject | string | number> = {}
    for (const [key, value] of d.entries()) {
      const k = key.asString().slice(1)
      if (['Filter', 'DecodeParms', 'ColorSpace', 'BitsPerComponent', 'Width', 'Height', 'Length'].includes(k)) continue
      literal[k] = value
    }
    Object.assign(literal, { Filter: 'DCTDecode', ColorSpace: channels === 1 ? 'DeviceGray' : 'DeviceRGB', BitsPerComponent: 8, Width: info.width, Height: info.height })
    doc.context.assign(ref as PDFRef, doc.context.stream(jpeg, literal))
    stats.imagesRecompressed++
  }

  const data = await doc.save({ useObjectStreams: true })
  stats.after = data.length
  if (stats.after >= stats.before * 0.97) {
    throw new UserFacingError(
      stats.imagesFound === 0
        ? 'This PDF has no images to compress; it is already compact.'
        : 'This PDF is already compact. Its images could not be made meaningfully smaller.',
    )
  }
  return { data, stats }
}
