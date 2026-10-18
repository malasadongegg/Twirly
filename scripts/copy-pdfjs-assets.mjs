// Copies pdf.js runtime assets (fonts, CMaps, ICC profiles, WASM decoders) into the renderer's
// public folder so they ship with the app and load from 'self' under the CSP.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const src = join(root, 'node_modules', 'pdfjs-dist')
const dest = join(root, 'apps', 'desktop', 'src', 'renderer', 'public', 'pdfjs')

if (!existsSync(src)) {
  console.error('pdfjs-dist is not installed')
  process.exit(1)
}
rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(join(src, dir))) cpSync(join(src, dir), join(dest, dir), { recursive: true })
}
console.log('pdf.js assets copied to', dest)
