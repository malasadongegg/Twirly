/**
 * Small BMP codec. libvips (sharp) has no BMP support, so Twirly decodes BMP to raw RGBA and
 * encodes raw pixels to BMP itself.
 *
 * Decode: BITMAPINFOHEADER and V4/V5 headers; 1/4/8-bit palettes, 16-bit (555 or bitfields),
 * 24-bit, 32-bit (BI_RGB or bitfields, with alpha when a mask says so); bottom-up and top-down.
 * RLE-compressed and embedded JPEG/PNG BMPs are rejected with a clear error.
 */

export interface RawImage {
  width: number
  height: number
  /** 4 channels: RGBA, row-major, top-down. */
  data: Uint8Array
  /** True when the file actually carried an alpha channel. */
  hasAlpha: boolean
}

export class BmpError extends Error {}

const BI_RGB = 0
const BI_RLE8 = 1
const BI_RLE4 = 2
const BI_BITFIELDS = 3
const BI_ALPHABITFIELDS = 6

/** Scale a masked channel value to 0..255. */
function channel(px: number, mask: number): number {
  if (!mask) return 0
  let shift = 0
  while (((mask >>> shift) & 1) === 0) shift++
  const max = mask >>> shift
  return Math.round((((px & mask) >>> shift) * 255) / max)
}

export function decodeBmp(buf: Uint8Array): RawImage {
  if (buf.length < 26 || buf[0] !== 0x42 || buf[1] !== 0x4d) throw new BmpError('Not a BMP file')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const pixelOffset = dv.getUint32(10, true)
  const headerSize = dv.getUint32(14, true)
  if (headerSize < 40) throw new BmpError('Unsupported BMP header (OS/2 bitmaps are not supported)')
  const width = dv.getInt32(18, true)
  const rawHeight = dv.getInt32(22, true)
  const bpp = dv.getUint16(28, true)
  const compression = dv.getUint32(30, true)
  const topDown = rawHeight < 0
  const height = Math.abs(rawHeight)
  if (width <= 0 || height <= 0 || width > 32768 || height > 32768) throw new BmpError('Invalid BMP dimensions')
  if (compression === BI_RLE8 || compression === BI_RLE4) throw new BmpError('RLE-compressed BMPs are not supported')
  if (compression !== BI_RGB && compression !== BI_BITFIELDS && compression !== BI_ALPHABITFIELDS)
    throw new BmpError('This BMP uses an unsupported compression')

  // Channel masks: in the V4/V5 header, or right after a 40-byte header for BI_BITFIELDS.
  let masks: [number, number, number, number] | null = null
  if (compression === BI_BITFIELDS || compression === BI_ALPHABITFIELDS) {
    const at = 14 + 40
    masks = [dv.getUint32(at, true), dv.getUint32(at + 4, true), dv.getUint32(at + 8, true), headerSize >= 56 || compression === BI_ALPHABITFIELDS ? dv.getUint32(at + 12, true) : 0]
  } else if (bpp === 16) {
    masks = [0x7c00, 0x03e0, 0x001f, 0]
  } else if (bpp === 32 && headerSize >= 108) {
    // V4/V5 BI_RGB 32-bit: some writers still fill the alpha mask; honour it.
    const a = dv.getUint32(14 + 52, true)
    masks = [0x00ff0000, 0x0000ff00, 0x000000ff, a]
  }

  // Palette for ≤ 8 bpp (BGRA quads after the header).
  let palette: Uint8Array | null = null
  if (bpp <= 8) {
    const colors = dv.getUint32(46, true) || 1 << bpp
    const start = 14 + headerSize
    palette = new Uint8Array(colors * 4)
    for (let i = 0; i < colors && start + i * 4 + 3 < buf.length; i++) {
      palette[i * 4] = buf[start + i * 4 + 2]!
      palette[i * 4 + 1] = buf[start + i * 4 + 1]!
      palette[i * 4 + 2] = buf[start + i * 4]!
      palette[i * 4 + 3] = 255
    }
  }

  const stride = Math.floor((bpp * width + 31) / 32) * 4
  if (pixelOffset + stride * height > buf.length) throw new BmpError('The BMP file is truncated')

  const out = new Uint8Array(width * height * 4)
  let anyAlpha = false
  for (let y = 0; y < height; y++) {
    const row = pixelOffset + (topDown ? y : height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      let r: number, g: number, b: number
      let a = 255
      if (bpp === 24) {
        const p = row + x * 3
        b = buf[p]!
        g = buf[p + 1]!
        r = buf[p + 2]!
      } else if (bpp === 32 || bpp === 16) {
        const px = bpp === 32 ? dv.getUint32(row + x * 4, true) : dv.getUint16(row + x * 2, true)
        const m = masks ?? [0x00ff0000, 0x0000ff00, 0x000000ff, 0]
        r = channel(px, m[0])
        g = channel(px, m[1])
        b = channel(px, m[2])
        if (m[3]) {
          a = channel(px, m[3])
          if (a !== 255) anyAlpha = true
        }
      } else if (bpp === 8 || bpp === 4 || bpp === 1) {
        const bit = x * bpp
        const byte = buf[row + (bit >> 3)]!
        const idx = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1)
        r = palette![idx * 4] ?? 0
        g = palette![idx * 4 + 1] ?? 0
        b = palette![idx * 4 + 2] ?? 0
      } else {
        throw new BmpError(`${bpp}-bit BMPs are not supported`)
      }
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
      out[o + 3] = a
    }
  }
  // A 32-bit file whose alpha is entirely 0 is really opaque (common in old writers).
  if (anyAlpha && masks?.[3]) {
    let allZero = true
    for (let i = 3; i < out.length; i += 4) if (out[i] !== 0) {
      allZero = false
      break
    }
    if (allZero) {
      for (let i = 3; i < out.length; i += 4) out[i] = 255
      anyAlpha = false
    }
  }
  return { width, height, data: out, hasAlpha: anyAlpha }
}

