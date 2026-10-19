import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyStrokes, configureRemoveBgModel, removeBackground } from '@processing/images/remove-bg'
import { renderWithBackground } from '@processing/images/extras'
import { backgroundSchema } from '@core/actions/image-extras'

const model = join(process.cwd(), 'vendor', 'models', 'isnet-general-use.onnx')

/** A product-style shot: a shaded orange ball on a light, slightly textured backdrop. */
async function ballPhoto(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9edf2"/><stop offset="1" stop-color="#c9d0d8"/></linearGradient>
      <radialGradient id="ball" cx="0.38" cy="0.35" r="0.7"><stop offset="0" stop-color="#ffd08a"/><stop offset="0.45" stop-color="#f97316"/><stop offset="1" stop-color="#7c2d12"/></radialGradient>
      <radialGradient id="sh" r="0.5"><stop offset="0" stop-color="rgba(0,0,0,0.35)"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></radialGradient>
    </defs>
    <rect width="640" height="480" fill="url(#bg)"/>
    <ellipse cx="320" cy="390" rx="150" ry="28" fill="url(#sh)"/>
    <circle cx="320" cy="240" r="140" fill="url(#ball)"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

const alphaAt = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * 4
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! }
}

describe.skipIf(!existsSync(model))('remove background (IS-Net)', () => {
  let photo: Buffer
  beforeAll(async () => {
    configureRemoveBgModel(model)
    photo = await ballPhoto()
  })

  it('keeps the subject and makes the backdrop transparent', async () => {
    const { png, kept } = await removeBackground(photo)
    const meta = await sharp(png).metadata()
    expect([meta.width, meta.height, meta.format, meta.hasAlpha]).toEqual([640, 480, 'png', true])
    expect((await alphaAt(png, 320, 240)).a).toBeGreaterThan(220)
    expect((await alphaAt(png, 10, 10)).a).toBeLessThan(25)
    expect((await alphaAt(png, 630, 470)).a).toBeLessThan(25)
    // The ball covers about 20% of the frame.
    expect(kept).toBeGreaterThan(0.12)
    expect(kept).toBeLessThan(0.35)
  }, 60_000)

  it('puts the cut-out subject on a new gradient, with a shadow, at full size', async () => {
    const p = backgroundSchema.parse({ from: '#22c55e', to: '#22c55e', padding: 40, shadow: 20, corners: 30, removeBg: true })
    const out = await renderWithBackground(photo, p)
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([720, 560])
    // Where the old backdrop was, the new green shows through.
    const corner = await alphaAt(out, 60, 60)
    expect([corner.r, corner.g, corner.b, corner.a]).toEqual([0x22, 0xc5, 0x5e, 255])
    const centre = await alphaAt(out, 360, 280)
    expect(centre.r).toBeGreaterThan(200) // orange ball
    expect(centre.g).toBeLessThan(180)
  }, 60_000)

  it('touch-up strokes override the automatic mask (erase part of the subject, keep part of the backdrop)', async () => {
    const { png } = await removeBackground(photo, undefined, [
      { mode: 'erase', size: 60, points: [[320, 240]] },
      { mode: 'keep', size: 40, points: [[40, 40], [100, 40]] },
    ])
    expect((await alphaAt(png, 320, 240)).a).toBe(0) // erased from the ball
    expect((await alphaAt(png, 70, 40)).a).toBe(255) // kept from the backdrop
    expect((await alphaAt(png, 320, 330)).a).toBeGreaterThan(220) // rest of the ball untouched
  }, 60_000)

  it('uses a picture as the background, scaled to cover', async () => {
    const picture = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#7c3aed' } }).png().toBuffer()
    const p = backgroundSchema.parse({ fill: 'image', image: 'C:\\pic.png', padding: 0, shadow: 30, removeBg: true, blur: 4 })
    const out = await renderWithBackground(photo, p, { backgroundImage: picture })
    const corner = await alphaAt(out, 5, 5)
    expect([corner.r, corner.g, corner.b]).toEqual([0x7c, 0x3a, 0xed])
  }, 60_000)
})

describe('touch-up strokes (no model needed)', () => {
  it('later strokes win, edges are antialiased, untouched pixels keep their value', async () => {
    const w = 100
    const h = 50
    const mask = Buffer.alloc(w * h, 128)
    const out = await applyStrokes(mask, w, h, [
      { mode: 'keep', size: 21, points: [[10, 25], [90, 25]] }, // edge at y = 35.5: half-covered row
      { mode: 'erase', size: 10, points: [[50, 25]] },
    ])
    expect(out[25 * w + 20]).toBe(255) // kept
    expect(out[25 * w + 50]).toBe(0) // erased on top of the keep stroke
    expect(out[2 * w + 2]).toBe(128) // never painted
    expect(out[35 * w + 20]).toBeGreaterThan(128) // soft edge, between
    expect(out[35 * w + 20]).toBeLessThan(255)
    expect(await applyStrokes(mask, w, h, [])).toBe(mask)
  })
})

describe('custom backgrounds (no model needed)', () => {
  it('a picture background needs a picture', async () => {
    const img = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer()
    await expect(renderWithBackground(img, backgroundSchema.parse({ fill: 'image' }))).rejects.toThrow(/Choose a picture/)
  })

  it('a custom two-color gradient runs along the chosen angle', async () => {
    const img = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer()
    // 0° = left → right: red on the left edge, blue on the right.
    const out = await renderWithBackground(img, backgroundSchema.parse({ from: '#ff0000', to: '#0000ff', angle: 0, padding: 100, shadow: 0, corners: 0 }))
    const left = await alphaAt(out, 1, 110)
    const right = await alphaAt(out, 218, 110)
    expect(left.r).toBeGreaterThan(240)
    expect(left.b).toBeLessThan(15)
    expect(right.b).toBeGreaterThan(240)
    expect(right.r).toBeLessThan(15)
  })
})
