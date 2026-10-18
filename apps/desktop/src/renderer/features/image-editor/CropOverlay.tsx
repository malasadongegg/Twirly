import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { dragHandle, type Handle, type Rect, type Size } from '@core/image/crop'

const HANDLES: {
  id: Exclude<Handle, 'move'>
  style: React.CSSProperties
  cursor: string
  corner: boolean
}[] = [
  { id: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize', corner: true },
  { id: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize', corner: true },
  { id: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize', corner: true },
  { id: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize', corner: true },
  { id: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize', corner: false },
  { id: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize', corner: false },
  { id: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize', corner: false },
  { id: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize', corner: false },
]

export interface CropOverlayProps {
  /** Crop rect in image (canvas) pixels. */
  rect: Rect
  bounds: Size
  /** CSS px per image px. */
  scale: number
  ratio: number | null
  onChange: (r: Rect) => void
}

/**
 * Crop rectangle with corner and edge handles. Outside the crop is dimmed with a large spread
 * shadow; the parent clips it. Arrow keys nudge the crop (Shift = 10 px) for keyboard users.
 */
export function CropOverlay({ rect, bounds, scale, ratio, onChange }: CropOverlayProps) {
  const drag = useRef<{ handle: Handle; x: number; y: number; start: Rect } | null>(null)

  const begin = (e: ReactPointerEvent, handle: Handle) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { handle, x: e.clientX, y: e.clientY, start: rect }
  }
  const move = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    onChange(
      dragHandle(d.start, d.handle, (e.clientX - d.x) / scale, (e.clientY - d.y) / scale, bounds, ratio),
    )
  }
  const end = () => {
    drag.current = null
  }

  const dim = 'pointer-events-none absolute bg-[rgb(5_8_12/0.62)]'
  const L = rect.x * scale
  const T = rect.y * scale
  const W = rect.w * scale
  const H = rect.h * scale
  return (
    <>
      {/* Dimmed area outside the crop, as four rectangles so nothing needs clipping. */}
      <div className={dim} style={{ left: 0, top: 0, right: 0, height: T }} />
      <div className={dim} style={{ left: 0, top: T + H, right: 0, bottom: 0 }} />
      <div className={dim} style={{ left: 0, top: T, width: L, height: H }} />
      <div className={dim} style={{ left: L + W, top: T, right: 0, height: H }} />
      <div
        data-testid="crop-rect"
        role="group"
        aria-label="Crop area. Use arrow keys to move."
        tabIndex={0}
        className="absolute cursor-move outline-none"
        style={{ left: L, top: T, width: W, height: H }}
        onPointerDown={(e) => begin(e, 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 1
          const delta = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          }[e.key]
          if (!delta) return
          e.preventDefault()
          onChange(dragHandle(rect, 'move', delta[0]!, delta[1]!, bounds, ratio))
        }}
      >
        {/* Rule-of-thirds guides */}
        <div className="pointer-events-none absolute inset-0 border border-white/80 outline outline-1 outline-black/40">
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/15" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/15" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/15" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/15" />
        </div>
        {HANDLES.map((h) => (
          <div
            key={h.id}
            data-testid={`crop-handle-${h.id}`}
            onPointerDown={(e) => begin(e, h.id)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute -translate-x-1/2 -translate-y-1/2 p-2"
            style={{ ...h.style, cursor: h.cursor }}
          >
            <div
              className={`rounded-[2px] bg-white outline-2 outline-accent shadow-[0_0_6px_rgb(0_0_0/0.6)] ${h.corner ? 'h-2.5 w-2.5' : h.id === 'n' || h.id === 's' ? 'h-1 w-5' : 'h-5 w-1'}`}
            />
          </div>
        ))}
      </div>
    </>
  )
}
