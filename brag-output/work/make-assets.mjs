// Demo assets for the trailer: a synthetic sunset "photo" and a fictional invoice (no real data).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const out = join(import.meta.dirname, 'assets')
mkdirSync(out, { recursive: true })

const sunset = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067" viewBox="0 0 1600 1067">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b2a6b"/><stop offset="0.45" stop-color="#c2477a"/><stop offset="0.7" stop-color="#ff8a4c"/><stop offset="1" stop-color="#ffd27a"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6d6"/><stop offset="0.6" stop-color="#ffd27a"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f08a5d"/><stop offset="1" stop-color="#2b1d4f"/></linearGradient>
  </defs>
  <rect width="1600" height="700" fill="url(#sky)"/>
  <circle cx="1050" cy="610" r="210" fill="url(#sun)"/>
  <circle cx="1050" cy="610" r="95" fill="#fff1c4"/>
  <path d="M0 640 L180 520 L330 600 L520 450 L700 590 L860 500 L1010 640 L1010 700 L0 700 Z" fill="#6a3478"/>
  <path d="M600 660 L820 540 L980 620 L1180 500 L1400 610 L1600 540 L1600 700 L600 700 Z" fill="#3d2160"/>
  <rect y="690" width="1600" height="377" fill="url(#sea)"/>
  <g fill="#ffe7a8" opacity="0.55">
    <rect x="990" y="720" width="120" height="6" rx="3"/><rect x="960" y="760" width="180" height="5" rx="2.5"/>
    <rect x="1000" y="805" width="100" height="5" rx="2.5"/><rect x="940" y="850" width="220" height="4" rx="2"/>
    <rect x="1010" y="900" width="80" height="4" rx="2"/>
  </g>
  <path d="M120 760 q40 -30 80 0 q-40 18 -80 0z" fill="#1d1236"/>
</svg>`
await sharp(Buffer.from(sunset)).png().toFile(join(out, 'sunset.png'))

const invoice = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" font-family="Segoe UI, Arial">
  <rect width="1200" height="900" fill="#eef1f5"/>
  <rect x="140" y="60" width="920" height="780" rx="14" fill="#ffffff" stroke="#d7dce3"/>
  <text x="200" y="150" font-size="44" font-weight="700" fill="#0b0f14">ACME Supply Co.</text>
  <text x="200" y="190" font-size="22" fill="#66727f">Invoice #10482 · Oct 2026</text>
  <text x="200" y="270" font-size="22" fill="#66727f">Bill to</text>
  <text x="200" y="306" font-size="30" font-weight="600" fill="#0b0f14">Jordan Vale</text>
  <text x="200" y="344" font-size="24" fill="#33404d">42 Example Lane, Springfield</text>
  <line x1="200" y1="390" x2="1000" y2="390" stroke="#e3e7ec" stroke-width="2"/>
  <text x="200" y="440" font-size="24" fill="#33404d">Ergonomic chair</text><text x="1000" y="440" font-size="24" fill="#33404d" text-anchor="end">$249.00</text>
  <text x="200" y="490" font-size="24" fill="#33404d">Standing desk</text><text x="1000" y="490" font-size="24" fill="#33404d" text-anchor="end">$499.00</text>
  <text x="200" y="540" font-size="24" fill="#33404d">Cable tray</text><text x="1000" y="540" font-size="24" fill="#33404d" text-anchor="end">$39.00</text>
  <line x1="200" y1="580" x2="1000" y2="580" stroke="#e3e7ec" stroke-width="2"/>
  <text x="200" y="630" font-size="28" font-weight="700" fill="#0b0f14">Total</text><text x="1000" y="630" font-size="28" font-weight="700" fill="#0b0f14" text-anchor="end">$787.00</text>
  <text x="200" y="720" font-size="22" fill="#66727f">Paid with card</text>
  <text x="200" y="760" font-size="30" font-weight="600" fill="#0b0f14" letter-spacing="2">4111 2222 3333 4444</text>
</svg>`
await sharp(Buffer.from(invoice)).png().toFile(join(out, 'invoice.png'))
console.log('assets ok')
