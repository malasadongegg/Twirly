import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { imagesToPdf, loadPdf, merge, optimize, parsePageRanges, rebuild, rotateAll, split } from '@processing/pdf/pdf-ops'
import { OutputWriter, pageSuffix } from '@processing/output'
import { toUserFacing } from '@processing/errors'

// Tests open files by path; don't let libvips keep them locked (Windows can't delete open files).
sharp.cache(false)

const root = join(process.cwd(), 'tests', '.tmp', 'pdf-processing')

/** A PDF whose pages are labelled "Page 1".."Page n" with distinct widths (100+n pt), for identification. */
async function makePdf(path: string, pages: number) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([100 + i, 200])
    page.drawText(`Page ${i}`, { x: 10, y: 100, size: 12, font })
  }
  await writeFile(path, await doc.save())
}

const widths = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()))
const rotations = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getRotation().angle)

let three: string
let two: string

beforeAll(async () => {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  three = join(root, 'three.pdf')
  two = join(root, 'two.pdf')
  await makePdf(three, 3)
  await makePdf(two, 2)
})
afterAll(() => rm(root, { recursive: true, force: true }))

describe('PDF structure operations', () => {
  it('rebuilds with reordered, rotated and dropped pages', async () => {
    const out = await rebuild(await loadPdf(three), [
      { index: 2, rotate: 90 },
      { index: 0, rotate: 0 },
    ])
    expect(await widths(out)).toEqual([103, 101])
    expect(await rotations(out)).toEqual([90, 0])
  })

  it('rotates every page and accumulates existing rotation', async () => {
    const once = await rotateAll(await loadPdf(three), 90)
    expect(await rotations(once)).toEqual([90, 90, 90])
    const twice = await rotateAll(await PDFDocument.load(once), 270)
    expect(await rotations(twice)).toEqual([0, 0, 0])
  })

  it('splits into single-page documents in order', async () => {
    const parts = await split(await loadPdf(three))
    expect(parts).toHaveLength(3)
    expect(await Promise.all(parts.map(widths))).toEqual([[101], [102], [103]])
  })

  it('merges documents in the given order', async () => {
    const out = await merge([two, three])
    expect(await widths(out)).toEqual([101, 102, 101, 102, 103])
  })

  it('optimizes without losing pages', async () => {
    expect(await widths(await optimize(await loadPdf(three)))).toEqual([101, 102, 103])
  })

  it('rejects out-of-range pages and empty selections', async () => {
    await expect(rebuild(await loadPdf(three), [{ index: 5, rotate: 0 }])).rejects.toThrow(/does not exist/)
    await expect(rebuild(await loadPdf(three), [])).rejects.toThrow(/No pages/)
  })

  it('reports damaged PDFs readably', async () => {
    const bad = join(root, 'bad.pdf')
    await writeFile(bad, '%PDF-1.7\nthis is not a pdf')
    const err = await loadPdf(bad).catch((e) => e)
    expect(toUserFacing(err).message).toMatch(/damaged|not a valid PDF/)
  })

  it('combines images into one PDF, one page per image at pixel size', async () => {
    const a = join(root, 'a.png')
    const b = join(root, 'b.jpg')
    await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toFile(a)
    await sharp({ create: { width: 120, height: 240, channels: 3, background: '#ff0000' } }).jpeg().toFile(b)
    const out = await imagesToPdf([a, b])
    const doc = await PDFDocument.load(out)
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [300, 200],
      [120, 240],
    ])
  })
})

describe('page ranges', () => {
  it('parses 1-based inclusive ranges', () => {
    expect(parsePageRanges('1-3, 5', 6)).toEqual([0, 1, 2, 4])
    expect(parsePageRanges('4-', 6)).toEqual([3, 4, 5])
    expect(() => parsePageRanges('7', 6)).toThrow()
    expect(() => parsePageRanges('x', 6)).toThrow()
  })
})

describe('OutputWriter', () => {
  it('writes collision-safe outputs and rolls back on demand', async () => {
    const out = new OutputWriter()
    const a = await out.write(three, pageSuffix('page', 1, 12), 'pdf', new Uint8Array([1]))
    const b = await out.write(three, pageSuffix('page', 1, 12), 'pdf', new Uint8Array([2]))
    expect(a).toBe(join(root, 'three-page-01.pdf'))
    expect(b).toBe(join(root, 'three-page-01 (2).pdf'))
    expect([...(await readFile(b))]).toEqual([2])
    await out.rollbackTo(1)
    expect(out.outputs).toEqual([a])
    await expect(readFile(b)).rejects.toThrow()
  })

  it('produce() hands tools a temp path with the real extension and cleans up on failure', async () => {
    const out = new OutputWriter()
    let seen = ''
    await expect(
      out.produce(three, 'x', 'mp4', async (tmp) => {
        seen = tmp
        await writeFile(tmp, 'partial')
        throw new Error('tool failed')
      }),
    ).rejects.toThrow('tool failed')
    expect(seen.endsWith('.mp4')).toBe(true)
    await expect(readFile(seen)).rejects.toThrow()
    await expect(readFile(join(root, 'three-x.mp4'))).rejects.toThrow()
  })
})

