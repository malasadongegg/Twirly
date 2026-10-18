import { describe, expect, it } from 'vitest'
import { BmpError, decodeBmp, encodeBmp } from '@core/image/bmp'

/** 3×2 RGBA test pattern with distinct pixels. */
const W = 3
const H = 2
const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255, 40, 50, 60, 128, 250, 240, 230, 0])
const rgb = new Uint8Array(W * H * 3)
for (let i = 0; i < W * H; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3)

/** Hand-build a BITMAPINFOHEADER BMP with the given pixel rows (already padded, bottom-up unless topDown). */
function buildBmp(opts: { bpp: number; width: number; height: number; rows: number[][]; palette?: number[][]; compression?: number; masks?: number[] }): Uint8Array {
  const paletteBytes = (opts.palette?.length ?? 0) * 4
  const maskBytes = opts.masks ? opts.masks.length * 4 : 0
  const pixelOffset = 14 + 40 + maskBytes + paletteBytes
  const body = opts.rows.flat()
  const out = new Uint8Array(pixelOffset + body.length)
  const dv = new DataView(out.buffer)
  out.set([0x42, 0x4d])
  dv.setUint32(2, out.length, true)
  dv.setUint32(10, pixelOffset, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, opts.width, true)
  dv.setInt32(22, opts.height, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, opts.bpp, true)
  dv.setUint32(30, opts.compression ?? 0, true)
  dv.setUint32(46, opts.palette?.length ?? 0, true)
  let p = 54
  for (const m of opts.masks ?? []) {
    dv.setUint32(p, m, true)
    p += 4
  }
  for (const [r, g, b] of opts.palette ?? []) {
    out.set([b!, g!, r!, 0], p)
    p += 4
  }
  out.set(body, pixelOffset)
  return out
}

describe('BMP codec', () => {
  it('round-trips 24-bit RGB exactly', () => {
    const d = decodeBmp(encodeBmp(W, H, 3, rgb))
    expect([d.width, d.height, d.hasAlpha]).toEqual([W, H, false])
    for (let i = 0; i < W * H; i++) expect([...d.data.subarray(i * 4, i * 4 + 3)]).toEqual([...rgb.subarray(i * 3, i * 3 + 3)])
  })

  it('round-trips 32-bit RGBA including alpha', () => {
    const d = decodeBmp(encodeBmp(W, H, 4, rgba))
    expect(d.hasAlpha).toBe(true)
    expect([...d.data]).toEqual([...rgba])
  })

  it('pads rows to 4 bytes', () => {
    const bmp = encodeBmp(W, H, 3, rgb) // 3 px × 3 B = 9 → stride 12
    expect(bmp.length).toBe(54 + 12 * H)
  })

  it('decodes 8-bit palettized, bottom-up', () => {
    const bmp = buildBmp({
      bpp: 8,
      width: 2,
      height: 2,
      palette: [
        [0, 0, 0],
        [255, 255, 255],
        [255, 0, 0],
      ],
      rows: [
        [2, 1, 0, 0], // bottom row: red, white
        [1, 0, 0, 0], // top row: white, black
      ],
    })
    const d = decodeBmp(bmp)
    expect([...d.data]).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255])
  })

  it('decodes 1-bit and top-down images', () => {
    const bmp = buildBmp({
      bpp: 1,
      width: 3,
      height: -1,
      palette: [
        [0, 0, 0],
        [255, 255, 255],
      ],
      rows: [[0b10100000, 0, 0, 0]],
    })
    const d = decodeBmp(bmp)
    expect([d.data[0], d.data[4], d.data[8]]).toEqual([255, 0, 255])
  })

  it('decodes 16-bit RGB565 bitfields', () => {
    const bmp = buildBmp({ bpp: 16, width: 2, height: 1, compression: 3, masks: [0xf800, 0x07e0, 0x001f], rows: [[0x00, 0xf8, 0x1f, 0x00]] })
    const d = decodeBmp(bmp)
    expect([...d.data.subarray(0, 3)]).toEqual([255, 0, 0])
    expect([...d.data.subarray(4, 7)]).toEqual([0, 0, 255])
  })

  it('rejects RLE, truncated and non-BMP data with clear errors', () => {
    expect(() => decodeBmp(buildBmp({ bpp: 8, width: 1, height: 1, compression: 1, palette: [[0, 0, 0]], rows: [[0, 0, 0, 0]] }))).toThrow(/RLE/)
    expect(() => decodeBmp(encodeBmp(W, H, 3, rgb).subarray(0, 60))).toThrow(BmpError)
    expect(() => decodeBmp(new Uint8Array([1, 2, 3]))).toThrow(/Not a BMP/)
  })
})
