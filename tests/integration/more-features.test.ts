import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractMatching, extractZip, zipPaths } from '@processing/archive/zip'
import { extractPdfImages } from '@processing/pdf/extract-images'
import { readText, textToDocx, textToPdf } from '@processing/text/text-docs'
import { sha256File } from '@processing/fs/checksum'
import { officeToPdf } from '@processing/office/convert'
import { inspectPath } from '@processing/fs/inspect'
import { zip as storeZip } from '@core/docx/zip'
import { buildDocx } from '@core/docx/docx'
import { fitPassArgs, planFitSize } from '@core/actions/media-plan'
import { probeMedia, runFfmpeg } from '@processing/media/ffmpeg'
import type { FileInfo } from '@shared/types'

sharp.cache(false)
const root = join(process.cwd(), 'tests', '.tmp', 'more-features')
const enc = new TextEncoder()

beforeAll(async () => {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
})
afterAll(() => rm(root, { recursive: true, force: true }))

/** Patch the first central-directory entry of a stored ZIP built by core/docx/zip. */
function patchCentral(buf: Uint8Array, patch: (dv: DataView, at: number) => void): Uint8Array {
  const out = new Uint8Array(buf)
  const dv = new DataView(out.buffer)
  for (let i = 0; i < out.length - 4; i++) if (dv.getUint32(i, true) === 0x02014b50) {
    patch(dv, i)
    break
  }
  return out
}

describe('folders and archives', () => {
  it('inspects folders as their own kind', async () => {
    const info = (await inspectPath(root)) as FileInfo
    expect([info.kind, info.format]).toEqual(['folder', 'folder'])
  })

  it('zips a folder tree plus a loose file and extracts it back identically', async () => {
    const src = join(root, 'Holiday')
    await mkdir(join(src, 'day 1', 'empty'), { recursive: true })
    await writeFile(join(src, 'day 1', 'notes ñ.txt'), 'beach!')
    await writeFile(join(src, 'list.csv'), 'a,b\n1,2\n')
    const loose = join(root, 'readme.txt')
    await writeFile(loose, 'hello')
    const zipFile = join(root, 'bundle.zip')
    await zipPaths([src, loose], zipFile)
    expect(((await inspectPath(zipFile)) as FileInfo).kind).toBe('archive')

    const { folder, files } = await extractZip(zipFile)
    expect(folder).toBe(join(root, 'bundle'))
    expect(files).toBe(3)
    expect(await readFile(join(folder, 'Holiday', 'day 1', 'notes ñ.txt'), 'utf8')).toBe('beach!')
    expect(await readFile(join(folder, 'readme.txt'), 'utf8')).toBe('hello')
    expect((await stat(join(folder, 'Holiday', 'day 1', 'empty'))).isDirectory()).toBe(true)
  })

  it('recreates a single top-level folder instead of nesting it, and never overwrites', async () => {
    const src = join(root, 'Project')
    await mkdir(src)
    await writeFile(join(src, 'a.txt'), 'a')
    const zipFile = join(root, 'project-backup.zip')
    await zipPaths([src], zipFile)
    const first = await extractZip(zipFile)
    expect(first.folder).toBe(join(root, 'Project (2)')) // "Project" already exists
    expect(await readFile(join(first.folder, 'a.txt'), 'utf8')).toBe('a')
  })

  it('refuses path traversal ("zip slip") and writes nothing outside', async () => {
    const evil = join(root, 'evil.zip')
    await writeFile(evil, storeZip([{ name: '../escaped.txt', data: enc.encode('pwned') }]))
    await expect(extractZip(evil)).rejects.toThrow(/unsafe|damaged/)
    expect(existsSync(join(root, '..', 'escaped.txt'))).toBe(false)
    expect(existsSync(join(root, 'evil'))).toBe(false)
  })

  it('refuses archives that claim to expand to an unsafe size (zip bomb)', async () => {
    const big = new Uint8Array(1000)
    const bomb = patchCentral(storeZip([{ name: 'big.bin', data: big }]), (dv, at) => {
      dv.setUint32(at + 20, 1000, true) // compressed: 1 kB
      dv.setUint32(at + 24, 0xfffffff0, true) // claims ~4 GB uncompressed
    })
    const path = join(root, 'bomb.zip')
    await writeFile(path, bomb)
    await expect(extractZip(path)).rejects.toThrow(/unsafe size|damaged/)
    expect(existsSync(join(root, 'bomb'))).toBe(false)
  })

  it('refuses password-protected entries', async () => {
    const locked = patchCentral(storeZip([{ name: 'secret.txt', data: enc.encode('x') }]), (dv, at) => dv.setUint16(at + 8, 0x0801, true))
    const path = join(root, 'locked.zip')
    await writeFile(path, locked)
    await expect(extractZip(path)).rejects.toThrow(/Password-protected|damaged/)
  })

  it('renames Windows-reserved names', async () => {
    const path = join(root, 'reserved.zip')
    await writeFile(path, storeZip([{ name: 'CON.txt', data: enc.encode('c') }, { name: 'ok.txt', data: enc.encode('o') }]))
    const { folder } = await extractZip(path)
    expect((await readdir(folder)).sort()).toEqual(['_CON.txt', 'ok.txt'])
  })
})

