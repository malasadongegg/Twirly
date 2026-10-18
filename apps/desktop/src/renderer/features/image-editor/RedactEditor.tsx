import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ShieldCheck, Trash2, X } from 'lucide-react'
import type { FileInfo } from '@shared/types'
import { WindowFrame } from '../../components/FloatingWindow/WindowFrame'
import { Button, FieldRow, IconButton, Segmented } from '../../components/ui/controls'
import { EditorFooter } from './EditorFooter'
import { useBoxSize, useEditorJob, useImagePreview } from './useImageJob'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Draw boxes over sensitive areas. Export burns solid color into the pixels (no blur or
 * pixelation, which can be reversed) and drops all metadata.
 */
export function RedactEditor({ actionId, file }: { actionId: string; file: FileInfo }) {
  const { preview, error: loadError } = useImagePreview(file.path)
  const job = useEditorJob(actionId, file.path)
  const [areaRef, area] = useBoxSize<HTMLDivElement>()
  const [boxes, setBoxes] = useState<Box[]>([])
  const [fill, setFill] = useState<'black' | 'white'>('black')
  const [draft, setDraft] = useState<Box | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  const scale = preview && area.w && area.h ? Math.min(area.w / preview.width, area.h / preview.height, 4) : 0
  // Pointer → full-resolution image coordinates, clamped to the image.
  const toImage = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(Math.max((e.clientX - r.left) / scale, 0), preview!.width),
      y: Math.min(Math.max((e.clientY - r.top) / scale, 0), preview!.height),
    }
  }
  const norm = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  })

  const regions = boxes.map((b) => ({
    left: Math.floor(b.x),
    top: Math.floor(b.y),
    width: Math.max(1, Math.ceil(b.x + b.w) - Math.floor(b.x)),
    height: Math.max(1, Math.ceil(b.y + b.h) - Math.floor(b.y)),
  }))

  return (
    <WindowFrame
      title="Redact"
      subtitle={file.name}
      footer={
        <EditorFooter
          {...job}
          idle={boxes.length ? `${boxes.length} area${boxes.length === 1 ? '' : 's'} · metadata will be removed` : 'Drag over the image to cover an area'}
          primary="Save redacted copy"
          primaryDisabled={boxes.length === 0}
          onPrimary={() => void job.run({ regions, fill })}
        />
      }
    >
      <div ref={areaRef} className="relative mx-4 mt-4 min-h-0 flex-1" data-testid="editor-preview">
        {loadError && <div className="p-6 text-center text-sm text-danger">{loadError}</div>}
        {preview && scale > 0 && (
          <div
            data-testid="redact-canvas"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-crosshair touch-none"
            style={{ width: preview.width * scale, height: preview.height * scale }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              start.current = toImage(e)
              setDraft({ ...start.current, w: 0, h: 0 })
            }}
            onPointerMove={(e) => start.current && setDraft(norm(start.current, toImage(e)))}
            onPointerUp={(e) => {
              if (start.current) {
                const b = norm(start.current, toImage(e))
                if (b.w * scale > 3 && b.h * scale > 3) setBoxes((bs) => [...bs, b])
              }
              start.current = null
              setDraft(null)
            }}
          >
            <img src={preview.dataUrl} alt="" draggable={false} className="pointer-events-none h-full w-full select-none" />
            {[...boxes, ...(draft ? [draft] : [])].map((b, i) => (
              <div
                key={i}
                className={`group absolute ${fill === 'black' ? 'bg-black' : 'bg-white'} ring-1 ring-accent`}
                style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale }}
              >
                {i < boxes.length && (
                  <button
                    type="button"
                    aria-label={`Remove area ${i + 1}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setBoxes((bs) => bs.filter((_, j) => j !== i))}
                    className="absolute -right-2 -top-2 hidden h-4 w-4 items-center justify-center rounded-full bg-accent text-white group-hover:flex"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2.5 px-4 pb-3 pt-3">
        <FieldRow label="Fill">
          <Segmented
            label="Fill color"
            value={fill}
            onChange={setFill}
            options={[
              { value: 'black', label: 'Black' },
              { value: 'white', label: 'White' },
            ]}
          />
          <IconButton label="Undo last area" disabled={!boxes.length} onClick={() => setBoxes((bs) => bs.slice(0, -1))}>
            <Trash2 size={14} />
          </IconButton>
          <Button className="h-7 px-2 text-xs" disabled={!boxes.length} onClick={() => setBoxes([])}>
            Clear
          </Button>
        </FieldRow>
        <p className="flex items-start gap-2 rounded-md bg-surface p-2 text-[11px] leading-relaxed text-fg-2">
          <ShieldCheck size={14} className="mt-px shrink-0 text-success" />
          Covered pixels are replaced, not blurred, so they cannot be recovered. All metadata (camera, GPS, embedded thumbnails) is removed from the copy.
        </p>
      </div>
    </WindowFrame>
  )
}
