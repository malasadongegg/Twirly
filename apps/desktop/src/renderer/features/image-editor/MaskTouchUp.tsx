import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { MaskStroke } from '@core/actions/image-extras'
import { Button, FieldRow, Segmented, Slider } from '../../components/ui/controls'

export type BrushTool = 'off' | 'keep' | 'erase'

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the preview'))
    img.src = src
  })

/** The automatic mask (alpha = subject) at preview size, requested once when first needed. */
export function useCutoutMask(path: string, maxSize: number, enabled: boolean) {
  const [result, setResult] = useState<{ url?: string; error?: string }>({})
  const requested = useRef(false)
  useEffect(() => {
    if (!enabled || requested.current) return
    requested.current = true
    window.twirly
      .removeBgMask(path, maxSize)
      .then((url) => setResult({ url }))
      .catch((e: Error) => setResult({ error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
  }, [path, maxSize, enabled])
  return { ...result, busy: enabled && !result.url && !result.error }
}

/** Undoable list of touch-up strokes. */
export function useStrokes() {
  const [strokes, setStrokes] = useState<MaskStroke[]>([])
  return {
    strokes,
    add: useCallback((s: MaskStroke) => setStrokes((list) => [...list, s]), []),
    undo: useCallback(() => setStrokes((list) => list.slice(0, -1)), []),
    reset: useCallback(() => setStrokes([]), []),
  }
}

/**
 * The image with the mask applied, drawn on a canvas at preview resolution. With a brush tool
 * selected, dragging paints strokes in full-image pixel coordinates (what the export uses).
 */
export function MaskedImage({
  imageUrl,
  maskUrl,
  width,
  height,
  scale,
  strokes,
  tool,
  brush,
  onStroke,
  style,
}: {
  imageUrl: string
  maskUrl: string
  /** Full image size; strokes use these coordinates. */
  width: number
  height: number
  /** Screen pixels per image pixel. */
  scale: number
  strokes: MaskStroke[]
  tool: BrushTool
  /** Brush diameter in image pixels. */
  brush: number
  onStroke: (s: MaskStroke) => void
  style?: CSSProperties
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvas = useRef<HTMLCanvasElement | null>(null)
  const [images, setImages] = useState<{ img: HTMLImageElement; mask: HTMLImageElement } | null>(null)
  const live = useRef<MaskStroke | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([loadImage(imageUrl), loadImage(maskUrl)]).then(([img, mask]) => alive && setImages({ img, mask }))
    return () => {
      alive = false
    }
  }, [imageUrl, maskUrl])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !images) return
    const { img, mask } = images
    const w = mask.naturalWidth
    const h = mask.naturalHeight
    canvas.width = w
    canvas.height = h
    const mc = (maskCanvas.current ??= document.createElement('canvas'))
    mc.width = w
    mc.height = h
    const m = mc.getContext('2d')!
    m.drawImage(mask, 0, 0)
    const k = w / width
    for (const s of live.current ? [...strokes, live.current] : strokes) {
      m.globalCompositeOperation = s.mode === 'keep' ? 'source-over' : 'destination-out'
      m.strokeStyle = m.fillStyle = '#000'
      m.lineWidth = s.size * k
      m.lineCap = m.lineJoin = 'round'
      m.beginPath()
      if (s.points.length === 1) {
        m.arc(s.points[0]![0] * k, s.points[0]![1] * k, (s.size * k) / 2, 0, Math.PI * 2)
        m.fill()
      } else {
        s.points.forEach(([x, y], i) => (i === 0 ? m.moveTo(x * k, y * k) : m.lineTo(x * k, y * k)))
        m.stroke()
      }
    }
    m.globalCompositeOperation = 'source-over'
    const c = canvas.getContext('2d')!
    c.globalCompositeOperation = 'source-over'
    c.clearRect(0, 0, w, h)
    c.drawImage(img, 0, 0, w, h)
    c.globalCompositeOperation = 'destination-in'
    c.drawImage(mc, 0, 0)
    c.globalCompositeOperation = 'source-over'
  }, [images, strokes, width])

  useEffect(draw, [draw])

  const toImage = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return [Math.min(Math.max((e.clientX - r.left) / scale, 0), width), Math.min(Math.max((e.clientY - r.top) / scale, 0), height)] as [number, number]
  }

  const painting = tool !== 'off'
  return (
    <div className="relative" style={{ width: width * scale, height: height * scale }}>
      <canvas
        ref={canvasRef}
        data-testid="subject"
        data-ready={images ? 'true' : undefined}
        data-strokes={strokes.length}
        style={{ width: width * scale, height: height * scale, display: 'block', cursor: painting ? 'none' : undefined, touchAction: 'none', ...style }}
        onPointerDown={(e) => {
          if (!painting) return
          e.currentTarget.setPointerCapture(e.pointerId)
          live.current = { mode: tool, size: brush, points: [toImage(e)] }
          draw()
        }}
        onPointerMove={(e) => {
          if (painting) {
            const r = e.currentTarget.getBoundingClientRect()
            setCursor({ x: e.clientX - r.left, y: e.clientY - r.top })
          }
          const s = live.current
          if (!s) return
          const p = toImage(e)
          const last = s.points.at(-1)!
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) * scale < 1.5) return
          if (s.points.length < 20_000) s.points.push(p)
          draw()
        }}
        onPointerUp={() => {
          const s = live.current
          live.current = null
          if (s) onStroke(s)
        }}
        onPointerLeave={() => setCursor(null)}
      />
      {painting && cursor && (
        <div
          className="pointer-events-none absolute rounded-full border-2"
          style={{
            left: cursor.x - (brush * scale) / 2,
            top: cursor.y - (brush * scale) / 2,
            width: brush * scale,
            height: brush * scale,
            borderColor: tool === 'keep' ? '#4ade80' : '#f87171',
            boxShadow: '0 0 0 1px rgb(0 0 0 / 0.6)',
          }}
        />
      )}
    </div>
  )
}

/** Brush controls: Off / Keep / Erase, size, undo, reset. */
export function TouchUpTools({
  tool,
  onTool,
  brush,
  onBrush,
  maxBrush,
  canUndo,
  onUndo,
  onReset,
}: {
  tool: BrushTool
  onTool: (t: BrushTool) => void
  brush: number
  onBrush: (n: number) => void
  maxBrush: number
  canUndo: boolean
  onUndo: () => void
  onReset: () => void
}) {
  return (
    <>
      <FieldRow label="Touch up">
        <div className="flex items-center gap-1.5">
          <Segmented
            label="Touch-up brush"
            value={tool}
            onChange={onTool}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'keep', label: 'Keep', title: 'Paint over parts that should stay' },
              { value: 'erase', label: 'Erase', title: 'Paint over parts that should go' },
            ]}
          />
          <Button className="h-6 px-2 text-[11px]" disabled={!canUndo} onClick={onUndo}>
            Undo
          </Button>
          <Button className="h-6 px-2 text-[11px]" disabled={!canUndo} onClick={onReset}>
            Reset
          </Button>
        </div>
      </FieldRow>
      {tool !== 'off' && <Slider label="Brush" value={brush} min={2} max={maxBrush} onChange={onBrush} suffix=" px" />}
    </>
  )
}
