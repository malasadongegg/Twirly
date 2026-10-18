import { describe, expect, it } from 'vitest'
import { clampMove, dragHandle, fitAspect, scaleRect } from '@core/image/crop'
import { provisionalFiles } from '@core/file-types/mime'

const bounds = { w: 400, h: 300 }

describe('fitAspect', () => {
  it('returns the whole image for free aspect', () => {
    expect(fitAspect(bounds, null)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
  })
  it('centers the largest rect of the ratio', () => {
    expect(fitAspect(bounds, 1)).toEqual({ x: 50, y: 0, w: 300, h: 300 })
    const wide = fitAspect(bounds, 16 / 9)
    expect(wide.w).toBe(400)
    expect(wide.h).toBeCloseTo(225)
    expect(wide.y).toBeCloseTo(37.5)
  })
})

describe('dragHandle', () => {
  const start = { x: 100, y: 100, w: 100, h: 100 }

  it('moves without leaving bounds', () => {
    expect(dragHandle(start, 'move', 500, -500, bounds, null)).toEqual({ x: 300, y: 0, w: 100, h: 100 })
  })

  it('resizes a free corner and clamps to bounds', () => {
    expect(dragHandle(start, 'se', 50, 20, bounds, null)).toEqual({ x: 100, y: 100, w: 150, h: 120 })
    expect(dragHandle(start, 'se', 999, 999, bounds, null)).toEqual({ x: 100, y: 100, w: 300, h: 200 })
    expect(dragHandle(start, 'nw', -999, -999, bounds, null)).toEqual({ x: 0, y: 0, w: 200, h: 200 })
  })

  it('enforces a minimum size and never inverts', () => {
    const r = dragHandle(start, 'e', -500, 0, bounds, null, 8)
    expect(r.w).toBe(8)
    expect(r.x).toBe(100)
  })

  it.each(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const)('keeps the aspect ratio on %s', (h) => {
    const r = dragHandle(start, h, 37, -23, bounds, 16 / 9)
    expect(r.w / r.h).toBeCloseTo(16 / 9, 5)
    expect(r.x).toBeGreaterThanOrEqual(-1e-9)
    expect(r.y).toBeGreaterThanOrEqual(-1e-9)
    expect(r.x + r.w).toBeLessThanOrEqual(bounds.w + 1e-9)
    expect(r.y + r.h).toBeLessThanOrEqual(bounds.h + 1e-9)
  })

  it('anchors the opposite corner when aspect-locked', () => {
    const r = dragHandle(start, 'nw', -20, -20, bounds, 1)
    expect(r.x + r.w).toBeCloseTo(200)
    expect(r.y + r.h).toBeCloseTo(200)
  })
})

describe('clampMove / scaleRect', () => {
  it('shrinks oversized rects to bounds', () => {
    expect(clampMove({ x: -5, y: -5, w: 999, h: 10 }, bounds)).toEqual({ x: 0, y: 0, w: 400, h: 10 })
  })
  it('maps preview pixels to full-resolution pixels inside the image', () => {
    expect(scaleRect({ x: 10.2, y: 0, w: 50, h: 300 }, 4, { w: 1600, h: 1200 })).toEqual({ left: 41, top: 0, width: 200, height: 1200 })
    expect(scaleRect({ x: 399, y: 299, w: 50, h: 50 }, 4, { w: 1600, h: 1200 })).toEqual({ left: 1596, top: 1196, width: 4, height: 4 })
  })
})

describe('provisionalFiles', () => {
  it('maps drag item MIME types to kinds, ignoring non-file items', () => {
    const files = provisionalFiles([
      { kind: 'file', type: 'image/png' },
      { kind: 'string', type: 'text/uri-list' },
      { kind: 'file', type: 'application/pdf' },
      { kind: 'file', type: '' },
    ])
    expect(files.map((f) => [f.kind, f.format])).toEqual([
      ['image', 'png'],
      ['pdf', 'pdf'],
      ['unknown', 'unknown'],
    ])
  })
})
