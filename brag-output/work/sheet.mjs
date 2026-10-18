// Contact sheet of review stills, in time order: node sheet.mjs <dir> <out>
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
const [dir, out] = process.argv.slice(2)
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort((a, b) => parseFloat(a.slice(1)) - parseFloat(b.slice(1)))
const w = 640, h = 360, cols = 4
const rows = Math.ceil(files.length / cols)
const tiles = await Promise.all(files.map(async (f, i) => ({ input: await sharp(join(dir, f)).resize(w, h).png().toBuffer(), left: (i % cols) * (w + 6), top: Math.floor(i / cols) * (h + 6) })))
await sharp({ create: { width: cols * (w + 6), height: rows * (h + 6), channels: 3, background: '#222' } }).composite(tiles).png().toFile(out)
console.log(files.join(' '))
