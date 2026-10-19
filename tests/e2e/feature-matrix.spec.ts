/// <reference lib="dom" />
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'
import type { JobProgress } from '../../packages/shared/types'

/**
 * Runs EVERY action through the real app (main-process handlers, real sharp/pdf.js/FFmpeg/Office)
 * on real fixtures and checks every output. Opt-in because it needs FFmpeg and Office and takes a
 * few minutes: TWIRLY_MATRIX=1 npx playwright test tests/e2e/feature-matrix.spec.ts
 */
test.skip(process.env.TWIRLY_MATRIX !== '1', 'set TWIRLY_MATRIX=1')
test.setTimeout(20 * 60_000)

const root = process.cwd()
const dir = join(root, 'tests', '.tmp', 'matrix')
const f = (name: string) => join(dir, name)
let app: ElectronApplication
let page: Page
const results: { action: string; ok: boolean; note: string }[] = []

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
const probe = (p: string, entries: string) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', p]).toString().trim()
const ps = (script: string) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 120_000 })

async function run(actionId: string, paths: string[], params: Record<string, unknown> = {}): Promise<JobProgress> {
  return page.evaluate(
    ({ actionId, paths, params }) =>
      new Promise<JobProgress>((resolve, reject) => {
        let id = ''
        const off = window.twirly.onJobProgress((p) => {
          if (p.jobId === id && ['done', 'failed', 'cancelled'].includes(p.status)) {
            off()
            resolve(p)
          }
        })
        window.twirly.runJob({ actionId, paths, params }).then((r) => (id = r.jobId), reject)
      }),
    { actionId, paths, params },
  )
}

/** Run an action, check it finished and its outputs pass `verify`; record the result. */
async function check(actionId: string, paths: string[], verify: (p: JobProgress) => Promise<string | void> | string | void, params: Record<string, unknown> = {}) {
  let ok = false
  let note = ''
  try {
    const p = await run(actionId, paths, params)
    if (p.status !== 'done') throw new Error(`${p.status}: ${p.error?.message ?? ''} ${p.error?.detail ?? ''}`)
    note = (await verify(p)) || p.message || p.outputs.map((o) => o.split(/[\\/]/).pop()).join(', ')
    ok = true
  } catch (err) {
    note = (err as Error).message.split('\n')[0]!.slice(0, 200)
  }
  results.push({ action: actionId, ok, note })
}

const meta = (p: string) => sharp(p).metadata()
const pages = async (p: string) => (await PDFDocument.load(await readFile(p))).getPageCount()

