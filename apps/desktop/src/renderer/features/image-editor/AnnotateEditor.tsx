import { createElement, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowUpRight, Circle, Highlighter, Minus, Pencil, Redo2, Square, Type, Undo2 } from 'lucide-react'
import type { FileInfo } from '@shared/types'
import { annotationElements, type Shape } from '@core/image/annotate'
import { WindowFrame } from '../../components/FloatingWindow/WindowFrame'
import { FieldRow, IconButton, Segmented } from '../../components/ui/controls'
import { EditorFooter } from './EditorFooter'
import { useBoxSize, useEditorJob, useImagePreview } from './useImageJob'

type Tool = 'arrow' | 'rect' | 'ellipse' | 'line' | 'pen' | 'highlight' | 'text'
const TOOLS: { id: Tool; label: string; icon: typeof Square }[] = [
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'line', label: 'Line', icon: Minus },
  { id: 'pen', label: 'Pen', icon: Pencil },
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'text', label: 'Text', icon: Type },
]
const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#0b0f14']
const SIZES = { s: 0.004, m: 0.008, l: 0.016 } as const

/** Render shapes with the exact element list the export uses. */
function ShapesSvg({ shapes, width, height }: { shapes: Shape[]; width: number; height: number }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      {annotationElements(shapes).map((el, i) => {
        // SVG attribute names are hyphenated; React accepts them as-is on SVG elements via props.
        const props: Record<string, string | number> = { key: i }
        for (const [k, v] of Object.entries(el.attrs)) props[k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = v
        return createElement(el.tag, props, el.text)
      })}
    </svg>
  )
}

export function AnnotateEditor({ actionId, file }: { actionId: string; file: FileInfo }) {
  const { preview, error: loadError } = useImagePreview(file.path)
  const job = useEditorJob(actionId, file.path)
  const [areaRef, area] = useBoxSize<HTMLDivElement>()
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState(COLORS[0]!)
  const [size, setSize] = useState<keyof typeof SIZES>('m')
  const [shapes, setShapes] = useState<Shape[]>([])
  const [redo, setRedo] = useState<Shape[]>([])
  const [draft, setDraft] = useState<Shape | null>(null)
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null)
  const [textValue, setTextValue] = useState('')
  const drawing = useRef(false)

  const W = preview?.width ?? 1
  const H = preview?.height ?? 1
  const scale = preview && area.w && area.h ? Math.min(area.w / W, area.h / H, 4) : 0
  const width = Math.max(1, Math.round(Math.max(W, H) * SIZES[size]))
  const textSize = Math.max(8, Math.round(Math.max(W, H) * SIZES[size] * 5))

  const toImage = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: Math.min(Math.max((e.clientX - r.left) / scale, 0), W), y: Math.min(Math.max((e.clientY - r.top) / scale, 0), H) }
  }
  const commit = (s: Shape) => {
    setShapes((list) => [...list, s])
    setRedo([])
  }
  const undo = () =>
    setShapes((list) => {
      if (!list.length) return list
      setRedo((r) => [...r, list.at(-1)!])
      return list.slice(0, -1)
    })
  const redoOne = () =>
    setRedo((r) => {
      if (!r.length) return r
      setShapes((list) => [...list, r.at(-1)!])
      return r.slice(0, -1)
    })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textAt) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redoOne()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redoOne()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const finishText = () => {
    if (textAt && textValue.trim()) commit({ type: 'text', at: textAt, text: textValue.trim(), color, size: textSize })
    setTextAt(null)
    setTextValue('')
  }

  return (
    <WindowFrame
      title="Annotate"
      subtitle={file.name}
      footer={
        <EditorFooter
          {...job}
          idle={shapes.length ? `${shapes.length} annotation${shapes.length === 1 ? '' : 's'}` : 'Pick a tool and draw on the image'}
          primary="Save annotated copy"
          primaryDisabled={shapes.length === 0}
          onPrimary={() => void job.run({ shapes })}
        />
      }
    >
      <div className="flex items-center gap-0.5 border-b border-line px-3 py-1.5" role="toolbar" aria-label="Annotation tools">
        {TOOLS.map((t) => (
          <IconButton key={t.id} label={t.label} aria-pressed={tool === t.id} className={tool === t.id ? 'bg-accent/20 text-accent-hover' : ''} onClick={() => setTool(t.id)}>
            <t.icon size={15} />
          </IconButton>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <IconButton label="Undo" disabled={!shapes.length} onClick={undo}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton label="Redo" disabled={!redo.length} onClick={redoOne}>
          <Redo2 size={15} />
        </IconButton>
      </div>

      <div ref={areaRef} className="relative mx-4 mt-3 min-h-0 flex-1" data-testid="editor-preview">
        {loadError && <div className="p-6 text-center text-sm text-danger">{loadError}</div>}
        {preview && scale > 0 && (
          <div
            data-testid="annotate-canvas"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-crosshair touch-none"
            style={{ width: W * scale, height: H * scale }}
            // The click's own mousedown would blur the text box we open on pointerdown.
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              if (textAt) return finishText()
              const p = toImage(e)
              if (tool === 'text') {
                setTextAt(p)
                return
              }
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = true
              setDraft(tool === 'pen' ? { type: 'pen', points: [p, p], color, width } : { type: tool, from: p, to: p, color, width })
            }}
            onPointerMove={(e) => {
              if (!drawing.current || !draft) return
              const p = toImage(e)
              setDraft(draft.type === 'pen' ? { ...draft, points: [...draft.points, p] } : 'from' in draft ? { ...draft, to: p } : draft)
            }}
            onPointerUp={() => {
              if (!drawing.current || !draft) return
              drawing.current = false
              const tiny = 'from' in draft ? Math.hypot(draft.to.x - draft.from.x, draft.to.y - draft.from.y) * scale < 4 : draft.type === 'pen' && draft.points.length < 3
              if (!tiny) commit(draft)
              setDraft(null)
            }}
          >
            <img src={preview.dataUrl} alt="" draggable={false} className="pointer-events-none h-full w-full select-none" />
            <ShapesSvg shapes={draft ? [...shapes, draft] : shapes} width={W} height={H} />
            {textAt && (
              <input
                autoFocus
                aria-label="Annotation text"
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishText()
                  if (e.key === 'Escape') {
                    setTextAt(null)
                    setTextValue('')
                  }
                }}
                onBlur={finishText}
                className="absolute min-w-24 rounded border border-accent bg-black/60 px-1 font-semibold outline-none"
                style={{ left: textAt.x * scale, top: textAt.y * scale, color, fontSize: Math.max(11, textSize * scale) }}
              />
            )}
          </div>
        )}
      </div>

      <div className="space-y-2.5 px-4 pb-3 pt-3">
        <FieldRow label="Color">
          <div className="flex gap-1.5" role="radiogroup" aria-label="Color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={`h-5 w-5 rounded-full border ${color === c ? 'border-white ring-2 ring-accent' : 'border-line-strong'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </FieldRow>
        <FieldRow label="Size">
          <Segmented
            label="Stroke size"
            value={size}
            onChange={setSize}
            options={[
              { value: 's', label: 'Thin' },
              { value: 'm', label: 'Medium' },
              { value: 'l', label: 'Bold' },
            ]}
          />
        </FieldRow>
      </div>
    </WindowFrame>
  )
}
