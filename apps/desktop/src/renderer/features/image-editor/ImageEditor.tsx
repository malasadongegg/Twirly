import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FlipHorizontal2, FlipVertical2, FolderOpen, Link2, Link2Off, RotateCcw, RotateCw } from 'lucide-react'
import type { FileInfo } from '@shared/types'
import type { ImagePreview } from '@shared/api'
import { ASPECT_PRESETS, fitAspect, scaleRect, type AspectId, type Rect } from '@core/image/crop'
import { DEFAULT_QUALITY, type ImageOpsInput } from '@core/actions/image-params'
import { IMAGE_OUTPUTS, sameOrPng, type ImageOutputFormat } from '@core/actions/image-formats'
import { formatBytes } from '@core/format/bytes'
import { WindowFrame } from '../../components/FloatingWindow/WindowFrame'
import { Button, FieldRow, IconButton, NumberField, Segmented, Slider } from '../../components/ui/controls'
import { useJob } from '../../hooks/useJob'
import { CropOverlay } from './CropOverlay'

type Rotation = 0 | 90 | 180 | 270
type Mode = 'crop' | 'resize'

const LOSSY: ImageOutputFormat[] = ['jpeg', 'webp', 'avif']

/** Draw `img` rotated then flipped (the same order sharp applies), optionally cropped. */
function drawTransformed(canvas: HTMLCanvasElement, img: HTMLImageElement, rotate: Rotation, flipH: boolean, flipV: boolean, crop?: Rect) {
  const turned = rotate % 180 !== 0
  const w = turned ? img.naturalHeight : img.naturalWidth
  const h = turned ? img.naturalWidth : img.naturalHeight
  const full = document.createElement('canvas')
  full.width = w
  full.height = h
  const fctx = full.getContext('2d')!
  fctx.translate(w / 2, h / 2)
  fctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  fctx.rotate((rotate * Math.PI) / 180)
  fctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)

  const src = crop ?? { x: 0, y: 0, w, h }
  canvas.width = Math.max(1, Math.round(src.w))
  canvas.height = Math.max(1, Math.round(src.h))
  canvas.getContext('2d')!.drawImage(full, src.x, src.y, src.w, src.h, 0, 0, canvas.width, canvas.height)
}

