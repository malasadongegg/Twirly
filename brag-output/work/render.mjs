// Renders the composition: `node render.mjs --stills 1.0,2.3` writes review stills,
// `node render.mjs` writes every frame (30 fps) to work/frames/.
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'

const work = import.meta.dirname
const FPS = 30
const stillsArg = process.argv.indexOf('--stills')
const stills = stillsArg > 0 ? process.argv[stillsArg + 1].split(',').map(Number) : null

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'))
const app = await electron.launch({ args: [join(work, 'render-main.cjs')], env })
const page = await app.firstWindow()
await page.waitForFunction(() => typeof window.__render === 'function')
const duration = await page.evaluate(() => window.__duration)

async function shot(t, path) {
  await page.evaluate((tt) => window.__render(tt), t)
  await page.screenshot({ path, clip: { x: 0, y: 0, width: 1920, height: 1080 } })
}

if (stills) {
  const dir = join(work, 'stills')
  mkdirSync(dir, { recursive: true })
  for (const t of stills) await shot(t, join(dir, `t${t.toFixed(2)}.png`))
  console.log('stills in', dir)
} else {
  const dir = join(work, 'frames')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const total = Math.round(duration * FPS)
  const started = Date.now()
  for (let i = 0; i < total; i++) {
    await shot(i / FPS, join(dir, `f${String(i).padStart(5, '0')}.png`))
    if (i % 60 === 0) console.log(`frame ${i}/${total} (${((Date.now() - started) / 1000).toFixed(0)} s)`)
  }
  console.log('frames done', total)
}
await app.close()