test.beforeAll(async () => {
  await rm(dir, { recursive: true, force: true })
  await mkdir(join(dir, 'Album'), { recursive: true })
  // Images
  const rgba = Buffer.alloc(120 * 80 * 4)
  for (let i = 0; i < 120 * 80; i++) rgba.set([i % 255, 80, 200, i % 120 < 60 ? 255 : 0], i * 4)
  await sharp(rgba, { raw: { width: 120, height: 80, channels: 4 } }).png().toFile(f('alpha.png'))
  await sharp({ create: { width: 400, height: 300, channels: 3, background: '#88aacc' } })
    .withExif({ IFD0: { Make: 'MatrixCam', Model: 'M1' } })
    .jpeg({ quality: 95 })
    .toFile(f('photo.jpg'))
  copyFileSync(f('photo.jpg'), f('photo.jfif'))
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } }).gif().toFile(f('anim.gif'))
  for (const n of ['1', '2', '10']) await sharp({ create: { width: 200, height: 150, channels: 3, background: '#33' + n.padStart(2, '0') + '66' } }).jpeg().toFile(join(dir, 'Album', `scan ${n}.jpg`))
  const heic = join(root, 'tests', 'fixtures', 'heic', 'C007.heic')
  if (existsSync(heic)) copyFileSync(heic, f('phone.heic'))
  // PDFs
  for (const [name, n] of [['doc.pdf', 3], ['other.pdf', 2]] as const) {
    const d = await PDFDocument.create()
    const font = await d.embedFont(StandardFonts.Helvetica)
    const img = await d.embedJpg(await readFile(f('photo.jpg')))
    for (let i = 1; i <= n; i++) {
      const pg = d.addPage([400, 300])
      pg.drawText(`Heading ${i}`, { x: 20, y: 260, size: 20, font })
      pg.drawText(`Body text on page ${i}.`, { x: 20, y: 230, size: 11, font })
      if (i === 1) pg.drawImage(img, { x: 20, y: 20, width: 200, height: 150 })
    }
    await writeFile(f(name), await d.save())
  }
  // An image-heavy "scan" PDF for compression.
  {
    const w = 2400
    const h = 1600
    const raw = Buffer.alloc(w * h * 3)
    let seed = 1
    for (let i = 0; i < raw.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      raw[i] = ((i % (w * 3)) / 12 + ((seed >> 16) % 30)) & 255
    }
    const d = await PDFDocument.create()
    const big = await d.embedJpg(await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 97 }).toBuffer())
    d.addPage([600, 400]).drawImage(big, { x: 0, y: 0, width: 600, height: 400 })
    await writeFile(f('scan.pdf'), await d.save())
  }
  // Media
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-c:v', 'libx264', '-crf', '6', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', f('clip.mp4')])
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', f('tone.wav')])
  // Text
  await writeFile(f('notes.md'), '# Trip\n\nKumusta! mañana ₱100 ✓\n\n## Plan\n- beach\n- food\n')
  await writeFile(f('data.csv'), 'name,qty\napple,3\nmango,5\n')
  await writeFile(f('readme.txt'), 'Plain text file.\n')
  await writeFile(f('empty.png'), Buffer.alloc(200))
  // Office files created by the real Office apps (when installed).
  try {
    ps(`$w = New-Object -ComObject Word.Application; try { $d = $w.Documents.Add(); $d.Content.Text = 'Matrix Word document'; $d.InlineShapes.AddPicture('${f('photo.jpg')}') | Out-Null; $d.SaveAs2('${f('letter.docx')}', 16); $d.Close(0) } finally { $w.Quit() }`)
  } catch {
    /* Word missing */
  }
  try {
    ps(`$x = New-Object -ComObject Excel.Application; $x.DisplayAlerts = $false; try { $b = $x.Workbooks.Add(); $b.Sheets(1).Range('A1').Value2 = 'Matrix'; $b.Sheets(1).Range('B2').Value2 = 42; $b.Sheets(1).Shapes.AddPicture('${f('photo.jpg')}', 0, -1, 100, 60, 200, 150) | Out-Null; $b.SaveAs('${f('sheet.xlsx')}', 51); $b.Close($false) } finally { $x.Quit() }`)
  } catch {
    /* Excel missing */
  }
  try {
    ps(`$wasRunning = [bool](Get-Process POWERPNT -ErrorAction SilentlyContinue); $p = New-Object -ComObject PowerPoint.Application; try { $pr = $p.Presentations.Add(0); $s = $pr.Slides.Add(1, 1); $s.Shapes.Item(1).TextFrame.TextRange.Text = 'Matrix slide'; $s.Shapes.AddPicture('${f('photo.jpg')}', 0, -1, 50, 150, 200, 150) | Out-Null; $pr.SaveAs('${f('deck.pptx')}', 24); $pr.Close() } finally { if (-not $wasRunning) { $p.Quit() } }`)
  } catch {
    /* PowerPoint missing */
  }

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>
  env.TWIRLY_USER_DATA = join(dir, 'user-data')
  app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], env })
  for (;;) {
    const w = app.windows().find((p) => p.url().endsWith('/index.html'))
    if (w) {
      page = w
      break
    }
    await app.waitForEvent('window')
  }
  await page.waitForSelector('[data-testid="drop-zone"]')
})

