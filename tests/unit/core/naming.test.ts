import { describe, expect, it } from 'vitest'
import { outputFileName, sanitizeFileName, splitName, withCounter } from '@core/naming/output-name'
import { formatBytes } from '@core/format/bytes'

describe('output naming', () => {
  it('builds suffixed names', () => {
    expect(outputFileName('photo.png', 'converted', 'webp')).toBe('photo-converted.webp')
    expect(outputFileName('video.mp4', 'compressed', 'mp4')).toBe('video-compressed.mp4')
    expect(outputFileName('my.photo.final.JPG', 'cropped', 'jpg', { separator: ' ' })).toBe('my.photo.final cropped.jpg')
  })
  it('handles names without extensions and dotfiles', () => {
    expect(splitName('README')).toEqual({ base: 'README', ext: '' })
    expect(splitName('.env')).toEqual({ base: '.env', ext: '' })
  })
  it('adds collision counters', () => {
    expect(withCounter('photo-converted.webp', 1)).toBe('photo-converted.webp')
    expect(withCounter('photo-converted.webp', 2)).toBe('photo-converted (2).webp')
  })
  it('keeps Unicode and strips characters Windows forbids', () => {
    expect(outputFileName('写真 ☀.png', 'converted', 'jpg')).toBe('写真 ☀-converted.jpg')
    expect(sanitizeFileName('a<b>:c?.')).toBe('a_b__c_')
  })
})

describe('formatBytes', () => {
  it('formats like the wheel hub', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1258291)).toBe('1.2 MB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(250 * 1024)).toBe('250 KB')
  })
})
