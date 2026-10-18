import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { detectFormat, SIGNATURE_BYTES } from '@core/file-types/signatures'
import sharp, { type Sharp } from 'sharp'
import { DEFAULT_QUALITY, type ImageOps } from '@core/actions/image-params'
import type { ImageOutputFormat } from '@core/actions/image-formats'
import { UserFacingError } from '../errors'
import { BmpError, decodeBmp, encodeBmp } from '@core/image/bmp'

// Never keep source files open between operations: on Windows an open handle blocks the user
// from deleting or moving their own file.
sharp.cache({ files: 0 })

const execFileP = promisify(execFile)

export interface RenderedImage {
  data: Buffer
  width: number
  height: number
  format: ImageOutputFormat
}

/** Formats sharp decodes from the prebuilt binary that Twirly accepts as input. */
export const SHARP_INPUT_FORMATS = ['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif'] as const

/**
 * Read the source as a buffer rather than handing libvips a path. Node handles Unicode and long
 * (>260 char) Windows paths correctly; libvips' own file opening does not always.
 */
export async function loadImage(path: string, signal?: AbortSignal): Promise<Buffer> {
  const buf = await readFile(path, { signal })
  // libvips cannot read BMP: decode it ourselves into a lossless PNG the rest of the pipeline reads.
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    try {
      const raw = decodeBmp(buf)
      return sharp(Buffer.from(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength), { raw: { width: raw.width, height: raw.height, channels: 4 } })
        .png({ compressionLevel: 1 })
        .toBuffer()
    } catch (err) {
      if (err instanceof BmpError) throw new UserFacingError(err.message.endsWith('.') ? err.message : `${err.message}.`, err.message)
      throw err
    }
  }
  // HEIC/HEIF (HEVC): sharp's libheif has no HEVC decoder; FFmpeg does, and composes tile grids.
  if (detectFormat(buf.subarray(0, SIGNATURE_BYTES), '').format === 'heic') return decodeHeic(path, signal)
  return buf
}

let ffmpegForHeic: string | null = null

/** Called by main once capabilities are known; enables HEIC input through FFmpeg. */
export function configureHeicDecoder(ffmpegPath: string | null): void {
  ffmpegForHeic = ffmpegPath
}

async function decodeHeic(path: string, signal?: AbortSignal): Promise<Buffer> {
  if (!ffmpegForHeic) throw new UserFacingError('HEIC needs FFmpeg. Install FFmpeg and re-detect in Settings → Diagnostics.')
  const tmp = join(tmpdir(), `twirly-heic-${randomBytes(6).toString('hex')}.png`)
  try {
    // One frame; FFmpeg auto-composes HEIF tile grids and applies the image's rotation.
    await execFileP(ffmpegForHeic, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', path, '-frames:v', '1', '-pix_fmt', 'rgba', tmp], {
      windowsHide: true,
      timeout: 120_000,
      signal,
    })
    return await readFile(tmp)
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new UserFacingError('The HEIC image could not be decoded.', (err as Error).message)
  } finally {
    await rm(tmp, { force: true })
  }
}

function pipeline(input: Buffer, ops: ImageOps) {
  let img = sharp(input, { failOn: 'error', animated: false }).autoOrient()
  if (ops.rotate) img = img.rotate(ops.rotate)
  if (ops.flipV) img = img.flip()
  if (ops.flipH) img = img.flop()
  if (ops.crop) img = img.extract(ops.crop)
  if (ops.resize) img = img.resize(ops.resize.width, ops.resize.height, { fit: 'fill', kernel: 'lanczos3' })
  if (!ops.stripMetadata) img = img.keepMetadata()
  return img
}