describe('extract images', () => {
  it('pulls JPEGs out of a PDF byte-for-byte and keeps PNG transparency', async () => {
    const jpg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#ff0000' } }).jpeg().toBuffer()
    const rgba = Buffer.alloc(40 * 40 * 4)
    for (let i = 0; i < 40 * 40; i++) rgba.set([0, 128, 255, i % 40 < 20 ? 255 : 0], i * 4)
    const png = await sharp(rgba, { raw: { width: 40, height: 40, channels: 4 } }).png().toBuffer()
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 300])
    page.drawImage(await doc.embedJpg(jpg), { x: 10, y: 10, width: 64, height: 48 })
    page.drawImage(await doc.embedPng(png), { x: 100, y: 100, width: 40, height: 40 })
    const dest = join(root, 'pdf-images')
    await mkdir(dest)
    const { written, skipped } = await extractPdfImages(await doc.save(), dest)
    expect(skipped).toBe(0)
    expect(written.map((p) => p.slice(-4)).sort()).toEqual(['.jpg', '.png'])
    expect(Buffer.compare(await readFile(written.find((p) => p.endsWith('.jpg'))!), jpg)).toBe(0)
    const meta = await sharp(written.find((p) => p.endsWith('.png'))!).metadata()
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([40, 40, true])
  })

  it('pulls media out of DOCX/PPTX packages', async () => {
    const img = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#0f0' } }).png().toBuffer()
    const docx = join(root, 'report.docx')
    await writeFile(docx, storeZip([{ name: 'word/document.xml', data: enc.encode('<x/>') }, { name: 'word/media/image1.png', data: img }, { name: 'word/media/image2.png', data: img }]))
    const dest = join(root, 'docx-images')
    await mkdir(dest)
    const out = await extractMatching(docx, (n) => /^(word|ppt|xl)\/media\//.test(n), dest)
    expect(out.map((p) => p.split(/[\\/]/).pop()).sort()).toEqual(['image1.png', 'image2.png'])
  })
})

