import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckSquare, Crop, FolderOpen, RotateCcw, RotateCw, Square, Trash2 } from 'lucide-react'
import type { FileInfo } from '@shared/types'
import { formatBytes } from '@core/format/bytes'
import { WindowFrame } from '../../components/FloatingWindow/WindowFrame'
import { Button, IconButton, NumberField } from '../../components/ui/controls'
import type { CropMargins } from '@core/actions/pdf-params'
import { useJob } from '../../hooks/useJob'
import { openPdf, renderToCanvas, type PdfDoc } from '../../lib/pdf'

type Rotation = 0 | 90 | 180 | 270
interface PageItem {
  key: number
  index: number
  rotate: Rotation
  crop?: CropMargins
}

const hasCrop = (c?: CropMargins) => !!c && (c.left > 0 || c.top > 0 || c.right > 0 || c.bottom > 0)

/** Crop margins panel: values in percent of the page, applied to the selection (or all pages). */
function CropPanel({ onApply, onClear, target }: { onApply: (c: CropMargins) => void; onClear: () => void; target: string }) {
  const [m, setM] = useState({ top: 0, right: 0, bottom: 0, left: 0 })
  const field = (k: keyof typeof m, label: string) => (
    <NumberField label={label} value={m[k]} min={0} max={45} unit="%" onChange={(v) => setM((s) => ({ ...s, [k]: v }))} />
  )
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-3 py-2" data-testid="crop-panel">
      {field('top', 'T')}
      {field('right', 'R')}
      {field('bottom', 'B')}
      {field('left', 'L')}
      <div className="ml-auto flex gap-1.5">
        <Button className="h-7 px-2 text-xs" onClick={onClear}>
          Remove crop
        </Button>
        <Button
          variant="primary"
          className="h-7 px-2 text-xs"
          onClick={() => onApply({ top: m.top / 100, right: m.right / 100, bottom: m.bottom / 100, left: m.left / 100 })}
        >
          Crop {target}
        </Button>
      </div>
    </div>
  )
}

const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Page thumbnails rendered lazily at low resolution, one at a time. */
function useThumbnails(doc: PdfDoc | null): Record<number, string> {
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  useEffect(() => {
    if (!doc) return
    let alive = true
    ;(async () => {
      for (let i = 0; i < doc.numPages && alive; i++) {
        const canvas = await renderToCanvas(doc, i, 36)
        if (!alive) return
        const url = canvas.toDataURL('image/png')
        setThumbs((t) => ({ ...t, [i]: url }))
      }
    })().catch(() => undefined)
    return () => {
      alive = false
    }
  }, [doc])
  return thumbs
}

