// Captures REAL Twirly editor windows (built app, 2× device scale) for the trailer.
// Run from the repo root after `npm run build`: node brag-output/work/capture-editors.mjs
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'

const root = process.cwd()
const work = join(root, 'brag-output', 'work')
const files = join(work, 'files')
const shots = join(work, 'shots')
rmSync(files, { recursive: true, force: true })
mkdirSync(files, { recursive: true })
mkdirSync(shots, { recursive: true })
copyFileSync(join(work, 'assets', 'sunset.png'), join(files, 'sunset.png'))
copyFileSync(join(work, 'assets', 'invoice.png'), join(files, 'invoice.png'))

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'))
env.TWIRLY_USER_DATA = join(work, 'user-data')
const app = await electron.launch({ args: ['--force-device-scale-factor=2', join(root, 'out', 'main', 'index.js')], env })
let home
for (;;) {
  home = app.windows().find((p) => p.url().endsWith('/index.html'))
  if (home) break
  await app.waitForEvent('window')
}
await home.waitForSelector('[data-testid="drop-zone"]')

async function editor(file, segment) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, join(files, file))
  await home.getByRole('button', { name: /Browse files/ }).click()
  const next = app.waitForEvent('window')
  await home.getByTestId(`wheel-segment-${segment}`).click()
  const win = await next
  await win.waitForSelector('[data-testid="editor-preview"] img, [data-testid="editor-preview"] canvas', { timeout: 15_000 })
  await win.waitForTimeout(600)
  return win
}

// Crop: 4:3 preset on the sunset.
{
  const w = await editor('sunset.png', 'image.crop')
  await w.getByRole('radio', { name: '4:3' }).click()
  await w.waitForTimeout(400)
  await w.screenshot({ path: join(shots, 'crop.png') })
  await w.close()
}

// Annotate: circle the sun, arrow to it, label.
{
  const w = await editor('sunset.png', 'image.annotate')
  const c = w.getByTestId('annotate-canvas')
  const b = await c.boundingBox()
  const at = (fx, fy) => [b.x + b.width * fx, b.y + b.height * fy]
  await w.getByRole('button', { name: 'Ellipse' }).click()
  await w.getByRole('radio', { name: '#f59e0b' }).click()
  let [x, y] = at(0.58, 0.44)
  await w.mouse.move(x, y)
  await w.mouse.down()
  ;[x, y] = at(0.74, 0.68)
  await w.mouse.move(x, y, { steps: 8 })
  await w.mouse.up()
  await w.getByRole('button', { name: 'Arrow' }).click()
  await w.getByRole('radio', { name: '#ffffff' }).click()
  ;[x, y] = at(0.22, 0.24)
  await w.mouse.move(x, y)
  await w.mouse.down()
  ;[x, y] = at(0.55, 0.47)
  await w.mouse.move(x, y, { steps: 8 })
  await w.mouse.up()
  await w.getByRole('button', { name: 'Text' }).click()
  ;[x, y] = at(0.08, 0.1)
  await w.mouse.click(x, y)
  await w.getByLabel('Annotation text').fill('Golden hour')
  await w.getByLabel('Annotation text').press('Enter')
  await w.waitForTimeout(300)
  await w.screenshot({ path: join(shots, 'annotate.png') })
  await w.close()
}

// Redact: cover the (fictional) name and card number.
{
  const w = await editor('invoice.png', 'image.redact')
  const c = w.getByTestId('redact-canvas')
  const b = await c.boundingBox()
  const box = async (fx1, fy1, fx2, fy2) => {
    await w.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1)
    await w.mouse.down()
    await w.mouse.move(b.x + b.width * fx2, b.y + b.height * fy2, { steps: 6 })
    await w.mouse.up()
  }
  await box(0.155, 0.305, 0.43, 0.395)
  await box(0.155, 0.8, 0.62, 0.865)
  await w.waitForTimeout(300)
  await w.screenshot({ path: join(shots, 'redact.png') })
  await w.close()
}

// Add background: lagoon gradient, square canvas.
{
  const w = await editor('sunset.png', 'image.background')
  await w.getByRole('radio', { name: 'lagoon' }).click()
  await w.getByRole('radio', { name: '1:1' }).click()
  await w.waitForTimeout(400)
  await w.screenshot({ path: join(shots, 'background.png') })
  await w.close()
}

await app.close()
console.log('captured', shots)
