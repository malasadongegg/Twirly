/// <reference lib="dom" />
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import sharp from 'sharp'

const root = process.cwd()
const work = join(root, 'tests', '.tmp', 'e2e')
const shots = join(root, 'tests', '.tmp', 'screens')

let app: ElectronApplication
let home: Page

async function stubFileDialog(paths: string[]) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: p })) as typeof dialog.showOpenDialog
  }, paths)
}

/** Dispatch a synthetic HTML5 drag carrying File items (types only, as during a real drag). */
async function syntheticDrag(page: Page, type: 'dragenter' | 'dragover' | 'dragleave', x: number, y: number, mimes: string[]) {
  await page.evaluate(
    ({ type, x, y, mimes }) => {
      const dt = new DataTransfer()
      mimes.forEach((m, i) => dt.items.add(new File(['x'], `f${i}`, { type: m })))
      window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    },
    { type, x, y, mimes },
  )
}

test.beforeAll(async () => {
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  await mkdir(shots, { recursive: true })
  const png = await sharp({ create: { width: 320, height: 200, channels: 4, background: { r: 59, g: 130, b: 246, alpha: 1 } } })
    .composite([{ input: Buffer.from('<svg width="320" height="200"><circle cx="160" cy="100" r="60" fill="white"/></svg>') }])
    .png()
    .toBuffer()
  await writeFile(join(work, 'sample.png'), png)

  const started = Date.now()
  // Editors/terminals hosted in Electron (VS Code) export ELECTRON_RUN_AS_NODE, which would make
  // the app start as plain Node. Strip it, and force the built renderer instead of a dev server.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE' && k !== 'ELECTRON_RENDERER_URL')) as Record<string, string>
  env.TWIRLY_USER_DATA = join(work, 'user-data') // never touch the real settings
  app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], env })
  // The hidden wheel window is created too; pick the main window by its page.
  home = await (async () => {
    for (;;) {
      const w = app.windows().find((p) => p.url().endsWith('/index.html'))
      if (w) return w
      await app.waitForEvent('window')
    }
  })()
  await home.waitForSelector('[data-testid="drop-zone"]')
  console.log(`startup to interactive drop zone: ${Date.now() - started} ms`)
})

test.afterAll(async () => {
  await app?.close()
})

test('main window renders the Twirly drop zone', async () => {
  await expect(home.getByRole('heading', { name: 'Drop files here' })).toBeVisible()
  await home.screenshot({ path: join(shots, 'home.png') })
})

