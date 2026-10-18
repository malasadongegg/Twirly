import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { backgroundCanvas, backgroundSchema, redactSchema } from '@core/actions/image-extras'
import { renderRedacted, renderWithBackground } from '@processing/images/extras'
import { readExif } from '@core/image/exif'

// Tests open files by path; don't let libvips keep them locked (Windows can't delete open files).
sharp.cache(false)

const solid = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer()

describe('background canvas geometry', () => {
  it('adds padding and grows to the ratio without cropping', () => {
    expect(backgroundCanvas(100, 50, { padding: 10, ratio: 'auto' })).toEqual({ width: 120, height: 70 })
    expect(backgroundCanvas(100, 50, { padding: 10, ratio: '1:1' })).toEqual({ width: 120, height: 120 })
    expect(backgroundCanvas(100, 50, { padding: 0, ratio: '4:5' })).toEqual({ width: 100, height: 125 })
  })
})

describe('renderWithBackground', () => {
  it('centers the image on the gradient with rounded corners', async () => {
    const out = await renderWithBackground(await solid(200, 100, '#ff0000'), backgroundSchema.parse({ padding: 50, corners: 30, shadow: 0, from: '#0000ff', to: '#0000ff' }))
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([300, 200])
    const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
    expect(px(150, 100)).toEqual([255, 0, 0]) // image center
    expect(px(10, 10)).toEqual([0, 0, 255]) // background
    expect(px(51, 51)[2]).toBeGreaterThan(200) // rounded-off image corner shows background
  })
})

describe('renderRedacted (secure redaction)', () => {
  it('replaces pixels in the regions and strips every bit of metadata', async () => {
    const src = await sharp({ create: { width: 100, height: 60, channels: 3, background: '#33aa77' } })
      .withExif({ IFD0: { Make: 'SecretCam', Artist: 'Jane Doe' } })
      .jpeg({ quality: 95 })
      .toBuffer()
    expect((await sharp(src).metadata()).exif).toBeDefined()
    const out = await renderRedacted(src, redactSchema.parse({ regions: [{ left: 10, top: 10, width: 30, height: 20 }] }), 'png')
    const meta = await sharp(out).metadata()
    expect(meta.exif).toBeUndefined()
    expect(meta.xmp).toBeUndefined()
    expect(meta.icc).toBeUndefined()
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    for (const [x, y] of [
      [10, 10],
      [39, 29],
      [25, 20],
    ])
      expect([...data.subarray((y! * info.width + x!) * info.channels, (y! * info.width + x!) * info.channels + 3)]).toEqual([0, 0, 0])
    // Outside the region the image is untouched (allowing JPEG source noise).
    expect(data[(50 * info.width + 80) * info.channels + 1]).toBeGreaterThan(150)
    expect(Buffer.from(out).includes(Buffer.from('SecretCam'))).toBe(false)
  })

  it('makes redacted areas opaque on transparent images', async () => {
    const src = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const out = await renderRedacted(src, redactSchema.parse({ regions: [{ left: 0, top: 0, width: 5, height: 5 }], fill: 'white' }), 'png')
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    expect([...data.subarray(0, 4)]).toEqual([255, 255, 255, 255])
  })
})