function encode(img: Sharp, format: ImageOutputFormat, ops: ImageOps): Sharp {
  const quality = ops.quality ?? DEFAULT_QUALITY[format]
  switch (format) {
    case 'jpeg':
      // JPEG has no alpha: flatten onto white rather than letting transparent pixels turn black.
      return img.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: ops.compress, chromaSubsampling: quality >= 90 ? '4:4:4' : '4:2:0' })
    case 'png':
      return ops.compress
        ? img.png({ compressionLevel: 9, palette: true, quality: ops.quality ?? 80, effort: 10 })
        : img.png({ compressionLevel: 6 })
    case 'webp':
      return img.webp({ quality, effort: ops.compress ? 6 : 4 })
    case 'avif':
      return img.avif({ quality, effort: ops.compress ? 6 : 4 })
    case 'tiff':
      return img.tiff({ compression: ops.compress ? 'deflate' : 'lzw', quality })
    case 'bmp':
      return img // encoded from raw pixels in renderImage
  }
}

/** Apply `ops` to an encoded source image and return the encoded result. Never touches disk. */
export async function renderImage(input: Buffer, ops: ImageOps, format: ImageOutputFormat): Promise<RenderedImage> {
  if (format === 'bmp') {
    const hasAlpha = (await sharp(input).metadata()).hasAlpha ?? false
    const img = pipeline(input, ops)
    const { data, info } = await (hasAlpha ? img.ensureAlpha() : img.removeAlpha()).raw().toBuffer({ resolveWithObject: true })
    const bmp = encodeBmp(info.width, info.height, info.channels as 3 | 4, data)
    return { data: Buffer.from(bmp.buffer, bmp.byteOffset, bmp.byteLength), width: info.width, height: info.height, format }
  }
  const { data, info } = await encode(pipeline(input, ops), format, ops).toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, format }
}

export interface ImageMeta {
  /** Dimensions after EXIF orientation, i.e. as the user sees the image. */
  width: number
  height: number
  hasAlpha: boolean
  format: string
}

export async function readImageMeta(input: Buffer): Promise<ImageMeta> {
  const meta = await sharp(input).metadata()
  if (!meta.width || !meta.height) throw new UserFacingError('Cannot read the image dimensions.')
  const swapped = (meta.orientation ?? 1) >= 5
  return {
    width: swapped ? meta.height : meta.width,
    height: swapped ? meta.width : meta.height,
    hasAlpha: meta.hasAlpha ?? false,
    format: meta.format ?? 'unknown',
  }
}

/** Downscaled, oriented PNG data URL for editor previews (never the full image). */
export async function previewDataUrl(input: Buffer, maxSize: number): Promise<string> {
  const data = await sharp(input, { failOn: 'error', animated: false })
    .autoOrient()
    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()
  return `data:image/webp;base64,${data.toString('base64')}`
}

/** Which of Twirly's output formats this sharp build can encode. */
export function detectImageOutputs(): ImageOutputFormat[] {
  const f = sharp.format
  const out: ImageOutputFormat[] = []
  if (f.png?.output.buffer) out.push('png')
  if (f.jpeg?.output.buffer) out.push('jpeg')
  if (f.webp?.output.buffer) out.push('webp')
  if (f.heif?.output.buffer && sharp.versions.aom) out.push('avif')
  if (f.tiff?.output.buffer) out.push('tiff')
  out.push('bmp') // built-in encoder (core/image/bmp)
  return out
}

export function detectImageInputs(): string[] {
  const f = sharp.format
  const inputs: string[] = []
  if (f.png?.input.buffer) inputs.push('png')
  if (f.jpeg?.input.buffer) inputs.push('jpeg')
  if (f.webp?.input.buffer) inputs.push('webp')
  if (f.heif?.input.buffer && sharp.versions.aom) inputs.push('avif')
  if (f.tiff?.input.buffer) inputs.push('tiff')
  if (f.gif?.input.buffer) inputs.push('gif')
  inputs.push('bmp') // built-in decoder (core/image/bmp)
  // HEIC is added by main when FFmpeg (with an HEVC decoder) is available; see configureHeicDecoder.
  return inputs
}
