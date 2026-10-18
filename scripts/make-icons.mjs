// Generates the Twirly app and tray icons from an SVG mark (eight wheel segments around a hub).
// Usage: node scripts/make-icons.mjs
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const out = join(import.meta.dirname, '..', 'assets')
mkdirSync(out, { recursive: true })

function segment(i, n, R, r, gapDeg) {
  const rad = (d) => (d * Math.PI) / 180
  const a0 = rad(i * (360 / n) - 180 / n + gapDeg / 2 - 90)
  const a1 = rad(i * (360 / n) + 180 / n - gapDeg / 2 - 90)
  const p = (rr, a) => `${(rr * Math.cos(a)).toFixed(2)} ${(rr * Math.sin(a)).toFixed(2)}`
  return `M ${p(r, a0)} L ${p(R, a0)} A ${R} ${R} 0 0 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 0 0 ${p(r, a0)} Z`
}

function mark({ size, background }) {
  const segs = Array.from({ length: 8 }, (_, i) => {
    const fill = i === 0 ? 'url(#accent)' : '#1c2530'
    return `<path d="${segment(i, 8, 228, 112, 7)}" fill="${fill}" stroke="rgba(255,255,255,0.10)" stroke-width="3"/>`
  }).join('')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-256 -256 512 512">
    <defs>
      <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#2563eb"/></linearGradient>
      <radialGradient id="hub"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1d4ed8"/></radialGradient>
    </defs>
    ${background ? '<circle r="252" fill="#0b0f14"/>' : ''}
    ${segs}
    <circle r="92" fill="#0b0f14" stroke="rgba(255,255,255,0.14)" stroke-width="4"/>
    <circle r="44" fill="url(#hub)"/>
  </svg>`)
}

await sharp(mark({ size: 512, background: true })).png().toFile(join(out, 'icon.png'))
for (const [name, size] of [['tray.png', 16], ['tray@2x.png', 32]]) {
  await sharp(mark({ size: 512, background: true })).resize(size, size).png().toFile(join(out, name))
}
console.log('icons written to', out)