describe('PDF crop pages', () => {
  it('sets the CropBox from margins (y up) and leaves other pages alone', async () => {
    const out = await rebuild(await loadPdf(three), [
      { index: 0, rotate: 0, crop: { left: 0.1, top: 0.25, right: 0, bottom: 0.05 } },
      { index: 1, rotate: 0 },
    ])
    const [p0, p1] = (await PDFDocument.load(out)).getPages()
    const c = p0!.getCropBox()
    expect(c.x).toBeCloseTo(10.1, 1) // 101 pt wide × 0.1
    expect(c.y).toBeCloseTo(10, 1) // 200 pt × 0.05 from the bottom
    expect(c.width).toBeCloseTo(90.9, 1)
    expect(c.height).toBeCloseTo(140, 1)
    expect(p1!.getCropBox()).toMatchObject({ x: 0, y: 0, width: 102, height: 200 })
  })

  it('refuses crops that remove the whole page', async () => {
    await expect(rebuild(await loadPdf(three), [{ index: 0, rotate: 0, crop: { left: 0.6, top: 0, right: 0.4, bottom: 0.1 } }])).rejects.toThrow(/nothing/)
  })
})

describe('compressPdf (image recompression)', () => {
  /** A photo-like 3000×2000 image: smooth gradients plus mild noise, which JPEG at q95 keeps large. */
  async function photo(format: 'jpeg' | 'png') {
    const w = 3000
    const h = 2000
    const raw = Buffer.alloc(w * h * 3)
    let seed = 7
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        const n = (seed >> 16) % 24
        const i = (y * w + x) * 3
        raw[i] = ((x * 255) / w + n) & 255
        raw[i + 1] = ((y * 255) / h + n) & 255
        raw[i + 2] = (((x + y) * 128) / (w + h) + n) & 255
      }
    const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    return format === 'jpeg' ? img.jpeg({ quality: 95 }).toBuffer() : img.png().toBuffer()
  }

  it('shrinks image-heavy PDFs, downscales big images and keeps pages', async () => {
    const { compressPdf } = await import('@processing/pdf/compress')
    const doc = await PDFDocument.create()
    const jpg = await doc.embedJpg(await photo('jpeg'))
    const png = await doc.embedPng(await photo('png'))
    doc.addPage([600, 400]).drawImage(jpg, { x: 0, y: 0, width: 600, height: 400 })
    doc.addPage([600, 400]).drawImage(png, { x: 0, y: 0, width: 600, height: 400 })
    const input = await doc.save()

    const { data, stats } = await compressPdf(input, 'balanced')
    expect(stats.imagesRecompressed).toBe(2)
    expect(data.length).toBeLessThan(input.length * 0.5)
    const out = await PDFDocument.load(data)
    expect(out.getPageCount()).toBe(2)
    // Every image is now JPEG with a 2000 px long side.
    const images = out.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'))
    expect(images).toHaveLength(2)
    for (const img of images) {
      expect(img.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'))
      expect((img.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(2000)
      // The JPEG bytes decode and match the declared size.
      const meta = await sharp(Buffer.from(img.contents)).metadata()
      expect([meta.width, meta.height]).toEqual([2000, 1333])
    }
  }, 120_000)

  it('says so honestly when there is nothing to gain', async () => {
    const { compressPdf } = await import('@processing/pdf/compress')
    await expect(compressPdf(await readFile(three))).rejects.toThrow(/no images to compress/)
  })
})

describe('compressPdf keeps transparency masks lossless', () => {
  it('recompresses the color image but leaves its SMask untouched', async () => {
    const { compressPdf } = await import('@processing/pdf/compress')
    const w = 2400
    const h = 1600
    const raw = Buffer.alloc(w * h * 4)
    let seed = 3
    for (let i = 0; i < w * h; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      raw.set([(i % w) & 255, (i / w) & 255, (seed >> 16) & 63, i % w < w / 2 ? 255 : 128], i * 4)
    }
    const doc = await PDFDocument.create()
    const png = await doc.embedPng(await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer())
    doc.addPage([600, 400]).drawImage(png, { x: 0, y: 0, width: 600, height: 400 })
    const { data } = await compressPdf(await doc.save())
    const out = await PDFDocument.load(data)
    const images = out.context.enumerateIndirectObjects().map(([, o]) => o).filter((o) => o instanceof PDFRawStream && o.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image')) as PDFRawStream[]
    const color = images.find((i) => i.dict.has(PDFName.of('SMask')))!
    const mask = images.find((i) => !i.dict.has(PDFName.of('SMask')))!
    expect(color.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'))
    expect(mask.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'))
  }, 120_000)
})
