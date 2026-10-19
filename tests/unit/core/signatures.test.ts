import { describe, expect, it } from 'vitest'
import { detectFormat, extensionMatches } from '@core/file-types/signatures'

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))

describe('detectFormat', () => {
  it.each([
    ['png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png', 'image'],
    ['jpeg', bytes([0xff, 0xd8, 0xff, 0xe0]), 'jpg', 'image'],
    ['webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'webp', 'image'],
    ['gif', bytes('GIF89a'), 'gif', 'image'],
    ['tiff LE', bytes([0x49, 0x49, 0x2a, 0x00]), 'tif', 'image'],
    ['bmp', bytes('BM', new Array(30).fill(0)), 'bmp', 'image'],
    ['pdf', bytes('%PDF-1.7'), 'pdf', 'pdf'],
    ['avif', bytes([0, 0, 0, 0x1c], 'ftypavif'), 'avif', 'image'],
    ['heic', bytes([0, 0, 0, 0x18], 'ftypheic'), 'heic', 'image'],
    ['mp4', bytes([0, 0, 0, 0x20], 'ftypisom'), 'mp4', 'video'],
    ['mov', bytes([0, 0, 0, 0x14], 'ftypqt  '), 'mov', 'video'],
    ['webm', bytes([0x1a, 0x45, 0xdf, 0xa3], 'xxxxwebm'), 'webm', 'video'],
    ['mp3 id3', bytes('ID3'), 'mp3', 'audio'],
    ['wav', bytes('RIFF', [0, 0, 0, 0], 'WAVE'), 'wav', 'audio'],
    ['flac', bytes('fLaC'), 'flac', 'audio'],
  ])('detects %s', (_name, data, ext, kind) => {
    const r = detectFormat(data, ext)
    expect(r.kind).toBe(kind)
  })

  it('trusts the signature over the extension', () => {
    const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(detectFormat(png, 'jpg')).toEqual({ format: 'png', kind: 'image' })
  })

  it('uses the extension only for ZIP-based Office files and text', () => {
    const zip = bytes([0x50, 0x4b, 0x03, 0x04])
    expect(detectFormat(zip, 'docx').kind).toBe('document')
    expect(detectFormat(zip, 'zip').kind).toBe('archive')
    expect(detectFormat(bytes('hello'), 'txt').kind).toBe('text')
    expect(detectFormat(bytes('he', [0], 'llo'), 'txt').kind).toBe('unknown')
  })

  it('returns unknown for empty and random data', () => {
    expect(detectFormat(new Uint8Array(), 'png').format).toBe('unknown')
    expect(detectFormat(bytes([1, 2, 3, 4, 5]), 'png').format).toBe('unknown')
  })
})

describe('extensionMatches', () => {
  it('accepts aliases', () => {
    expect(extensionMatches('jpeg', 'JPG')).toBe(true)
    expect(extensionMatches('tiff', 'tif')).toBe(true)
    expect(extensionMatches('png', 'jpg')).toBe(false)
  })
})
