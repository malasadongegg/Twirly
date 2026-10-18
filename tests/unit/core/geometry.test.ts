import { describe, expect, it } from 'vitest'
import {
  angleOf,
  hitTest,
  maxCorner,
  placeWheel,
  polar,
  segmentCenterAngle,
  segmentLabelPoint,
  segmentPath,
  type WheelGeometry,
} from '@core/wheel/geometry'

const geo = (count: number): WheelGeometry => ({ count, outer: 150, inner: 64, gap: 6, corner: 14 })

describe('angleOf', () => {
  it('measures clockwise from 12 o’clock in screen coordinates', () => {
    expect(angleOf(0, -1)).toBeCloseTo(0)
    expect(angleOf(1, 0)).toBeCloseTo(90)
    expect(angleOf(0, 1)).toBeCloseTo(180)
    expect(angleOf(-1, 0)).toBeCloseTo(270)
  })
})

describe('hitTest', () => {
  it('returns null on the hub and outside the ring', () => {
    expect(hitTest(0, 0, geo(8))).toBeNull()
    expect(hitTest(0, -63, geo(8))).toBeNull()
    expect(hitTest(0, -151, geo(8))).toBeNull()
  })

  it.each([2, 3, 4, 5, 6, 7, 8])('hits every segment at its center angle (%i segments)', (count) => {
    for (let i = 0; i < count; i++) {
      const p = polar(100, segmentCenterAngle(i, count))
      expect(hitTest(p.x, p.y, geo(count))).toBe(i)
    }
  })

  it('switches segment exactly at the boundary ray', () => {
    // 8 segments: boundary between 0 and 1 is at 22.5°.
    const before = polar(100, 22.4)
    const after = polar(100, 22.6)
    expect(hitTest(before.x, before.y, geo(8))).toBe(0)
    expect(hitTest(after.x, after.y, geo(8))).toBe(1)
    // Wrap-around: just counter-clockwise of 12 o'clock is still segment 0.
    const wrap = polar(100, 359)
    expect(hitTest(wrap.x, wrap.y, geo(8))).toBe(0)
    const last = polar(100, 337)
    expect(hitTest(last.x, last.y, geo(8))).toBe(7)
  })

  it('respects custom hit radii', () => {
    expect(hitTest(0, -160, geo(4), { outerHit: 170 })).toBe(0)
    expect(hitTest(0, -60, geo(4), { innerHit: 50 })).toBe(0)
  })
})

/** Parse the absolute coordinates out of an SVG path (all commands here use absolute coords). */
function pathPoints(d: string): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  const tokens = d.split(/\s+/)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === 'M' || t === 'L') pts.push({ x: +tokens[i + 1]!, y: +tokens[i + 2]! })
    if (t === 'A') pts.push({ x: +tokens[i + 6]!, y: +tokens[i + 7]! })
  }
  return pts
}

describe('segmentPath', () => {
  it.each([2, 4, 6, 8])('keeps every vertex inside the annulus and inside its own sector (%i)', (count) => {
    const g = geo(count)
    for (let i = 0; i < count; i++) {
      const pts = pathPoints(segmentPath(i, g))
      expect(pts.length).toBe(9)
      for (const p of pts) {
        const r = Math.hypot(p.x, p.y)
        expect(r).toBeGreaterThanOrEqual(g.inner - 1e-2)
        expect(r).toBeLessThanOrEqual(g.outer + 1e-2)
        // The vertex must hit-test to this very segment: rendering and hit testing agree.
        expect(hitTest(p.x, p.y, g, { innerHit: g.inner - 1e-2, outerHit: g.outer + 1e-2 })).toBe(i)
      }
    }
  })

  it('leaves a constant-width gap between neighbours', () => {
    const g = geo(8)
    const a = pathPoints(segmentPath(0, g))
    const b = pathPoints(segmentPath(1, g))
    // Outer line tangent of segment 0's end edge vs segment 1's start edge.
    const endOf0 = a[5]! // L at inner end edge
    const startOf1 = b[0]! // M at inner start edge
    expect(Math.hypot(endOf0.x - startOf1.x, endOf0.y - startOf1.y)).toBeCloseTo(g.gap, 1)
  })

  it('offsets paths by the given center', () => {
    const d0 = pathPoints(segmentPath(0, geo(4)))
    const d1 = pathPoints(segmentPath(0, geo(4), 200, 100))
    d0.forEach((p, i) => {
      expect(d1[i]!.x).toBeCloseTo(p.x + 200, 2)
      expect(d1[i]!.y).toBeCloseTo(p.y + 100, 2)
    })
  })

  it('renders a single action as a full ring', () => {
    expect(segmentPath(0, geo(1)).match(/M/g)).toHaveLength(2)
  })

  it('clamps oversized corners instead of producing broken geometry', () => {
    const g = { ...geo(8), corner: 500 }
    expect(segmentPath(0, g)).not.toMatch(/NaN/)
    expect(maxCorner(g)).toBeLessThan(43)
  })
})

describe('segmentLabelPoint', () => {
  it('sits on the mid radius at the segment center', () => {
    const p = segmentLabelPoint(2, geo(4)) // 180°, straight down
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(107)
  })
})

describe('placeWheel', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 }
  it('centers on the cursor when there is room', () => {
    expect(placeWheel({ x: 960, y: 500 }, 360, work)).toEqual({ x: 780, y: 320 })
  })
  it('clamps at screen edges', () => {
    expect(placeWheel({ x: 5, y: 5 }, 360, work)).toEqual({ x: 12, y: 12 })
    expect(placeWheel({ x: 1915, y: 1035 }, 360, work)).toEqual({ x: 1548, y: 668 })
  })
  it('handles monitors with negative origins (left/top of primary)', () => {
    const left = { x: -2560, y: -200, width: 2560, height: 1400 }
    expect(placeWheel({ x: -2555, y: -195 }, 360, left)).toEqual({ x: -2548, y: -188 })
  })
})
