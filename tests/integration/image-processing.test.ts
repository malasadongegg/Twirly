import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inspectPath } from '@processing/fs/inspect'
import { runImageAction } from '@processing/images/image-job'
import { reserveOutputPath } from '@processing/fs/atomic'
import { toUserFacing } from '@processing/errors'
import { detectImageInputs, detectImageOutputs } from '@processing/images/process'
import type { FileInfo } from '@shared/types'

// Tests open files by path; don't let libvips keep them locked (Windows can't delete open files).
sharp.cache(false)

const root = join(process.cwd(), 'tests', '.tmp', 'image-processing')
const sha = async (p: string) => createHash('sha256').update(await readFile(p)).digest('hex')

async function info(path: string): Promise<FileInfo> {
  const r = await inspectPath(path)
  if ('reason' in r) throw new Error(r.reason)
  return r
}

/** 64×32 RGBA: left half opaque red, right half fully transparent. */
async function makeAlphaPng(path: string) {
  const w = 64,
    h = 32
  const raw = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (x < w / 2) raw.set([255, 0, 0, 255], i)
      else raw.set([0, 0, 255, 0], i)
    }
  // Write through Node, not libvips: libvips cannot open >260-char paths on Windows.
  await writeFile(path, await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer())
}

/** 40×20 JPEG stored sideways with EXIF orientation 6 and a camera tag. */
async function makeRotatedJpeg(path: string) {
  await sharp({ create: { width: 40, height: 20, channels: 3, background: '#3366cc' } })
    .withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Make: 'TwirlyTestCam' } })
    .jpeg()
    .toFile(path)
}

let alphaPng: string
let rotatedJpg: string

beforeAll(async () => {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  alphaPng = join(root, 'alpha.png')
  rotatedJpg = join(root, 'rotated.jpg')
  await makeAlphaPng(alphaPng)
  await makeRotatedJpeg(rotatedJpg)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const run = async (actionId: string, path: string, params: Record<string, unknown> = {}, suffix = 'converted', signal?: AbortSignal) =>
  runImageAction({ actionId, suffix, file: await info(path), params, signal })

describe('capability detection', () => {
  it('reports what the bundled sharp can actually do', () => {
    expect(detectImageOutputs()).toEqual(expect.arrayContaining(['png', 'jpeg', 'webp', 'avif', 'tiff', 'bmp']))
    expect(detectImageInputs()).not.toContain('heic')
    expect(detectImageInputs()).toContain('bmp') // built-in codec
  })
})

describe('format conversion', () => {
  it('PNG → JPG writes a real JPEG beside the source, flattening transparency onto white', async () => {
    const before = await sha(alphaPng)
    const out = await run('image.convert.jpeg', alphaPng)
    expect(out).toBe(join(root, 'alpha-converted.jpg'))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect([meta.width, meta.height]).toEqual([64, 32])
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => [...data.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3)]
    expect(px(48, 16).every((v) => v > 245)).toBe(true) // former transparent half is white
    expect(px(8, 16)[0]).toBeGreaterThan(230) // red stays red
    expect(await sha(alphaPng)).toBe(before) // source untouched
  })

  it('PNG → WEBP preserves transparency', async () => {
    const out = await run('image.convert.webp', alphaPng)
    const { data, info: i } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect((await sharp(out).metadata()).format).toBe('webp')
    expect(data[(16 * i.width + 48) * 4 + 3]).toBe(0)
    expect(data[(16 * i.width + 8) * 4 + 3]).toBe(255)
  })

  it.each([
    ['image.convert.avif', 'heif', 'avif'],
    ['image.convert.tiff', 'tiff', 'tiff'],
    ['image.convert.png', 'png', 'png'],
  ])('%s produces a decodable file', async (action, sharpFormat, ext) => {
    const out = await run(action, rotatedJpg)
    expect(out.endsWith(`.${ext}`)).toBe(true)
    expect((await sharp(out).metadata()).format).toBe(sharpFormat)
  })

  it('applies EXIF orientation so the output looks like the original did', async () => {
    const out = await run('image.convert.webp', rotatedJpg)
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([20, 40])
    expect(meta.orientation ?? 1).toBe(1)
  })

  it('keeps EXIF on conversion but removes it with Strip metadata', async () => {
    const kept = await sharp(await run('image.convert.png', rotatedJpg)).metadata()
    expect(kept.exif?.toString('latin1')).toContain('TwirlyTestCam')
    const clean = await sharp(await run('image.strip-metadata', rotatedJpg, {}, 'clean')).metadata()
    expect(clean.exif).toBeUndefined()
  })
})

describe('BMP (built-in codec)', () => {
  it('PNG → BMP keeps transparency and is readable by an independent decoder (FFmpeg)', async () => {
    const out = await run('image.convert.bmp', alphaPng)
    expect(out.endsWith('.bmp')).toBe(true)
    const { execFileSync } = await import('node:child_process')
    let probed: string | null = null
    try {
      probed = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,pix_fmt', '-of', 'csv=p=0', out]).toString().trim()
    } catch {
      // FFmpeg not installed: our own decoder check below still runs.
    }
    if (probed !== null) expect(probed).toBe('bmp,64,32,bgra')
    const back = await run('image.convert.png', out)
    const { data, info } = await sharp(back).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([64, 32])
    expect([...data.subarray(0, 4)]).toEqual([255, 0, 0, 255])
    expect(data[(16 * 64 + 48) * 4 + 3]).toBe(0)
  })

  it('BMP sources work with every image action (crop example)', async () => {
    const bmp = await run('image.convert.bmp', rotatedJpg) // 20×40 opaque → 24-bit BMP
    const cropped = await run('image.crop', bmp, { crop: { left: 0, top: 0, width: 10, height: 10 }, format: 'webp' }, 'cropped')
    const meta = await sharp(cropped).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 10, 10])
  })
})