export function ImageEditor({ actionId, file }: { actionId: string; file: FileInfo }) {
  const mode: Mode = actionId === 'image.resize' ? 'resize' : 'crop'
  const [preview, setPreview] = useState<ImagePreview | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rotate, setRotate] = useState<Rotation>(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [aspect, setAspect] = useState<AspectId>('free')
  const [crop, setCrop] = useState<Rect | null>(null)
  const [view, setView] = useState<'edit' | 'result'>('edit')
  const [format, setFormat] = useState<ImageOutputFormat>(sameOrPng(file.format))
  const [quality, setQuality] = useState(DEFAULT_QUALITY[sameOrPng(file.format)])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [lockRatio, setLockRatio] = useState(true)
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const progress = useJob(jobId)
  const outputs = progress?.status === 'done' ? progress.outputs : []

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })

  useEffect(() => {
    let alive = true
    window.twirly
      .imagePreview(file.path, 1400)
      .then((p) => {
        if (!alive) return
        setPreview(p)
        setSize({ w: p.width, h: p.height })
        const el = new Image()
        el.onload = () => alive && setImg(el)
        el.src = p.dataUrl
      })
      .catch((e: Error) => alive && setLoadError(e.message))
    return () => {
      alive = false
    }
  }, [file.path])

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setArea({ w: entry!.contentRect.width, h: entry!.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const turned = rotate % 180 !== 0
  const bounds = useMemo(() => (img ? { w: turned ? img.naturalHeight : img.naturalWidth, h: turned ? img.naturalWidth : img.naturalHeight } : { w: 1, h: 1 }), [img, turned])
  const full = useMemo(() => (preview ? { w: turned ? preview.height : preview.width, h: turned ? preview.width : preview.height } : { w: 1, h: 1 }), [preview, turned])
  const factor = full.w / bounds.w
  const ratio = ASPECT_PRESETS.find((a) => a.id === aspect)!.ratio
  const activeCrop = crop ?? fitAspect(bounds, ratio)

  /** Rotating or flipping invalidates the crop box; a quarter turn also swaps the resize fields. */
  const transform = (next: { rotate?: Rotation; flipH?: boolean; flipV?: boolean }) => {
    setCrop(null)
    if (next.rotate !== undefined) {
      if ((next.rotate - rotate) % 180 !== 0) setSize((s) => ({ w: s.h, h: s.w }))
      setRotate(next.rotate)
    }
    if (next.flipH !== undefined) setFlipH(next.flipH)
    if (next.flipV !== undefined) setFlipV(next.flipV)
  }

  const shown = view === 'result' && mode === 'crop' ? activeCrop : undefined
  useEffect(() => {
    if (img && canvasRef.current) drawTransformed(canvasRef.current, img, rotate, flipH, flipV, shown)
  }, [img, rotate, flipH, flipV, shown])

  const canvasSize = shown ? { w: shown.w, h: shown.h } : bounds
  const displayScale = area.w && area.h ? Math.min(area.w / canvasSize.w, area.h / canvasSize.h, 4) : 0

  const cropPx = scaleRect(activeCrop, factor, full)
  const isFullCrop = cropPx.left === 0 && cropPx.top === 0 && cropPx.width === full.w && cropPx.height === full.h
  const outSize = mode === 'crop' ? { w: cropPx.width, h: cropPx.height } : size

  const setCropSize = (dim: 'w' | 'h', valuePx: number) => {
    const v = valuePx / factor
    const r = { ...activeCrop }
    if (dim === 'w') {
      r.w = Math.min(v, bounds.w - r.x)
      if (ratio) r.h = r.w / ratio
    } else {
      r.h = Math.min(v, bounds.h - r.y)
      if (ratio) r.w = r.h * ratio
    }
    if (r.x + r.w > bounds.w || r.y + r.h > bounds.h) return
    setCrop(r)
  }

  const setResize = (dim: 'w' | 'h', v: number) => {
    const ar = full.w / full.h
    if (!lockRatio) return setSize((s) => ({ ...s, [dim]: v }))
    setSize(dim === 'w' ? { w: v, h: Math.max(1, Math.round(v / ar)) } : { w: Math.max(1, Math.round(v * ar)), h: v })
  }

  const busy = progress?.status === 'running' || progress?.status === 'queued' || (jobId !== null && !progress)

  const submit = useCallback(async () => {
    const ops: ImageOpsInput = { rotate, flipH, flipV, format, quality: LOSSY.includes(format) ? quality : undefined }
    if (mode === 'crop' && !isFullCrop) ops.crop = cropPx
    if (mode === 'resize') ops.resize = { width: size.w, height: size.h }
    setSubmitError(null)
    try {
      const { jobId: id } = await window.twirly.runJob({ actionId, paths: [file.path], params: ops as Record<string, unknown> })
      setJobId(id)
    } catch (e) {
      setSubmitError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }, [rotate, flipH, flipV, format, quality, mode, isFullCrop, cropPx, size, actionId, file.path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void window.twirly.closeWindow()
      if (e.key === 'Enter' && !busy && (e.target as HTMLElement).tagName !== 'BUTTON') void submit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, submit])

  const title = mode === 'crop' ? 'Crop image' : 'Resize image'
  const done = progress?.status === 'done'
  const failed = progress?.status === 'failed'

  return (
    <WindowFrame
      title={title}
      subtitle={`${file.name} · ${preview ? `${preview.width} × ${preview.height}` : '…'} · ${formatBytes(file.size)}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => void window.twirly.closeWindow()}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          <div className="min-w-0 flex-1 truncate text-center text-xs" data-testid="editor-status">
            {submitError || failed ? (
              <span className="text-danger">{submitError ?? progress?.error?.message}</span>
            ) : done ? (
              <span className="text-success">Saved {outputs.at(-1)?.split(/[\\/]/).pop()}</span>
            ) : busy ? (
              <span className="text-fg-2">Saving…</span>
            ) : (
              <span className="text-fg-3 tabular-nums">
                Output {outSize.w} × {outSize.h} px
              </span>
            )}
          </div>
          {done && outputs.at(-1) ? (
            <Button onClick={() => void window.twirly.showInFolder(outputs.at(-1)!)}>
              <FolderOpen size={14} /> Show
            </Button>
          ) : null}
          <Button variant="primary" disabled={!img || busy} onClick={() => void submit()} data-testid="editor-export">
            {done ? 'Save again' : mode === 'crop' ? 'Save crop' : 'Save resized'}
          </Button>
        </>
      }
    >
      <div ref={areaRef} className="relative mx-4 mt-4 min-h-0 flex-1" data-testid="editor-preview">
        {loadError && <div className="absolute inset-0 flex items-center justify-center text-sm text-danger">{loadError}</div>}
        {!img && !loadError && <div className="absolute inset-0 animate-pulse rounded-lg bg-surface" />}
        {img && displayScale > 0 && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm"
            style={{
              width: canvasSize.w * displayScale,
              height: canvasSize.h * displayScale,
              backgroundImage: preview?.hasAlpha ? 'repeating-conic-gradient(#1c2530 0 25%, #151b23 0 50%)' : undefined,
              backgroundSize: '16px 16px',
            }}
          >
            <canvas ref={canvasRef} className="block h-full w-full" />
            {mode === 'crop' && view === 'edit' && <CropOverlay rect={activeCrop} bounds={bounds} scale={displayScale} ratio={ratio} onChange={setCrop} />}
          </div>
        )}
        {!img && <canvas ref={canvasRef} className="hidden" />}
      </div>

      <div className="space-y-2.5 px-4 pb-3 pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            <IconButton label="Rotate left" onClick={() => transform({ rotate: ((rotate + 270) % 360) as Rotation })}>
              <RotateCcw size={15} />
            </IconButton>
            <IconButton label="Rotate right" onClick={() => transform({ rotate: ((rotate + 90) % 360) as Rotation })}>
              <RotateCw size={15} />
            </IconButton>
            <IconButton label="Flip horizontal" aria-pressed={flipH} className={flipH ? 'text-accent-hover' : ''} onClick={() => transform({ flipH: !flipH })}>
              <FlipHorizontal2 size={15} />
            </IconButton>
            <IconButton label="Flip vertical" aria-pressed={flipV} className={flipV ? 'text-accent-hover' : ''} onClick={() => transform({ flipV: !flipV })}>
              <FlipVertical2 size={15} />
            </IconButton>
          </div>
          {mode === 'crop' && (
            <Segmented
              label="Preview"
              value={view}
              onChange={setView}
              options={[
                { value: 'edit', label: 'Before' },
                { value: 'result', label: 'After' },
              ]}
            />
          )}
        </div>

        {mode === 'crop' ? (
          <>
            <FieldRow label="Aspect ratio">
              <Segmented
                label="Aspect ratio"
                value={aspect}
                onChange={(a) => {
                  setAspect(a)
                  setCrop(null)
                }}
                options={ASPECT_PRESETS.map((a) => ({ value: a.id, label: a.label }))} />
            </FieldRow>
            <FieldRow label="Crop size">
              <NumberField label="W" value={cropPx.width} max={full.w} onChange={(v) => setCropSize('w', v)} unit="" />
              <NumberField label="H" value={cropPx.height} max={full.h} onChange={(v) => setCropSize('h', v)} unit="px" />
            </FieldRow>
          </>
        ) : (
          <>
            <FieldRow label="Size">
              <NumberField label="W" value={size.w} onChange={(v) => setResize('w', v)} />
              <IconButton label={lockRatio ? 'Unlock aspect ratio' : 'Lock aspect ratio'} aria-pressed={lockRatio} onClick={() => setLockRatio((v) => !v)}>
                {lockRatio ? <Link2 size={14} /> : <Link2Off size={14} />}
              </IconButton>
              <NumberField label="H" value={size.h} onChange={(v) => setResize('h', v)} unit="px" />
            </FieldRow>
            <FieldRow label="Scale">
              {[25, 50, 75, 100].map((p) => (
                <Button key={p} className="h-7 px-2 text-xs" onClick={() => setSize({ w: Math.max(1, Math.round((full.w * p) / 100)), h: Math.max(1, Math.round((full.h * p) / 100)) })}>
                  {p}%
                </Button>
              ))}
            </FieldRow>
          </>
        )}

        <FieldRow label="Format">
          <Segmented
            label="Output format"
            value={format}
            onChange={(f) => {
              setFormat(f)
              setQuality(DEFAULT_QUALITY[f])
            }}
            options={IMAGE_OUTPUTS.map((f) => ({ value: f.id, label: f.label }))}
          />
        </FieldRow>
        {LOSSY.includes(format) && <Slider label="Quality" value={quality} min={1} max={100} onChange={setQuality} />}
      </div>
    </WindowFrame>
  )
}