describe('readExif', () => {
  it('reads camera and author fields written by libexif', async () => {
    const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .withExif({ IFD0: { Make: 'TwirlyCam', Model: 'Z9', Artist: 'Sam', Software: 'Twirly test' } })
      .jpeg()
      .toBuffer()
    const { fields } = readExif((await sharp(jpg).metadata()).exif)
    const get = (label: string) => fields.find((f) => f.label === label)?.value
    expect(get('Make')).toBe('TwirlyCam')
    expect(get('Model')).toBe('Z9')
    expect(get('Artist')).toBe('Sam')
    expect(get('Software')).toBe('Twirly test')
  })

  it('decodes GPS coordinates with hemisphere signs', () => {
    // Hand-built little-endian TIFF: IFD0 with a GPS pointer; GPS IFD with S latitude / W longitude.
    const buf = new Uint8Array(200)
    const dv = new DataView(buf.buffer)
    buf.set([0x49, 0x49], 0)
    dv.setUint16(2, 42, true)
    dv.setUint32(4, 8, true)
    // IFD0 @8: 1 entry → GPS pointer (0x8825, LONG) → 26
    dv.setUint16(8, 1, true)
    dv.setUint16(10, 0x8825, true)
    dv.setUint16(12, 4, true)
    dv.setUint32(14, 1, true)
    dv.setUint32(18, 26, true)
    dv.setUint32(22, 0, true)
    // GPS IFD @26: 4 entries
    dv.setUint16(26, 4, true)
    const entry = (i: number, tag: number, type: number, count: number, value: number) => {
      const e = 28 + i * 12
      dv.setUint16(e, tag, true)
      dv.setUint16(e + 2, type, true)
      dv.setUint32(e + 4, count, true)
      dv.setUint32(e + 8, value, true)
    }
    entry(0, 0x0001, 2, 2, 0x53) // "S"
    entry(1, 0x0002, 5, 3, 100) // lat rationals @100
    entry(2, 0x0003, 2, 2, 0x57) // "W"
    entry(3, 0x0004, 5, 3, 124) // lon rationals @124
    const rat = (off: number, vals: [number, number][]) => vals.forEach(([n, d], i) => (dv.setUint32(off + i * 8, n, true), dv.setUint32(off + i * 8 + 4, d, true)))
    rat(100, [
      [33, 1],
      [52, 1],
      [30, 1],
    ])
    rat(124, [
      [151, 1],
      [12, 1],
      [36, 1],
    ])
    const { gps } = readExif(buf)
    expect(gps?.lat).toBeCloseTo(-33.875, 3)
    expect(gps?.lon).toBeCloseTo(-151.21, 2)
  })

  it('survives garbage and truncation', () => {
    expect(readExif(new Uint8Array([1, 2, 3])).fields).toEqual([])
    expect(readExif(new Uint8Array(64).fill(0x49)).fields).toEqual([])
    expect(readExif(undefined).fields).toEqual([])
  })
})

describe('renderAnnotated', () => {
  it('burns shapes and text into the pixels at full resolution', async () => {
    const { renderAnnotated } = await import('@processing/images/extras')
    const { annotateSchema } = await import('@core/image/annotate')
    const src = await solid(200, 120, '#ffffff')
    const { shapes } = annotateSchema.parse({
      shapes: [
        { type: 'rect', from: { x: 10, y: 10 }, to: { x: 60, y: 50 }, color: '#ff0000', width: 4 },
        { type: 'arrow', from: { x: 100, y: 100 }, to: { x: 180, y: 100 }, color: '#0000ff', width: 6 },
        { type: 'highlight', from: { x: 120, y: 10 }, to: { x: 190, y: 40 }, color: '#ffff00', width: 1 },
        { type: 'text', at: { x: 70, y: 60 }, text: 'Hi', color: '#00aa00', size: 30 },
      ],
    })
    const out = await renderAnnotated(src, shapes, 'png')
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([200, 120])
    const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
    expect(px(10, 30)).toEqual([255, 0, 0]) // rect stroke
    expect(px(35, 30)).toEqual([255, 255, 255]) // rect interior untouched
    expect(px(140, 100)[2]).toBeGreaterThan(200) // arrow shaft
    expect(px(140, 100)[0]).toBeLessThan(60)
    const hl = px(150, 25)
    expect(hl[0]).toBe(255) // yellow at 35% over white
    expect(hl[2]).toBeLessThan(200)
    // Text: some green-ish or dark-outline pixels must exist in the text box.
    let inked = 0
    for (let y = 60; y < 95; y++) for (let x = 70; x < 110; x++) if (px(x, y)[0]! < 200) inked++
    expect(inked).toBeGreaterThan(30)
  })

  it('escapes text so it cannot inject SVG', async () => {
    const { annotationsSvg } = await import('@core/image/annotate')
    const svg = annotationsSvg([{ type: 'text', at: { x: 0, y: 0 }, text: '<image href="file:///C:/x"/>', color: '#000000', size: 10 }], 10, 10)
    expect(svg).not.toContain('<image')
    expect(svg).toContain('&lt;image')
  })
})