describe('edits', () => {
  it('crops in displayed (oriented) coordinates', async () => {
    const out = await run('image.crop', alphaPng, { crop: { left: 30, top: 0, width: 4, height: 10 } }, 'cropped')
    const { data, info: i } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect([i.width, i.height]).toEqual([4, 10])
    expect(data[3]).toBe(255) // x=30 is in the opaque half
    expect(data[(3 + 0) * 4 + 3]).toBe(0) // x=33 is transparent
  })

  it('resizes to exact dimensions and can change format', async () => {
    const out = await run('image.resize', alphaPng, { resize: { width: 32, height: 16 }, format: 'jpeg' }, 'resized')
    const meta = await sharp(out).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 32, 16])
  })

  it('rotates 90° clockwise', async () => {
    const meta = await sharp(await run('image.rotate', alphaPng, {}, 'rotated')).metadata()
    expect([meta.width, meta.height]).toEqual([32, 64])
  })

  it('compresses JPEG to a smaller file', async () => {
    const big = join(root, 'noise.jpg')
    const noise = Buffer.alloc(256 * 256 * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24
    await sharp(noise, { raw: { width: 256, height: 256, channels: 3 } }).jpeg({ quality: 100 }).toFile(big)
    const out = await run('image.compress', big, {}, 'compressed')
    expect((await readFile(out)).length).toBeLessThan((await readFile(big)).length)
  })

  it('rejects a crop outside the image with a readable message', async () => {
    await expect(run('image.crop', alphaPng, { crop: { left: 60, top: 0, width: 50, height: 10 } }, 'cropped')).rejects.toSatisfy(
      (e) => toUserFacing(e).message === 'The crop area is outside the image.',
    )
  })
})

describe('file safety', () => {
  it('never overwrites: repeated runs get collision-safe names', async () => {
    const dir = join(root, 'collide')
    await mkdir(dir)
    const src = join(dir, 'p.png')
    await makeAlphaPng(src)
    const a = await run('image.convert.webp', src)
    const b = await run('image.convert.webp', src)
    expect(a).toBe(join(dir, 'p-converted.webp'))
    expect(b).toBe(join(dir, 'p-converted (2).webp'))
  })

  it('reserves names atomically under concurrency', async () => {
    const dir = join(root, 'race')
    await mkdir(dir)
    const paths = await Promise.all(Array.from({ length: 10 }, () => reserveOutputPath(dir, 'x.png')))
    expect(new Set(paths).size).toBe(10)
  })

  it('handles Unicode file names', async () => {
    const src = join(root, '写真 ☀ ñ.png')
    await makeAlphaPng(src)
    const out = await run('image.convert.jpeg', src)
    expect(out).toBe(join(root, '写真 ☀ ñ-converted.jpg'))
    expect((await sharp(out).metadata()).format).toBe('jpeg')
  })

  it('handles paths longer than MAX_PATH (260)', async () => {
    let dir = root
    while (dir.length < 300) dir = join(dir, 'a-very-long-directory-name-segment')
    await mkdir(dir, { recursive: true })
    const src = join(dir, 'long.png')
    await makeAlphaPng(src)
    expect(src.length).toBeGreaterThan(260)
    const out = await run('image.convert.webp', src)
    expect((await sharp(await readFile(out)).metadata()).format).toBe('webp')
  })

  it('reports corrupted images and leaves no output or temp files behind', async () => {
    const dir = join(root, 'corrupt')
    await mkdir(dir)
    const src = join(dir, 'broken.png')
    const good = await readFile(alphaPng)
    await writeFile(src, good.subarray(0, 60)) // valid signature, truncated body
    const err = await run('image.convert.jpeg', src).catch((e) => e)
    expect(toUserFacing(err).message).toMatch(/corrupted|unsupported/)
    expect(await readdir(dir)).toEqual(['broken.png'])
  })

  it('cancellation leaves no output or temp files behind', async () => {
    const dir = join(root, 'cancel')
    await mkdir(dir)
    const src = join(dir, 'c.png')
    await makeAlphaPng(src)
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(run('image.convert.jpeg', src, {}, 'converted', ctrl.signal)).rejects.toThrow()
    expect(await readdir(dir)).toEqual(['c.png'])
  })
})

describe('.jfif → .jpg', () => {
  it('copies the JPEG bytes losslessly into a .jpg', async () => {
    const jfif = join(root, 'photo.jfif')
    const bytes = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#123456' } }).jpeg({ quality: 70 }).toBuffer()
    await writeFile(jfif, bytes)
    const out = await runImageAction({ actionId: 'image.convert.jpeg', suffix: 'converted', file: await info(jfif), params: { quality: 88 } })
    expect(out.endsWith('photo-converted.jpg')).toBe(true)
    expect(Buffer.compare(await readFile(out), bytes)).toBe(0)
  })
})