export function PdfEditor({ actionId, file }: { actionId: string; file: FileInfo }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pages, setPages] = useState<PageItem[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dragKey, setDragKey] = useState<number | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const progress = useJob(jobId)
  const thumbs = useThumbnails(doc)

  useEffect(() => {
    let alive = true
    window.twirly
      .pdfBytes(file.path)
      .then((bytes) => openPdf(bytes))
      .then((d) => {
        if (!alive) return
        setDoc(d)
        setPages(Array.from({ length: d.numPages }, (_, i) => ({ key: i, index: i, rotate: 0 })))
      })
      .catch((e) => alive && setLoadError(cleanError(e)))
    return () => {
      alive = false
    }
  }, [file.path])

  const busy = progress?.status === 'running' || progress?.status === 'queued' || (jobId !== null && !progress)
  const done = progress?.status === 'done'
  const outputs = done ? progress.outputs : []
  const selection = useMemo(() => pages.filter((p) => selected.has(p.key)), [pages, selected])

  const toggle = (key: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const targets = () => (selected.size ? selected : new Set(pages.map((p) => p.key)))
  const rotate = (by: 90 | 270) => {
    const t = targets()
    setPages((ps) => ps.map((p) => (t.has(p.key) ? { ...p, rotate: ((p.rotate + by) % 360) as Rotation } : p)))
  }
  const applyCrop = (crop: CropMargins | undefined) => {
    const t = targets()
    setPages((ps) => ps.map((p) => (t.has(p.key) ? { ...p, crop } : p)))
  }
  const remove = () => {
    setPages((ps) => ps.filter((p) => !selected.has(p.key)))
    setSelected(new Set())
  }
  const move = (dir: -1 | 1) =>
    setPages((ps) => {
      const next = [...ps]
      const order = dir === -1 ? next.map((_, i) => i) : next.map((_, i) => next.length - 1 - i)
      for (const i of order) {
        const j = i + dir
        if (selected.has(next[i]!.key) && j >= 0 && j < next.length && !selected.has(next[j]!.key)) [next[i], next[j]] = [next[j]!, next[i]!]
      }
      return next
    })
  const dropOn = (targetKey: number) => {
    if (dragKey === null || dragKey === targetKey) return
    setPages((ps) => {
      const from = ps.findIndex((p) => p.key === dragKey)
      const to = ps.findIndex((p) => p.key === targetKey)
      const next = [...ps]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item!)
      return next
    })
    setDragKey(null)
  }

  const exportPages = async (list: PageItem[]) => {
    setSubmitError(null)
    try {
      const { jobId: id } = await window.twirly.runJob({
        actionId,
        paths: [file.path],
        params: { pages: list.map((p) => ({ index: p.index, rotate: p.rotate, ...(hasCrop(p.crop) ? { crop: p.crop } : {}) })) },
      })
      setJobId(id)
    } catch (e) {
      setSubmitError(cleanError(e))
    }
  }

  return (
    <WindowFrame
      title="Edit pages"
      subtitle={`${file.name} · ${doc ? `${doc.numPages} pages` : '…'} · ${formatBytes(file.size)}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => void window.twirly.closeWindow()}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          <div className="min-w-0 flex-1 truncate text-center text-xs" data-testid="editor-status">
            {submitError || progress?.status === 'failed' ? (
              <span className="text-danger">{submitError ?? progress?.error?.message}</span>
            ) : done ? (
              <span className="text-success">Saved {outputs.at(-1)?.split(/[\\/]/).pop()}</span>
            ) : busy ? (
              <span className="text-fg-2">Saving…</span>
            ) : (
              <span className="text-fg-3">
                {pages.length} page{pages.length === 1 ? '' : 's'}
                {selected.size ? ` · ${selected.size} selected` : ''}
              </span>
            )}
          </div>
          {done && outputs.at(-1) && (
            <Button onClick={() => void window.twirly.showInFolder(outputs.at(-1)!)}>
              <FolderOpen size={14} /> Show
            </Button>
          )}
          {selected.size > 0 && (
            <Button disabled={busy} onClick={() => void exportPages(selection)} data-testid="pdf-extract">
              Extract {selected.size}
            </Button>
          )}
          <Button variant="primary" disabled={!doc || busy || pages.length === 0} onClick={() => void exportPages(pages)} data-testid="editor-export">
            Save PDF
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-0.5 border-b border-line px-3 py-1.5">
        <IconButton
          label={selected.size === pages.length && pages.length > 0 ? 'Select none' : 'Select all'}
          onClick={() => setSelected(selected.size === pages.length ? new Set() : new Set(pages.map((p) => p.key)))}
        >
          {selected.size === pages.length && pages.length > 0 ? <CheckSquare size={15} /> : <Square size={15} />}
        </IconButton>
        <span className="mx-1 h-4 w-px bg-line" />
        <IconButton label="Rotate left" onClick={() => rotate(270)}>
          <RotateCcw size={15} />
        </IconButton>
        <IconButton label="Rotate right" onClick={() => rotate(90)}>
          <RotateCw size={15} />
        </IconButton>
        <IconButton label="Move selection earlier" disabled={!selected.size} onClick={() => move(-1)}>
          <ArrowLeft size={15} />
        </IconButton>
        <IconButton label="Move selection later" disabled={!selected.size} onClick={() => move(1)}>
          <ArrowRight size={15} />
        </IconButton>
        <IconButton label="Delete selected pages" disabled={!selected.size || selected.size === pages.length} onClick={remove}>
          <Trash2 size={15} />
        </IconButton>
        <IconButton label="Crop pages" aria-pressed={cropOpen} className={cropOpen ? 'bg-accent/20 text-accent-hover' : ''} onClick={() => setCropOpen((v) => !v)}>
          <Crop size={15} />
        </IconButton>
        <span className="ml-auto truncate text-[11px] text-fg-3" title="Rotation applies to the selection, or to all pages when nothing is selected">
          Click to select · drag to reorder
        </span>
      </div>

      {cropOpen && (
        <CropPanel
          target={selected.size ? `${selected.size} selected` : 'all pages'}
          onApply={(c) => applyCrop(hasCrop(c) ? c : undefined)}
          onClear={() => applyCrop(undefined)}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="pdf-pages">
        {loadError && <div className="p-6 text-center text-sm text-danger">{loadError}</div>}
        {!doc && !loadError && <div className="h-full animate-pulse rounded-lg bg-surface" />}
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3">
          {pages.map((p, i) => {
            const isSel = selected.has(p.key)
            return (
              <li
                key={p.key}
                data-testid={`pdf-page-${i}`}
                draggable
                onDragStart={(e) => {
                  setDragKey(p.key)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  if (dragKey !== null) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dropOn(p.key)
                }}
                onDragEnd={() => setDragKey(null)}
                className={`group relative cursor-grab rounded-lg border p-1.5 transition-colors ${isSel ? 'border-accent bg-accent/15 ring-2 ring-accent/60' : 'border-line bg-surface hover:border-line-strong'} ${dragKey === p.key ? 'opacity-40' : ''}`}
              >
                <button type="button" aria-pressed={isSel} aria-label={`Page ${p.index + 1}${isSel ? ', selected' : ''}`} onClick={() => toggle(p.key)} className="block w-full">
                  <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded bg-bg">
                    {thumbs[p.index] ? (
                      <div className="relative max-h-full max-w-full transition-transform" style={{ transform: `rotate(${p.rotate}deg)` }}>
                        <img src={thumbs[p.index]} alt="" draggable={false} className="block max-h-full max-w-full shadow" />
                        {hasCrop(p.crop) && (
                          // Cropped-away margins shown dimmed, drawn in page space so rotation carries them along.
                          <div
                            data-testid={`crop-overlay-${i}`}
                            className="pointer-events-none absolute ring-1 ring-accent"
                            style={{
                              left: `${p.crop!.left * 100}%`,
                              top: `${p.crop!.top * 100}%`,
                              right: `${p.crop!.right * 100}%`,
                              bottom: `${p.crop!.bottom * 100}%`,
                              boxShadow: '0 0 0 999px rgb(5 8 12 / 0.6)',
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="h-3/4 w-2/3 animate-pulse rounded-sm bg-raised" />
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-between px-0.5 text-[11px]">
                    <span className="text-fg-2 tabular-nums">{i + 1}</span>
                    {p.index !== i && <span className="text-fg-3">was {p.index + 1}</span>}
                    {p.rotate !== 0 && <span className="text-accent-hover">{p.rotate}°</span>}
                    {hasCrop(p.crop) && <span className="text-accent-hover">crop</span>}
                  </div>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </WindowFrame>
  )
}
