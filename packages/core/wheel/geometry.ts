/**
 * Radial wheel geometry. Angles are in degrees, measured clockwise from 12 o'clock, in screen
 * coordinates (y grows downward). The same parameters drive rendering (`segmentPath`) and
 * pointer hit testing (`hitTest`), so what the user sees is what they hit.
 */

export interface WheelGeometry {
  /** Number of segments, 1..12. */
  count: number
  /** Segment outer radius. */
  outer: number
  /** Segment inner radius. */
  inner: number
  /** Constant-width gutter between adjacent segments, in px. */
  gap: number
  /** Corner fillet radius, in px. Clamped to what the segment can hold. */
  corner: number
}

export interface Point {
  x: number
  y: number
}

const RAD = Math.PI / 180

/** Unit vector pointing from the center toward angle `deg`. */
export function direction(deg: number): Point {
  return { x: Math.sin(deg * RAD), y: -Math.cos(deg * RAD) }
}

export function polar(radius: number, deg: number): Point {
  const d = direction(deg)
  return { x: d.x * radius, y: d.y * radius }
}

export const segmentSpan = (count: number): number => 360 / count

/** Center angle of segment `index`. Segment 0 is centered at 12 o'clock. */
export const segmentCenterAngle = (index: number, count: number): number => index * segmentSpan(count)

/** Normalize to [0, 360). */
export function normalizeAngle(deg: number): number {
  const a = deg % 360
  return a < 0 ? a + 360 : a
}

/** Angle of point (x, y) relative to the center, clockwise from 12 o'clock. */
export function angleOf(x: number, y: number): number {
  return normalizeAngle(Math.atan2(x, -y) / RAD)
}

export interface HitOptions {
  /** Distance below which the pointer is "on the hub" (no segment). Defaults to `inner`. */
  innerHit?: number
  /** Distance above which the pointer is "outside" (no segment). Defaults to `outer`. */
  outerHit?: number
}

/**
 * Segment index under (x, y), given relative to the wheel center, or null for hub/outside.
 * Gutters are split down the middle between the two neighbours, so there is no dead zone between
 * segments, only at the hub and outside the ring.
 */
export function hitTest(x: number, y: number, g: Pick<WheelGeometry, 'count' | 'inner' | 'outer'>, opts: HitOptions = {}): number | null {
  const dist = Math.hypot(x, y)
  const innerHit = opts.innerHit ?? g.inner
  const outerHit = opts.outerHit ?? g.outer
  if (dist < innerHit || dist > outerHit || g.count < 1) return null
  const span = segmentSpan(g.count)
  return Math.floor(normalizeAngle(angleOf(x, y) + span / 2) / span) % g.count
}

const fmt = (n: number): string => (Math.abs(n) < 1e-9 ? '0' : Number(n.toFixed(3)).toString())
const pt = (p: Point, cx: number, cy: number): string => `${fmt(cx + p.x)} ${fmt(cy + p.y)}`

/**
 * A fillet between a radial edge line and a circle of radius `radius`.
 * The edge line is the set of points p with p·n = halfGap, where n is the edge normal pointing
 * into the segment and u the edge direction. Returns the tangent points on the line and on the
 * circle.
 */
function fillet(u: Point, n: Point, halfGap: number, radius: number, corner: number, outerSide: boolean) {
  const rho = outerSide ? radius - corner : radius + corner
  const b = halfGap + corner
  const a = Math.sqrt(Math.max(rho * rho - b * b, 0))
  const center = { x: u.x * a + n.x * b, y: u.y * a + n.y * b }
  const onLine = { x: u.x * a + n.x * halfGap, y: u.y * a + n.y * halfGap }
  const scale = radius / rho
  const onArc = { x: center.x * scale, y: center.y * scale }
  return { onLine, onArc }
}

/** Largest corner radius that keeps all four fillets inside the segment. */
export function maxCorner(g: WheelGeometry): number {
  const thickness = g.outer - g.inner
  const span = segmentSpan(g.count) * RAD
  // Arc length available at the inner edge, after the gutters, must hold two fillets.
  const innerArc = g.inner * span - g.gap
  return Math.max(0, Math.min(thickness / 2 - 0.5, innerArc / 2 - 0.5))
}

/** SVG path data for segment `index`, centered at (cx, cy). */
export function segmentPath(index: number, g: WheelGeometry, cx = 0, cy = 0): string {
  if (g.count === 1) {
    // A single action becomes a full ring (even-odd fill).
    const ring = (r: number) =>
      `M ${fmt(cx)} ${fmt(cy - r)} A ${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(cx)} ${fmt(cy + r)} A ${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(cx)} ${fmt(cy - r)} Z`
    return `${ring(g.outer)} ${ring(g.inner)}`
  }

  const span = segmentSpan(g.count)
  const mid = segmentCenterAngle(index, g.count)
  const start = mid - span / 2
  const end = mid + span / 2
  const half = g.gap / 2
  const c = Math.min(Math.max(g.corner, 0), maxCorner(g))

  // Edge directions and inward normals (normal points into the segment).
  const uS = direction(start)
  const nS = { x: Math.cos(start * RAD), y: Math.sin(start * RAD) }
  const uE = direction(end)
  const nE = { x: -Math.cos(end * RAD), y: -Math.sin(end * RAD) }

  const sOut = fillet(uS, nS, half, g.outer, c, true)
  const eOut = fillet(uE, nE, half, g.outer, c, true)
  const eIn = fillet(uE, nE, half, g.inner, c, false)
  const sIn = fillet(uS, nS, half, g.inner, c, false)

  const R = fmt(g.outer)
  const r = fmt(g.inner)
  const k = fmt(c)
  // Arc spans are below 180° whenever count >= 2, so the large-arc flag is always 0.
  return [
    `M ${pt(sIn.onLine, cx, cy)}`,
    `L ${pt(sOut.onLine, cx, cy)}`,
    `A ${k} ${k} 0 0 1 ${pt(sOut.onArc, cx, cy)}`,
    `A ${R} ${R} 0 0 1 ${pt(eOut.onArc, cx, cy)}`,
    `A ${k} ${k} 0 0 1 ${pt(eOut.onLine, cx, cy)}`,
    `L ${pt(eIn.onLine, cx, cy)}`,
    `A ${k} ${k} 0 0 1 ${pt(eIn.onArc, cx, cy)}`,
    `A ${r} ${r} 0 0 0 ${pt(sIn.onArc, cx, cy)}`,
    `A ${k} ${k} 0 0 1 ${pt(sIn.onLine, cx, cy)}`,
    'Z',
  ].join(' ')
}

/** Where to place a segment's icon/label: on the mid radius at the segment's center angle. */
export function segmentLabelPoint(index: number, g: Pick<WheelGeometry, 'count' | 'inner' | 'outer'>): Point {
  if (g.count === 1) return polar((g.inner + g.outer) / 2, 0)
  return polar((g.inner + g.outer) / 2, segmentCenterAngle(index, g.count))
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Clamp a wheel of `size` centered at `cursor` so it stays inside `workArea` with `margin`.
 * Returns the top-left of the wheel's bounding box.
 */
export function placeWheel(cursor: Point, size: number, workArea: Rect, margin = 12): Point {
  const half = size / 2
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi))
  return {
    x: Math.round(clamp(cursor.x - half, workArea.x + margin, workArea.x + workArea.width - size - margin)),
    y: Math.round(clamp(cursor.y - half, workArea.y + margin, workArea.y + workArea.height - size - margin)),
  }
}
