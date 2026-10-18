/**
 * Minimal, bounds-checked EXIF reader for the fields people care about (camera, dates,
 * exposure, software, GPS). Input is the raw EXIF block as sharp returns it
 * (optionally starting with "Exif\0\0", then a TIFF header).
 */

import type { ExifField, ExifSummary } from '@shared/types'

export type { ExifField, ExifSummary }

type Tag = { label: string; group: ExifField['group'] }

const IFD0_TAGS: Record<number, Tag> = {
  0x010f: { label: 'Make', group: 'Camera' },
  0x0110: { label: 'Model', group: 'Camera' },
  0x0131: { label: 'Software', group: 'Image' },
  0x0132: { label: 'Modified', group: 'Image' },
  0x013b: { label: 'Artist', group: 'Author' },
  0x8298: { label: 'Copyright', group: 'Author' },
  0x010e: { label: 'Description', group: 'Image' },
}
const EXIF_TAGS: Record<number, Tag> = {
  0x9003: { label: 'Taken', group: 'Image' },
  0x829a: { label: 'Exposure', group: 'Exposure' },
  0x829d: { label: 'Aperture', group: 'Exposure' },
  0x8827: { label: 'ISO', group: 'Exposure' },
  0x920a: { label: 'Focal length', group: 'Exposure' },
  0xa434: { label: 'Lens', group: 'Camera' },
  0xa431: { label: 'Body serial', group: 'Camera' },
  0xa435: { label: 'Lens serial', group: 'Camera' },
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

class Reader {
  constructor(
    private readonly b: Uint8Array,
    private readonly base: number,
    private readonly le: boolean,
  ) {}
  ok(off: number, len: number) {
    return off >= 0 && this.base + off + len <= this.b.length
  }
  u16(off: number) {
    const p = this.base + off
    return this.le ? this.b[p]! | (this.b[p + 1]! << 8) : (this.b[p]! << 8) | this.b[p + 1]!
  }
  u32(off: number) {
    const p = this.base + off
    const v = this.le
      ? this.b[p]! | (this.b[p + 1]! << 8) | (this.b[p + 2]! << 16) | (this.b[p + 3]! << 24)
      : (this.b[p]! << 24) | (this.b[p + 1]! << 16) | (this.b[p + 2]! << 8) | this.b[p + 3]!
    return v >>> 0
  }
  ascii(off: number, len: number) {
    let s = ''
    for (let i = 0; i < len; i++) {
      const c = this.b[this.base + off + i]!
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s.trim()
  }
}

interface Entry {
  tag: number
  type: number
  count: number
  /** Offset (relative to TIFF start) where the value bytes live. */
  valueOff: number
}

function readIfd(r: Reader, off: number): Entry[] {
  if (!r.ok(off, 2)) return []
  const n = r.u16(off)
  const out: Entry[] = []
  for (let i = 0; i < Math.min(n, 512); i++) {
    const e = off + 2 + i * 12
    if (!r.ok(e, 12)) break
    const type = r.u16(e + 2)
    const count = r.u32(e + 4)
    const size = (TYPE_SIZE[type] ?? 0) * count
    const valueOff = size <= 4 ? e + 8 : r.u32(e + 8)
    if (size === 0 || !r.ok(valueOff, Math.min(size, 1 << 20))) continue
    out.push({ tag: r.u16(e), type, count, valueOff })
  }
  return out
}

const rational = (r: Reader, off: number, signed = false): number => {
  let n = r.u32(off)
  let d = r.u32(off + 4)
  if (signed) {
    n = n | 0
    d = d | 0
  }
  return d === 0 ? 0 : n / d
}

function scalar(r: Reader, e: Entry): number {
  if (e.type === 3) return r.u16(e.valueOff)
  if (e.type === 4 || e.type === 9) return r.u32(e.valueOff)
  if (e.type === 5) return rational(r, e.valueOff)
  if (e.type === 10) return rational(r, e.valueOff, true)
  return NaN
}

function format(label: string, r: Reader, e: Entry): string {
  if (e.type === 2) return r.ascii(e.valueOff, e.count)
  const v = scalar(r, e)
  if (!Number.isFinite(v)) return ''
  switch (label) {
    case 'Exposure':
      return v > 0 && v < 1 ? `1/${Math.round(1 / v)} s` : `${v} s`
    case 'Aperture':
      return `f/${v.toFixed(1)}`
    case 'Focal length':
      return `${Math.round(v * 10) / 10} mm`
    default:
      return String(v)
  }
}

function dms(r: Reader, e: Entry | undefined): number | undefined {
  if (!e || e.type !== 5 || e.count < 3) return undefined
  return rational(r, e.valueOff) + rational(r, e.valueOff + 8) / 60 + rational(r, e.valueOff + 16) / 3600
}

export function readExif(raw: Uint8Array | undefined | null): ExifSummary {
  const empty: ExifSummary = { fields: [] }
  if (!raw || raw.length < 14) return empty
  let base = 0
  if (raw[0] === 0x45 && raw[1] === 0x78 && raw[2] === 0x69 && raw[3] === 0x66) base = 6 // "Exif\0\0"
  const le = raw[base] === 0x49 && raw[base + 1] === 0x49
  const be = raw[base] === 0x4d && raw[base + 1] === 0x4d
  if (!le && !be) return empty
  const r = new Reader(raw, base, le)
  if (r.u16(2) !== 42) return empty

  const fields: ExifField[] = []
  const ifd0 = readIfd(r, r.u32(4))
  const collect = (entries: Entry[], tags: Record<number, Tag>) => {
    for (const e of entries) {
      const t = tags[e.tag]
      if (!t) continue
      const value = format(t.label, r, e)
      if (value) fields.push({ group: t.group, label: t.label, value })
    }
  }
  collect(ifd0, IFD0_TAGS)

  const exifPtr = ifd0.find((e) => e.tag === 0x8769)
  if (exifPtr) collect(readIfd(r, r.u32(exifPtr.valueOff)), EXIF_TAGS)

  let gps: ExifSummary['gps']
  const gpsPtr = ifd0.find((e) => e.tag === 0x8825)
  if (gpsPtr) {
    const g = readIfd(r, r.u32(gpsPtr.valueOff))
    const by = (tag: number) => g.find((e) => e.tag === tag)
    const lat = dms(r, by(0x0002))
    const lon = dms(r, by(0x0004))
    if (lat !== undefined && lon !== undefined) {
      const latRef = by(0x0001) ? r.ascii(by(0x0001)!.valueOff, 2) : 'N'
      const lonRef = by(0x0003) ? r.ascii(by(0x0003)!.valueOff, 2) : 'E'
      const alt = by(0x0006)
      gps = {
        lat: latRef === 'S' ? -lat : lat,
        lon: lonRef === 'W' ? -lon : lon,
        altitude: alt && alt.type === 5 ? rational(r, alt.valueOff) : undefined,
      }
      fields.push({ group: 'Location', label: 'GPS', value: `${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}` })
    }
  }
  return { fields, gps }
}