describe('text and checksums', () => {
  it('turns Unicode text into a paginated PDF with an embedded font', async () => {
    const text = `Kumusta, mañana — ₱100 ✓\n` + Array.from({ length: 120 }, (_, i) => `Line ${i + 1}: the quick brown fox jumps over the lazy dog.`).join('\n')
    const pdf = await textToPdf(text, 'txt', 'notes.txt')
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBeGreaterThan(1)
    // A TrueType font program is embedded (FontFile2), so any Unicode text renders anywhere.
    const embedded = doc.context.enumerateIndirectObjects().some(([, o]) => 'dict' in o && (o as unknown as { dict: { has(k: unknown): boolean } }).dict.has(PDFName.of('FontFile2')))
    const descriptors = doc.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFDict && o.has(PDFName.of('FontFile2')))
    expect(embedded || descriptors).toBe(true)
  })

  it('keeps Markdown headings as Word headings', async () => {
    const docx = textToDocx('# Title\n\nSome text\n\n## Part\n- item', 'md', 'notes')
    const xml = new TextDecoder().decode(docx)
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>')
    expect(xml).toContain('• item')
  })

  it('reads legacy Windows-1252 files', async () => {
    const p = join(root, 'legacy.txt')
    await writeFile(p, Buffer.from([0x63, 0x61, 0x66, 0xe9])) // "café" in 1252
    expect(await readText(p)).toBe('café')
  })

  it('computes SHA-256', async () => {
    const p = join(root, 'hash.txt')
    await writeFile(p, 'abc')
    expect(await sha256File(p)).toBe(createHash('sha256').update('abc').digest('hex'))
  })
})

const hasWord = process.platform === 'win32' && (() => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', 'try { $w = New-Object -ComObject Word.Application; $w.Quit(); "yes" } catch { "no" }'], { encoding: 'utf8' }).trim() === 'yes'
  } catch {
    return false
  }
})()

describe.runIf(hasWord)('Office → PDF (real Microsoft Word)', () => {
  it('converts a DOCX to a real PDF', async () => {
    const docx = join(root, 'letter.docx')
    await writeFile(docx, buildDocx([{ width: 612, height: 792, paragraphs: [{ text: 'Hello from Word', heading: 1 }, { text: 'Converted by Twirly.', heading: 0 }] }], 'Letter'))
    const out = join(root, 'letter.pdf')
    await officeToPdf('word', docx, out)
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(1)
  }, 120_000)
})

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe('fit to size planning', () => {
  const info = { durationSec: 60, formatName: 'mp4', sizeBytes: 0, bitRate: null, video: { codec: 'h264', width: 1920, height: 1080, fps: 30 }, audio: { codec: 'aac', sampleRate: 48000, channels: 2, bitRate: 128000 } }
  it('budgets bitrate from size and length and steps down resolution', () => {
    const p = planFitSize(info, 25 * 1024 * 1024, 200e6)
    expect(p.videoKbps).toBe(Math.floor((25 * 1024 * 1024 * 8 * 0.94) / 60 / 1000 - 96))
    expect(p.height).toBe(1080 > 720 && p.videoKbps < 2000 ? (p.videoKbps < 900 ? 480 : 720) : undefined)
    expect(() => planFitSize(info, 25 * 1024 * 1024, 10e6)).toThrow(/Already under/)
    expect(() => planFitSize({ ...info, durationSec: 7200 }, 10 * 1024 * 1024, 2e9)).toThrow(/too long/)
  })
})

describe.runIf(hasFfmpeg)('fit to size (real FFmpeg, two-pass)', () => {
  it('lands under the target size', async () => {
    const src = join(root, 'big.mp4')
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=duration=8', '-c:v', 'libx264', '-crf', '4', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src])
    const target = 1024 * 1024 // 1 MB for a quick test
    const info = await probeMedia('ffprobe', src)
    const plan = planFitSize(info, target, (await stat(src)).size)
    const { pass1, pass2 } = fitPassArgs(plan, join(root, 'pass'))
    const out = join(root, 'small.mp4')
    await runFfmpeg({ ffmpeg: 'ffmpeg', input: src, output: 'NUL', preInput: [], args: pass1, durationSec: plan.durationSec })
    await runFfmpeg({ ffmpeg: 'ffmpeg', input: src, output: out, preInput: [], args: pass2, durationSec: plan.durationSec })
    expect((await stat(out)).size).toBeLessThanOrEqual(target)
    expect((await probeMedia('ffprobe', out)).durationSec).toBeGreaterThan(7.5)
  }, 120_000)
})
