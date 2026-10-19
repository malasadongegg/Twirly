/// <reference lib="dom" />
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import sharp from 'sharp'
import { PDFDocument, StandardFonts } from 'pdf-lib'

// Smoke test of the PACKAGED app (release/win-unpacked). Run after `npm run dist:dir`.
// TWIRLY_EXE lets the same smoke test run against an installed copy.
const exe = process.env.TWIRLY_EXE || join(process.cwd(), 'release', 'win-unpacked', 'Twirly.exe')
const work = join(process.cwd(), 'tests', '.tmp', 'packaged')

test.skip(!existsSync(exe), 'packaged app not built (npm run dist:dir)')

let app: ElectronApplication
let home: Page

test.beforeAll(async () => {
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>
  env.TWIRLY_USER_DATA = join(work, 'user-data')
  // Hide any system FFmpeg so the bundled copy is what gets tested (a friend's PC has none).
  for (const key of Object.keys(env).filter((k) => k.toLowerCase() === 'path')) {
    env[key] = env[key]!.split(';').filter((d) => !/ffmpeg/i.test(d)).join(';')
  }
  app = await electron.launch({ executablePath: exe, args: [], env })
  home = await (async () => {
    for (;;) {
      const w = app.windows().find((p) => p.url().endsWith('/index.html'))
      if (w) return w
      await app.waitForEvent('window')
    }
  })()
  await home.waitForSelector('[data-testid="drop-zone"]')
})

test.afterAll(async () => {
  await app?.close()
})

async function runViaWheel(file: string, segment: string) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, file)
  await home.getByRole('button', { name: /Browse files/ }).click()
  await home.getByTestId(`wheel-segment-${segment}`).click()
  await expect(home.getByTestId('job-toast')).toHaveAttribute('data-status', 'done', { timeout: 30_000 })
  // Up to 6 s when the toast offers a follow-up (Touch up after Remove background).
  await expect(home.getByTestId('job-toast')).toBeHidden({ timeout: 9000 })
}

test('packaged: is packaged, helper runs from resources, sharp works from asar.unpacked', async () => {
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  // The helper starts asynchronously right after launch.
  await expect.poll(async () => (await home.evaluate(() => window.twirly.diagnostics())).helper.state, { timeout: 10_000 }).toBe('running')
  const diag = await home.evaluate(() => window.twirly.diagnostics())
  expect(diag.capabilities.imageOutput).toEqual(expect.arrayContaining(['png', 'jpeg', 'webp', 'avif', 'bmp']))

  const png = join(work, 'p.png')
  await sharp({ create: { width: 50, height: 40, channels: 3, background: '#3b82f6' } }).png().toFile(png)
  await runViaWheel(png, 'image.convert.webp')
  expect((await sharp(join(work, 'p-converted.webp')).metadata()).format).toBe('webp')
})

test('packaged: pdf.js renders from inside the asar (worker, fonts, cmaps)', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([144, 72]).drawText('Packaged', { x: 10, y: 30, size: 12, font })
  const pdf = join(work, 'd.pdf')
  await writeFile(pdf, await doc.save())
  await runViaWheel(pdf, 'pdf.to-png')
  const meta = await sharp(join(work, 'd-converted.png')).metadata()
  expect([meta.width, meta.height]).toEqual([300, 150])
})

test('packaged: bundled FFmpeg is used with no FFmpeg on PATH (video, HEIC)', async () => {
  const diag = await home.evaluate(() => window.twirly.diagnostics())
  expect(diag.capabilities.ffmpeg.available).toBe(true)
  expect(diag.capabilities.ffmpeg.path).toMatch(/resources[\\/]ffmpeg[\\/]ffmpeg\.exe$/i)
  expect(diag.capabilities.ffprobe.available).toBe(true)
  expect(diag.capabilities.imageInput).toContain('heic')

  // A 1 s test clip, made with the bundled FFmpeg itself.
  const ff = join(exe, '..', 'resources', 'ffmpeg', 'ffmpeg.exe')
  const mov = join(work, 'clip.mov')
  execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', mov])
  await runViaWheel(mov, 'video.to-mp4')
  expect(existsSync(join(work, 'clip-converted.mp4'))).toBe(true)
})

test('packaged: background removal runs (ONNX Runtime from asar.unpacked, bundled model)', async () => {
  const diag = await home.evaluate(() => window.twirly.diagnostics())
  expect(diag.capabilities.removeBg).toBe(true)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#e5e9ee"/>
    <defs><radialGradient id="b" cx="0.38" cy="0.35" r="0.7"><stop offset="0" stop-color="#ffd08a"/><stop offset="0.45" stop-color="#f97316"/><stop offset="1" stop-color="#7c2d12"/></radialGradient></defs>
    <circle cx="160" cy="120" r="70" fill="url(#b)"/></svg>`
  const src = join(work, 'ball.png')
  await sharp(Buffer.from(svg)).png().toFile(src)
  await runViaWheel(src, 'image.remove-bg')
  const { data, info } = await sharp(join(work, 'ball-no-bg.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  expect(data[3]).toBeLessThan(20) // corner: transparent
  expect(data[(120 * info.width + 160) * 4 + 3]).toBeGreaterThan(220) // centre: the ball
})