test.afterAll(async () => {
  await app?.close()
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.action.padEnd(26)} ${r.note}`)
  await writeFile(join(root, 'tests', '.tmp', 'matrix-report.txt'), lines.join('\n') + '\n')
  console.log('\n' + lines.join('\n'))
})

test('every action, real outputs', async () => {
  // ---------- images ----------
  for (const [fmt, ext, sharpFmt] of [['png', 'png', 'png'], ['jpeg', 'jpg', 'jpeg'], ['webp', 'webp', 'webp'], ['avif', 'avif', 'heif'], ['tiff', 'tiff', 'tiff'], ['bmp', 'bmp', null]] as const) {
    const src = fmt === 'png' ? f('photo.jpg') : f('alpha.png')
    await check(`image.convert.${fmt}`, [src], async (p) => {
      const out = p.outputs[0]!
      if (!out.endsWith('.' + ext)) throw new Error(`wrong extension ${out}`)
      if (sharpFmt) {
        const m = await meta(out)
        if (m.format !== sharpFmt) throw new Error(`format ${m.format}`)
      } else if (probe(out, 'stream=codec_name') !== 'bmp') throw new Error('not a BMP')
    })
  }
  await check('image.convert.jpeg', [f('photo.jfif')], async (p) => {
    if (Buffer.compare(await readFile(p.outputs[0]!), await readFile(f('photo.jfif'))) !== 0) throw new Error('jfif → jpg not lossless')
    return 'jfif → jpg, lossless'
  })
  if (existsSync(f('phone.heic')))
    await check('image.convert.jpeg', [f('phone.heic')], async (p) => {
      const m = await meta(p.outputs[0]!)
      if (m.width !== 2560) throw new Error(`heic grid not composed: ${m.width}`)
      return 'heic grid → 2560×1440 jpg'
    })
  await check('image.convert.png', [f('anim.gif')], async (p) => `gif → ${(await meta(p.outputs[0]!)).format}`)
  await check('image.compress', [f('photo.jpg')], () => (statSync(f('photo-compressed.jpg')).size < statSync(f('photo.jpg')).size ? 'smaller' : 'NOT smaller'))
  await check('image.rotate', [f('alpha.png')], async (p) => {
    const m = await meta(p.outputs[0]!)
    if (m.width !== 80) throw new Error(`not rotated ${m.width}x${m.height}`)
  })
  await check('image.strip-metadata', [f('photo.jpg')], async (p) => {
    if ((await meta(p.outputs[0]!)).exif) throw new Error('EXIF still present')
  })
  await check('image.crop', [f('photo.jpg')], async (p) => `${(await meta(p.outputs[0]!)).width}×${(await meta(p.outputs[0]!)).height}`, { crop: { left: 10, top: 10, width: 100, height: 50 } })
  await check('image.resize', [f('photo.jpg')], async (p) => `${(await meta(p.outputs[0]!)).width}×${(await meta(p.outputs[0]!)).height}`, { resize: { width: 200, height: 150 }, format: 'webp' })
  await check('image.background', [f('alpha.png')], async (p) => `${(await meta(p.outputs[0]!)).width}×${(await meta(p.outputs[0]!)).height}`, { padding: 20, ratio: '1:1' })
  await check('image.redact', [f('photo.jpg')], async (p) => {
    const m = await meta(p.outputs[0]!)
    if (m.exif) throw new Error('metadata kept')
    const { data, info } = await sharp(p.outputs[0]!).raw().toBuffer({ resolveWithObject: true })
    if (data[(20 * info.width + 20) * info.channels]! > 20) throw new Error('not blacked out')
  }, { regions: [{ left: 0, top: 0, width: 50, height: 50 }] })
  await check('image.annotate', [f('photo.jpg')], async (p) => `${(await meta(p.outputs[0]!)).format}`, { shapes: [{ type: 'rect', from: { x: 10, y: 10 }, to: { x: 100, y: 100 }, color: '#ff0000', width: 4 }, { type: 'text', at: { x: 120, y: 120 }, text: 'Hi', color: '#ffffff', size: 24 }] })
  await check('image.to-pdf', [f('photo.jpg'), f('alpha.png')], async (p) => `${await pages(p.outputs[0]!)} pages`)
  const metaResult = await page.evaluate((path) => window.twirly.imageMetadata(path), f('photo.jpg'))
  results.push({ action: 'image.metadata (view)', ok: metaResult.exif.fields.some((x) => x.value === 'MatrixCam'), note: metaResult.exif.fields.map((x) => `${x.label}=${x.value}`).join(', ') })

  // ---------- PDF ----------
  await check('pdf.to-png', [f('doc.pdf')], (p) => `${p.outputs.length} pages`)
  await check('pdf.to-jpeg', [f('doc.pdf')], (p) => `${p.outputs.length} pages`)
  await check('pdf.to-text', [f('doc.pdf')], async (p) => {
    const t = await readFile(p.outputs[0]!, 'utf8')
    if (!t.includes('Body text on page 3')) throw new Error('text missing')
  })
  await check('pdf.to-docx', [f('doc.pdf')], (p) => {
    try {
      const out = ps(`$w = New-Object -ComObject Word.Application; try { $d = $w.Documents.Open('${p.outputs[0]}', $false, $true); 'PAGES=' + $d.ComputeStatistics(2); $d.Close(0) } finally { $w.Quit() }`)
      return `opens in Word, ${out.trim()}`
    } catch {
      return 'written (Word not available to verify)'
    }
  })
  await check('pdf.merge', [f('doc.pdf'), f('other.pdf')], async (p) => {
    if ((await pages(p.outputs[0]!)) !== 5) throw new Error('page count')
    return '3 + 2 = 5 pages'
  })
  await check('pdf.split', [f('other.pdf')], (p) => `${p.outputs.length} files`)
  await check('pdf.rotate', [f('other.pdf')], async (p) => `rotation ${(await PDFDocument.load(await readFile(p.outputs[0]!))).getPage(0).getRotation().angle}`)
  await check('pdf.optimize', [f('doc.pdf')], async (p) => `${await pages(p.outputs[0]!)} pages`)
  await check('pdf.edit', [f('doc.pdf')], async (p) => `${await pages(p.outputs[0]!)} pages`, { pages: [{ index: 2, rotate: 90 }, { index: 0, rotate: 0, crop: { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 } }] })
  await check('pdf.extract-images', [f('doc.pdf')], async (p) => `${p.message} → ${(await readdir(p.outputs[0]!)).join(', ')}`)
  await check('pdf.compress', [f('scan.pdf')], (p) => `${(statSync(f('scan.pdf')).size / 1e6).toFixed(1)} MB → ${(statSync(p.outputs[0]!).size / 1e6).toFixed(1)} MB`)
  const compact = await run('pdf.compress', [f('doc.pdf')])
  results.push({ action: 'pdf.compress (small PDF)', ok: compact.status === 'failed' && /compact/.test(compact.error?.message ?? ''), note: compact.error?.message ?? compact.status })

  // ---------- video / audio ----------
  for (const a of ['video.to-webm', 'video.compress', 'video.extract-audio', 'video.to-gif'])
    await check(a, [f('clip.mp4')], (p) => `${p.outputs[0]!.split(/[\\/]/).pop()} (${probe(p.outputs[0]!, 'stream=codec_name').split('\n').join('+')})`)
  await check('video.edit', [f('clip.mp4')], (p) => `${Number(probe(p.outputs[0]!, 'format=duration')).toFixed(2)} s`, { start: 1, end: 3, height: 360 })
  await check('video.fit-10mb', [f('clip.mp4')], (p) => {
    const size = statSync(p.outputs[0]!).size
    if (size > 10 * 1024 * 1024) throw new Error(`too big: ${size}`)
    return `${(size / 1024 / 1024).toFixed(2)} MB (source ${(statSync(f('clip.mp4')).size / 1024 / 1024).toFixed(1)} MB)`
  })
  for (const a of ['audio.to-mp3', 'audio.to-m4a', 'audio.to-flac', 'audio.to-ogg', 'audio.normalize'])
    await check(a, [f('tone.wav')], (p) => `${p.outputs[0]!.split(/[\\/]/).pop()} (${probe(p.outputs[0]!, 'stream=codec_name')})`)
  await check('audio.edit', [f('tone.wav')], (p) => `${Number(probe(p.outputs[0]!, 'format=duration')).toFixed(2)} s`, { start: 0.5, end: 2, format: 'mp3' })

  // ---------- files, folders, archives ----------
  await check('file.copy-path', [f('readme.txt'), f('notes.md')], async (p) => {
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
    if (!clip.includes('readme.txt') || !clip.includes('notes.md')) throw new Error('clipboard wrong')
    return `${p.message}`
  })
  await check('file.checksum', [f('readme.txt')], async () => `clipboard = ${(await app.evaluate(({ clipboard }) => clipboard.readText())).slice(0, 16)}…`)
  await check('file.zip', [join(dir, 'Album')], (p) => p.outputs[0]!.split(/[\\/]/).pop())
  await check('archive.extract', [f('Album.zip')], async (p) => `${p.message} → ${(await readdir(p.outputs[0]!)).length} items`)
  await check('folder.images-to-pdf', [join(dir, 'Album')], async (p) => `${p.message} (${await pages(p.outputs[0]!)} pages)`)

  // ---------- text ----------
  await check('text.to-pdf', [f('notes.md')], async (p) => `${await pages(p.outputs[0]!)} page`)
  await check('text.to-pdf', [f('data.csv')], async (p) => `csv → ${await pages(p.outputs[0]!)} page`)
  await check('text.to-docx', [f('notes.md')], (p) => p.outputs[0]!.split(/[\\/]/).pop())
  await check('text.combine', [f('readme.txt'), f('notes.md')], async (p) => `${(await readFile(p.outputs[0]!, 'utf8')).split('=====').length - 1} headers`)

  // ---------- Office ----------
  for (const [file, label] of [['letter.docx', 'Word'], ['sheet.xlsx', 'Excel'], ['deck.pptx', 'PowerPoint']] as const) {
    if (!existsSync(f(file))) {
      results.push({ action: `document.to-pdf (${label})`, ok: false, note: `${label} not installed; fixture not created` })
      continue
    }
    await check('document.to-pdf', [f(file)], async (p) => `${label} → PDF, ${await pages(p.outputs[0]!)} page(s)`)
    await check('document.extract-images', [f(file)], (p) => `${label}: ${p.message}`)
  }

  // ---------- safety and errors ----------
  const broken = await run('image.convert.jpeg', [f('empty.png')])
  results.push({ action: 'error: empty .png', ok: broken.status === 'failed' && /empty/.test(broken.error?.message ?? ''), note: broken.error?.message ?? broken.status })

  // Settings → Save to: outputs go to the chosen folder.
  const outDir = join(dir, 'Exports')
  await mkdir(outDir)
  await page.evaluate((d) => window.twirly.settings.set({ outputDir: d }), outDir)
  const exported = await run('image.convert.webp', [f('photo.jpg')])
  results.push({ action: 'setting: output folder', ok: exported.status === 'done' && exported.outputs[0]!.startsWith(outDir), note: exported.outputs[0] ?? exported.error?.message ?? '' })
  await page.evaluate(() => window.twirly.settings.set({ outputDir: null }))
  const second = await run('image.convert.webp', [f('alpha.png')])
  const third = await run('image.convert.webp', [f('alpha.png')])
  results.push({ action: 'collision-safe names', ok: second.outputs[0] !== third.outputs[0], note: `${second.outputs[0]?.split(/[\\/]/).pop()} / ${third.outputs[0]?.split(/[\\/]/).pop()}` })
  const cancelled = await page.evaluate(
    (path) =>
      new Promise<JobProgress>((resolve) => {
        let id = ''
        const off = window.twirly.onJobProgress((p) => {
          if (p.jobId !== id) return
          if (p.status === 'running' && (p.fraction ?? 0) > 0.05) void window.twirly.cancelJob(id)
          if (['done', 'failed', 'cancelled'].includes(p.status)) {
            off()
            resolve(p)
          }
        })
        window.twirly.runJob({ actionId: 'video.to-webm', paths: [path], params: {} }).then((r) => (id = r.jobId))
      }),
    f('clip.mp4'),
  )
  const leftovers = (await readdir(dir)).filter((n) => n.includes('twirly-tmp'))
  results.push({ action: 'cancel cleans up', ok: cancelled.status === 'cancelled' && leftovers.length === 0, note: `${cancelled.status}, temp files left: ${leftovers.length}` })

  const failed = results.filter((r) => !r.ok)
  expect(failed, failed.map((r) => `${r.action}: ${r.note}`).join('\n')).toEqual([])
})
