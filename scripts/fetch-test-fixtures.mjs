// Downloads sample HEIC files used by tests/integration/heic.test.ts (not committed).
// Source: Nokia HEIF reference repo. 3B_HEIC_SDR.heic is CC0; C007.heic is a conformance file
// (2×2 tile grid, the layout phones use).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '..', 'tests', 'fixtures', 'heic')
mkdirSync(dir, { recursive: true })
const files = {
  'C007.heic': 'https://raw.githubusercontent.com/nokiatech/heif/gh-pages/content/conformance/C007.heic',
  '3B_HEIC_SDR.heic': 'https://raw.githubusercontent.com/nokiatech/heif/gh-pages/content/cc0/3B_HEIC_SDR.heic',
}
for (const [name, url] of Object.entries(files)) {
  const target = join(dir, name)
  if (existsSync(target)) continue
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  writeFileSync(target, Buffer.from(await res.arrayBuffer()))
  console.log('fetched', name)
}