/**
 * Encode raw pixels (3 = RGB or 4 = RGBA channels, top-down) as a bottom-up BMP: 24-bit for
 * opaque images, 32-bit BITMAPV4 with an alpha mask when alpha is present.
 */
export function encodeBmp(width: number, height: number, channels: 3 | 4, data: Uint8Array): Uint8Array {
  const withAlpha = channels === 4
  const bpp = withAlpha ? 32 : 24
  const headerSize = withAlpha ? 108 : 40
  const stride = Math.floor((bpp * width + 31) / 32) * 4
  const pixelOffset = 14 + headerSize
  const size = pixelOffset + stride * height
  const out = new Uint8Array(size)
  const dv = new DataView(out.buffer)
  out[0] = 0x42
  out[1] = 0x4d
  dv.setUint32(2, size, true)
  dv.setUint32(10, pixelOffset, true)
  dv.setUint32(14, headerSize, true)
  dv.setInt32(18, width, true)
  dv.setInt32(22, height, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, bpp, true)
  dv.setUint32(30, withAlpha ? BI_BITFIELDS : BI_RGB, true)
  dv.setUint32(34, stride * height, true)
  dv.setInt32(38, 2835, true) // 72 dpi
  dv.setInt32(42, 2835, true)
  if (withAlpha) {
    dv.setUint32(54, 0x00ff0000, true)
    dv.setUint32(58, 0x0000ff00, true)
    dv.setUint32(62, 0x000000ff, true)
    dv.setUint32(66, 0xff000000, true)
    dv.setUint32(70, 0x73524742, true) // 'sRGB'
  }
  for (let y = 0; y < height; y++) {
    const row = pixelOffset + (height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const p = row + x * (bpp / 8)
      out[p] = data[i + 2]!
      out[p + 1] = data[i + 1]!
      out[p + 2] = data[i]!
      if (withAlpha) out[p + 3] = data[i + 3]!
    }
  }
  return out
}