test('dragging images over the window opens a contextual wheel and tracks the hovered segment', async () => {
  await syntheticDrag(home, 'dragenter', 220, 300, ['image/png'])
  const wheel = home.getByTestId('radial-wheel')
  await expect(wheel).toBeVisible()
  // PNG input: no "convert to PNG", but JPG/WEBP/CROP are offered.
  await expect(home.getByTestId('wheel-segment-image.convert.png')).toHaveCount(0)
  await expect(home.getByTestId('wheel-segment-image.convert.jpeg')).toHaveCount(1)
  await expect(home.getByTestId('wheel-segment-image.crop')).toHaveCount(1)
  await expect(wheel).toHaveAttribute('data-hub', '1 file')

  const box = (await wheel.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  // Segment 0 is centered at 12 o'clock.
  await syntheticDrag(home, 'dragover', cx, cy - 110, ['image/png'])
  await expect(home.getByTestId('wheel-segment-image.convert.jpeg')).toHaveAttribute('data-active', 'true')
  await expect(wheel).toHaveAttribute('data-hub', 'Convert to JPG')
  await home.waitForTimeout(250)
  await home.screenshot({ path: join(shots, 'wheel-hover.png') })

  // Hub = no selection.
  await syntheticDrag(home, 'dragover', cx, cy, ['image/png'])
  await expect(home.locator('[data-active="true"]')).toHaveCount(0)

  await syntheticDrag(home, 'dragleave', 0, 0, ['image/png'])
  await expect(wheel).toBeHidden({ timeout: 2000 })
})

test('mixed selections get only the actions they share (zip, copy path)', async () => {
  await syntheticDrag(home, 'dragenter', 220, 300, ['image/png', 'application/pdf'])
  await expect(home.getByTestId('radial-wheel')).toHaveAttribute('data-hub', '2 files')
  await expect(home.getByTestId('wheel-segment-file.zip')).toBeVisible()
  await expect(home.getByTestId('wheel-segment-image.crop')).toHaveCount(0)
  await home.waitForTimeout(200)
  await home.screenshot({ path: join(shots, 'wheel-mixed.png') })
  await syntheticDrag(home, 'dragleave', 0, 0, ['image/png', 'application/pdf'])
  await expect(home.getByTestId('radial-wheel')).toBeHidden({ timeout: 2000 })
})

test('browse → wheel → Convert to WEBP writes a real file and reports progress', async () => {
  await stubFileDialog([join(work, 'sample.png')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  const wheel = home.getByTestId('radial-wheel')
  await expect(wheel).toBeVisible()
  await expect(wheel).toHaveAttribute('data-hub', /\d+(\.\d)? (B|KB)$/)
  await home.getByTestId('wheel-segment-image.convert.webp').click()
  const toast = home.getByTestId('job-toast')
  await expect(toast).toHaveAttribute('data-status', 'done', { timeout: 15_000 })
  await expect(home.getByTestId('job-toast-subtitle')).toHaveText('1 of 1 saved')
  await home.screenshot({ path: join(shots, 'toast-done.png') })
  const out = await sharp(join(work, 'sample-converted.webp')).metadata()
  expect([out.format, out.width, out.height]).toEqual(['webp', 320, 200])
  await expect(toast).toBeHidden({ timeout: 5000 })
})

test('keyboard: arrows move the selection, Escape cancels', async () => {
  await stubFileDialog([join(work, 'sample.png')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await expect(home.getByTestId('radial-wheel')).toBeFocused()
  await home.keyboard.press('ArrowRight')
  await expect(home.locator('[data-active="true"]')).toHaveCount(1)
  await home.keyboard.press('Escape')
  await expect(home.getByTestId('radial-wheel')).toBeHidden({ timeout: 2000 })
})

test('crop editor opens, crops with an aspect preset and saves a correct file', async () => {
  await stubFileDialog([join(work, 'sample.png')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  const editorPromise = app.waitForEvent('window')
  await home.getByTestId('wheel-segment-image.crop').click()
  const editor = await editorPromise
  await editor.waitForSelector('[data-testid="crop-rect"]')
  await editor.getByRole('radio', { name: '1:1' }).click()
  await editor.waitForTimeout(200)
  await editor.screenshot({ path: join(shots, 'crop-editor.png') })
  await expect(editor.getByTestId('editor-status')).toHaveText('Output 200 × 200 px')
  await editor.getByTestId('editor-export').click()
  await expect(editor.getByTestId('editor-status')).toHaveText(/Saved sample-cropped\.png/, { timeout: 15_000 })
  const meta = await sharp(join(work, 'sample-cropped.png')).metadata()
  expect([meta.width, meta.height]).toEqual([200, 200])
  await editor.close()
})

test('resize editor halves the image', async () => {
  // Resize is not on the default 8-segment image wheel; put it there like a user would in Settings.
  await home.evaluate(() => window.twirly.settings.set({ wheelOrder: { image: ['image.resize', 'image.crop'] } }))
  await stubFileDialog([join(work, 'sample.png')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  const editorPromise = app.waitForEvent('window')
  await home.getByTestId('wheel-segment-image.resize').click()
  const editor = await editorPromise
  await editor.getByRole('button', { name: '50%' }).click()
  await editor.getByRole('radio', { name: 'JPG' }).click()
  await editor.screenshot({ path: join(shots, 'resize-editor.png') })
  await editor.getByTestId('editor-export').click()
  await expect(editor.getByTestId('editor-status')).toHaveText(/Saved sample-resized\.jpg/, { timeout: 15_000 })
  const meta = await sharp(join(work, 'sample-resized.jpg')).metadata()
  expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 160, 100])
  await editor.close()
  await home.evaluate(() => window.twirly.settings.set({ wheelOrder: {} }))
})

test('a corrupted file fails with a readable error and leaves nothing behind', async () => {
  await writeFile(join(work, 'broken.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))
  await stubFileDialog([join(work, 'broken.png')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await home.getByTestId('wheel-segment-image.convert.jpeg').click()
  await expect(home.getByTestId('job-toast')).toHaveAttribute('data-status', 'failed', { timeout: 15_000 })
  await expect(home.getByTestId('job-toast-subtitle')).toHaveText(/corrupted|unsupported/)
  await home.screenshot({ path: join(shots, 'toast-failed.png') })
  expect((await readdir(work)).filter((f) => f.startsWith('broken'))).toEqual(['broken.png'])
  await home.getByRole('button', { name: 'Dismiss' }).click()
})

test('settings: persist a change and show diagnostics', async () => {
  await home.getByRole('button', { name: 'Settings' }).click()
  await expect(home.getByTestId('settings-view')).toBeVisible()
  await expect(home.getByTestId('diagnostics')).toContainText('PNG')
  await home.getByRole('radio', { name: 'Reduced' }).click()
  await home.waitForTimeout(300)
  await home.screenshot({ path: join(shots, 'settings.png') })
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  const saved = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')).animation
  expect(saved).toBe('reduced')

  // Rebind the drag-summon trigger with the key recorder.
  await home.getByRole('button', { name: 'Change' }).click()
  await expect(home.getByTestId('trigger-key')).toHaveText('Press a key…')
  await home.keyboard.press('Escape') // Esc is refused/cancels, never recorded
  await expect(home.getByTestId('trigger-key')).toHaveText('Shift')
  await home.getByRole('button', { name: 'Change' }).click()
  await home.keyboard.press('q')
  await expect(home.getByTestId('trigger-key')).toHaveText('Q')
  await home.getByRole('radio', { name: 'Chosen apps' }).click()
  await home.getByLabel('App to add').fill('dopus')
  await home.getByLabel('App to add').press('Enter')
  await expect(home.getByText('dopus.exe')).toBeVisible()
  await home.waitForTimeout(300)
  await home.screenshot({ path: join(shots, 'settings-trigger.png') })
  const summon = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')).dragSummon
  expect(summon).toMatchObject({ trigger: 'KeyQ', scope: 'custom', apps: ['explorer.exe', 'dopus.exe'] })
  await home.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(home.getByTestId('drop-zone')).toBeVisible()
})

test('PDF wheel: pages → PNG and text extraction via the hidden pdf.js renderer', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const n of [1, 2]) doc.addPage([200, 100]).drawText(`Hello page ${n}`, { x: 10, y: 50, size: 14, font })
  await writeFile(join(work, 'doc.pdf'), await doc.save())

  await stubFileDialog([join(work, 'doc.pdf')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await expect(home.getByTestId('wheel-segment-pdf.to-png')).toBeVisible()
  await home.screenshot({ path: join(shots, 'wheel-pdf.png') })
  await home.getByTestId('wheel-segment-pdf.to-png').click()
  await expect(home.getByTestId('job-toast')).toHaveAttribute('data-status', 'done', { timeout: 30_000 })
  for (const n of [1, 2]) {
    const meta = await sharp(join(work, `doc-page-${n}.png`)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 416, 208]) // 150 dpi
  }
  await expect(home.getByTestId('job-toast')).toBeHidden({ timeout: 5000 })

  await stubFileDialog([join(work, 'doc.pdf')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await home.getByTestId('wheel-segment-pdf.to-text').click()
  await expect(home.getByTestId('job-toast')).toHaveAttribute('data-status', 'done', { timeout: 30_000 })
  const text = await readFile(join(work, 'doc.txt'), 'utf8')
  expect(text).toContain('Hello page 1')
  expect(text).toContain('Hello page 2')
  await expect(home.getByTestId('job-toast')).toBeHidden({ timeout: 5000 })
})

test('PDF page editor: extract a page and save a rotated copy', async () => {
  const { PDFDocument } = await import('pdf-lib')
  await stubFileDialog([join(work, 'doc.pdf')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  const editorPromise = app.waitForEvent('window')
  await home.getByTestId('wheel-segment-pdf.edit').click()
  const editor = await editorPromise
  await editor.getByTestId('pdf-page-1').locator('img').waitFor({ timeout: 15_000 })
  await editor.getByRole('button', { name: 'Page 2' }).click()
  await editor.screenshot({ path: join(shots, 'pdf-editor.png') })
  await editor.getByTestId('pdf-extract').click()
  await expect(editor.getByTestId('editor-status')).toHaveText(/Saved doc-edited\.pdf/, { timeout: 15_000 })
  const extracted = await PDFDocument.load(await readFile(join(work, 'doc-edited.pdf')))
  expect(extracted.getPageCount()).toBe(1)

  await editor.getByRole('button', { name: 'Page 2, selected' }).click() // deselect → rotate applies to all
  await editor.getByRole('button', { name: 'Rotate right' }).click()
  await editor.getByTestId('editor-export').click()
  await expect(editor.getByTestId('editor-status')).toHaveText(/Saved doc-edited \(2\)\.pdf/, { timeout: 15_000 })
  const rotated = await PDFDocument.load(await readFile(join(work, 'doc-edited (2).pdf')))
  expect(rotated.getPages().map((p) => p.getRotation().angle)).toEqual([90, 90])
  await editor.close()
})

test('media editor: preview streams through twirly-media://, trim exports the right length', async () => {
  const { execFileSync } = await import('node:child_process')
  const clip = join(work, 'clip.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip])
  await stubFileDialog([clip])
  await home.getByRole('button', { name: /Browse files/ }).click()
  const editorPromise = app.waitForEvent('window')
  await home.getByTestId('wheel-segment-video.edit').click()
  const editor = await editorPromise
  await expect(editor.getByTestId('media-info')).toContainText('320×240')
  // The <video> really loaded through the custom protocol (metadata, duration and seeking work).
  await editor.waitForFunction(() => {
    const v = document.querySelector('video')
    return !!v && v.readyState >= 1 && v.duration > 3.9
  })
  await editor.evaluate(() => {
    document.querySelector('video')!.currentTime = 2
  })
  await editor.waitForFunction(() => document.querySelector('video')!.readyState >= 2)
  await editor.getByLabel('Start', { exact: true }).fill('0:01.0')
  await editor.getByLabel('Start', { exact: true }).press('Enter')
  await editor.getByLabel('End', { exact: true }).fill('0:02.5')
  await editor.getByLabel('End', { exact: true }).press('Enter')
  await editor.screenshot({ path: join(shots, 'media-editor.png') })
  await editor.getByTestId('editor-export').click()
  await expect(editor.getByTestId('editor-status')).toHaveText(/Saved clip-trimmed\.mp4/, { timeout: 30_000 })
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(work, 'clip-trimmed.mp4')]).toString()
  expect(Number(out)).toBeGreaterThan(1.3)
  expect(Number(out)).toBeLessThan(1.7)
  await editor.close()
})

async function openImageEditor(path: string, segment: string) {
  await stubFileDialog([path])
  await home.getByRole('button', { name: /Browse files/ }).click()
  const editorPromise = app.waitForEvent('window')
  await home.getByTestId(`wheel-segment-${segment}`).click()
  return editorPromise
}

test('add background editor exports a padded PNG', async () => {
  const editor = await openImageEditor(join(work, 'sample.png'), 'image.background')
  await editor.getByRole('radio', { name: '1:1' }).click()
  await editor.waitForTimeout(250)
  await editor.screenshot({ path: join(shots, 'background-editor.png') })
  await editor.getByTestId('editor-export').click()
  await expect(editor.getByTestId('editor-status')).toHaveText(/Saved sample-background\.png/, { timeout: 15_000 })
  const meta = await sharp(join(work, 'sample-background.png')).metadata()
  // 320×200 with default padding 8% of 320 (26 px) → 372×252, grown to 1:1 → 372×372
  expect([meta.width, meta.height]).toEqual([372, 372])
  await editor.close()
})

test('redact editor: drawn box is burned in and metadata removed', async () => {
  const src = join(work, 'secret.jpg')
  await sharp({ create: { width: 400, height: 300, channels: 3, background: '#ffffff' } })
    .withExif({ IFD0: { Make: 'SecretCam' } })
    .jpeg({ quality: 95 })
    .toFile(src)
  const editor = await openImageEditor(src, 'image.redact')
  const canvas = editor.getByTestId('redact-canvas')
  await canvas.waitFor()
  const box = (await canvas.boundingBox())!
  // Drag across the middle quarter of the image.
  await editor.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25)
  await editor.mouse.down()
  await editor.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 5 })
  await editor.mouse.up()
  await editor.screenshot({ path: join(shots, 'redact-editor.png') })
  await editor.getByTestId('editor-export').click()
  await expect(editor.getByTestId('editor-status')).toHaveText(/Saved secret-redacted\.jpg/, { timeout: 15_000 })
  const out = join(work, 'secret-redacted.jpg')
  expect((await sharp(out).metadata()).exif).toBeUndefined()
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => data[(y * info.width + x) * info.channels]!
  expect(at(200, 150)).toBeLessThan(20) // centre is black
  expect(at(20, 20)).toBeGreaterThan(235) // corner untouched
  await editor.close()
})

test('metadata view shows camera fields and strips them', async () => {
  const src = join(work, 'camera.jpg')
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#808080' } })
    .withExif({ IFD0: { Make: 'TwirlyCam', Model: 'Z9' } })
    .jpeg()
    .toFile(src)
  const editor = await openImageEditor(src, 'image.metadata')
  await expect(editor.getByTestId('metadata-view')).toContainText('TwirlyCam')
  await expect(editor.getByTestId('metadata-view')).toContainText('Z9')
  await editor.screenshot({ path: join(shots, 'metadata-view.png') })
  await editor.getByTestId('editor-export').click()
  await expect(editor.getByTestId('editor-status')).toHaveText(/Saved camera-clean\.jpg/, { timeout: 15_000 })
  expect((await sharp(join(work, 'camera-clean.jpg')).metadata()).exif).toBeUndefined()
  await editor.close()
})

test('annotate editor: arrow and text are burned into the saved copy', async () => {
  const src = join(work, 'white.png')
  await sharp({ create: { width: 400, height: 300, channels: 3, background: '#ffffff' } }).png().toFile(src)
  const editor = await openImageEditor(src, 'image.annotate')
  const canvas = editor.getByTestId('annotate-canvas')
  await canvas.waitFor()
  await canvas.locator('img').evaluate((img: HTMLImageElement) => img.decode())
  // The preview settles its size after layout; wait until two measurements agree.
  let box = (await canvas.boundingBox())!
  for (let i = 0; i < 20; i++) {
    await editor.waitForTimeout(100)
    const next = (await canvas.boundingBox())!
    if (next.x === box.x && next.y === box.y && next.width === box.width) break
    box = next
  }
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })
  // Arrow (default tool, red) across the top half.
  await editor.mouse.move(at(0.1, 0.3).x, at(0.1, 0.3).y)
  await editor.mouse.down()
  await editor.mouse.move(at(0.8, 0.3).x, at(0.8, 0.3).y, { steps: 6 })
  await editor.mouse.up()
  // Text in the lower half.
  await editor.getByRole('button', { name: 'Text' }).click()
  await editor.mouse.click(at(0.2, 0.6).x, at(0.2, 0.6).y)
  await editor.getByLabel('Annotation text').fill('Look here')
  await editor.getByLabel('Annotation text').press('Enter')
  await editor.screenshot({ path: join(shots, 'annotate-editor.png') })
  await expect(editor.getByTestId('editor-status')).toHaveText('2 annotations')
  await editor.getByTestId('editor-export').click()
  await expect(editor.getByTestId('editor-status')).toHaveText(/Saved white-annotated\.png/, { timeout: 15_000 })
  const { data, info } = await sharp(join(work, 'white-annotated.png')).raw().toBuffer({ resolveWithObject: true })
  const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
  const arrow = px(200, 90)
  expect(arrow[0]).toBeGreaterThan(200)
  expect(arrow[1]).toBeLessThan(100) // red stroke on the shaft
  let inked = 0
  for (let y = 180; y < 240; y++) for (let x = 80; x < 300; x++) if (px(x, y)[1]! < 200) inked++
  expect(inked).toBeGreaterThan(100) // text was drawn
  await editor.close()
})

test('PDF page editor: crop margins become the CropBox', async () => {
  const { PDFDocument } = await import('pdf-lib')
  await stubFileDialog([join(work, 'doc.pdf')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  const editorPromise = app.waitForEvent('window')
  await home.getByTestId('wheel-segment-pdf.edit').click()
  const editor = await editorPromise
  await editor.getByTestId('pdf-page-1').locator('img').waitFor({ timeout: 15_000 })
  await editor.getByRole('button', { name: 'Crop pages' }).click()
  await editor.getByTestId('crop-panel').getByLabel('T').fill('25')
  await editor.getByRole('button', { name: 'Crop all pages' }).click()
  await expect(editor.getByTestId('crop-overlay-0')).toBeVisible()
  await editor.screenshot({ path: join(shots, 'pdf-crop.png') })
  await editor.getByTestId('editor-export').click()
  await expect(editor.getByTestId('editor-status')).toHaveText(/Saved doc-edited \(3\)\.pdf/, { timeout: 15_000 })
  const out = await PDFDocument.load(await readFile(join(work, 'doc-edited (3).pdf')))
  for (const page of out.getPages()) {
    const box = page.getCropBox()
    expect([Math.round(box.width), Math.round(box.height), Math.round(box.y)]).toEqual([200, 75, 0])
  }
  await editor.close()
})

test('PDF → DOCX through the wheel opens in Word with the page text', async () => {
  await stubFileDialog([join(work, 'doc.pdf')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await home.getByTestId('wheel-segment-pdf.to-docx').click()
  await expect(home.getByTestId('job-toast')).toHaveAttribute('data-status', 'done', { timeout: 30_000 })
  await expect(home.getByTestId('job-toast')).toBeHidden({ timeout: 5000 })
  const docx = join(work, 'doc.docx')
  const { execFileSync } = await import('node:child_process')
  const hasWord = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'try { $w = New-Object -ComObject Word.Application; $w.Quit(); "yes" } catch { "no" }'], { encoding: 'utf8' }).trim() === 'yes'
  test.skip(!hasWord, 'Microsoft Word not installed')
  const text = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `$w = New-Object -ComObject Word.Application; try { $d = $w.Documents.Open('${docx}', $false, $true); $d.Content.Text; 'PAGES=' + $d.ComputeStatistics(2); $d.Close($false) } finally { $w.Quit() }`],
    { encoding: 'utf8', timeout: 60_000 },
  )
  expect(text).toContain('Hello page 1')
  expect(text).toContain('Hello page 2')
  expect(text).toContain('PAGES=2')
})

test('PDF compress through the wheel shrinks an image-heavy PDF', async () => {
  const { PDFDocument } = await import('pdf-lib')
  const raw = Buffer.alloc(2400 * 1600 * 3)
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7 + ((i / 3) | 0) % 251) & 255
  const doc = await PDFDocument.create()
  const jpg = await doc.embedJpg(await sharp(raw, { raw: { width: 2400, height: 1600, channels: 3 } }).jpeg({ quality: 98 }).toBuffer())
  doc.addPage([600, 400]).drawImage(jpg, { x: 0, y: 0, width: 600, height: 400 })
  const src = join(work, 'scan.pdf')
  const bytes = await doc.save()
  await writeFile(src, bytes)
  await stubFileDialog([src])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await home.getByTestId('wheel-segment-pdf.compress').click()
  await expect(home.getByTestId('job-toast')).toHaveAttribute('data-status', 'done', { timeout: 30_000 })
  const out = await readFile(join(work, 'scan-compressed.pdf'))
  expect(out.length).toBeLessThan(bytes.length * 0.6)
  expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
  await expect(home.getByTestId('job-toast')).toBeHidden({ timeout: 5000 })
})

test('HEIC tile-grid photo converts to JPG through the wheel', async () => {
  const { existsSync } = await import('node:fs')
  const { copyFile } = await import('node:fs/promises')
  const sample = join(root, 'tests', 'fixtures', 'heic', 'C007.heic')
  test.skip(!existsSync(sample), 'HEIC fixtures not fetched (node scripts/fetch-test-fixtures.mjs)')
  const src = join(work, 'phone.heic')
  await copyFile(sample, src)
  await stubFileDialog([src])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await home.getByTestId('wheel-segment-image.convert.jpeg').click()
  await expect(home.getByTestId('job-toast')).toHaveAttribute('data-status', 'done', { timeout: 60_000 })
  const meta = await sharp(join(work, 'phone-converted.jpg')).metadata()
  expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 2560, 1440])
  await expect(home.getByTestId('job-toast')).toBeHidden({ timeout: 5000 })
})

test('new kinds: folder → ZIP → extract, copy path, text → PDF', async () => {
  const { mkdir: mk } = await import('node:fs/promises')
  const folder = join(work, 'Trip')
  await mk(join(folder, 'photos'), { recursive: true })
  await writeFile(join(folder, 'photos', 'a.txt'), 'sun')
  await writeFile(join(folder, 'notes.txt'), 'Kumusta! mañana ₱100')

  // Folder → ZIP
  await stubFileDialog([folder])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await expect(home.getByTestId('wheel-segment-file.zip')).toBeVisible()
  await home.getByTestId('wheel-segment-file.zip').click()
  await expect(home.getByTestId('job-toast')).toHaveAttribute('data-status', 'done', { timeout: 20_000 })
  await expect(home.getByTestId('job-toast')).toBeHidden({ timeout: 5000 })

  // ZIP → Extract here (folder "Trip" exists, so it becomes "Trip (2)")
  await stubFileDialog([join(work, 'Trip.zip')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await home.getByTestId('wheel-segment-archive.extract').click()
  await expect(home.getByTestId('job-toast-subtitle')).toHaveText('2 files extracted', { timeout: 20_000 })
  expect(await readFile(join(work, 'Trip (2)', 'photos', 'a.txt'), 'utf8')).toBe('sun')
  await expect(home.getByTestId('job-toast')).toBeHidden({ timeout: 5000 })

  // Copy path lands on the clipboard
  await stubFileDialog([folder])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await home.getByTestId('wheel-segment-file.copy-path').click()
  await expect(home.getByTestId('job-toast-subtitle')).toHaveText('Path copied', { timeout: 10_000 })
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(folder)
  await expect(home.getByTestId('job-toast')).toBeHidden({ timeout: 5000 })

  // Text → PDF
  await stubFileDialog([join(folder, 'notes.txt')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await home.getByTestId('wheel-segment-text.to-pdf').click()
  await expect(home.getByTestId('job-toast')).toHaveAttribute('data-status', 'done', { timeout: 20_000 })
  const { PDFDocument } = await import('pdf-lib')
  expect((await PDFDocument.load(await readFile(join(folder, 'notes.pdf')))).getPageCount()).toBe(1)
  await expect(home.getByTestId('job-toast')).toBeHidden({ timeout: 5000 })
})

test('dragging a .docx shows Word actions immediately (Office MIME type)', async () => {
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  await syntheticDrag(home, 'dragenter', 220, 300, [docx])
  await expect(home.getByTestId('wheel-segment-document.extract-images')).toBeVisible()
  const caps = await home.evaluate(() => window.twirly.capabilities())
  if (caps.office.word || caps.libreoffice.available) await expect(home.getByTestId('wheel-segment-document.to-pdf')).toBeVisible()
  await expect(home.getByTestId('radial-wheel')).toHaveAttribute('data-hub', '1 file')
  await syntheticDrag(home, 'dragleave', 0, 0, [docx])
  await expect(home.getByTestId('radial-wheel')).toBeHidden({ timeout: 2000 })
})

test('a broken (zero-filled) .png explains itself instead of offering conversions', async () => {
  const broken = join(work, 'broken-copy.png')
  await writeFile(broken, Buffer.alloc(271))
  await stubFileDialog([broken])
  await home.getByRole('button', { name: /Browse files/ }).click()
  await expect(home.getByTestId('radial-wheel')).toHaveAttribute('data-hub', 'Empty file (no data inside)')
  await expect(home.getByTestId('wheel-segment-image.convert.jpeg')).toHaveCount(0)
  await home.keyboard.press('Escape')
})

test('right-click cancels the wheel', async () => {
  await stubFileDialog([join(work, 'sample.png')])
  await home.getByRole('button', { name: /Browse files/ }).click()
  const wheel = home.getByTestId('radial-wheel')
  await expect(wheel).toBeVisible()
  await wheel.click({ button: 'right' })
  await expect(wheel).toBeHidden({ timeout: 2000 })
})
