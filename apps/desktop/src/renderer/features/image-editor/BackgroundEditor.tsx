import { useEffect, useRef, useState } from 'react'
import type { FileInfo } from '@shared/types'
import { BACKGROUND_PRESETS, backgroundCanvas, type BackgroundParams, type BgRatio } from '@core/actions/image-extras'
import { WindowFrame } from '../../components/FloatingWindow/WindowFrame'
import { Button, FieldRow, Segmented, Slider } from '../../components/ui/controls'
import { EditorFooter } from './EditorFooter'
import { useBoxSize, useEditorJob, useImagePreview } from './useImageJob'

const PREVIEW_MAX = 1400

/** Cut-out preview of the subject, computed in main the first time "Remove" is chosen. */
function useCutout(path: string, enabled: boolean) {
  const [result, setResult] = useState<{ url?: string; error?: string }>({})
  const requested = useRef(false)
  useEffect(() => {
    if (!enabled || requested.current) return
    requested.current = true
    window.twirly
      .removeBgPreview(path, PREVIEW_MAX)
      .then((url) => setResult({ url }))
      .catch((e: Error) => setResult({ error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
  }, [path, enabled])
  return { ...result, busy: enabled && !result.url && !result.error }
}

/** Data URL preview for an optional path (the picture background). */
function useOptionalPreview(path: string | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return
    let alive = true
    window.twirly
      .imagePreview(path, 1600)
      .then((p) => alive && setUrl(p.dataUrl))
      .catch(() => alive && setUrl(null))
    return () => {
      alive = false
    }
  }, [path])
  return path ? url : null
}

/**
 * "Add background": the preview is pure CSS (instant while dragging sliders); the export is
 * rendered by sharp in main with the same parameters at full resolution.
 */
export function BackgroundEditor({ actionId, file }: { actionId: string; file: FileInfo }) {
  const { preview, error: loadError } = useImagePreview(file.path, PREVIEW_MAX)
  const job = useEditorJob(actionId, file.path)
  const [areaRef, area] = useBoxSize<HTMLDivElement>()
  const [preset, setPreset] = useState<string>('aurora')
  const [p, setP] = useState<BackgroundParams>({
    from: '#3b82f6',
    to: '#a855f7',
    angle: 135,
    padding: 0,
    corners: 0,
    shadow: 0,
    ratio: 'auto',
    fill: 'gradient',
    blur: 0,
    removeBg: false,
  })
  const [initialized, setInitialized] = useState(false)
  const cutout = useCutout(file.path, p.removeBg)
  const pictureUrl = useOptionalPreview(p.fill === 'image' ? p.image : undefined)

  // Start with proportions that look good at any resolution.
  if (preview && !initialized) {
    const m = Math.max(preview.width, preview.height)
    setP((s) => ({ ...s, padding: Math.round(m * 0.08), corners: Math.round(m * 0.02), shadow: Math.round(m * 0.03) }))
    setInitialized(true)
  }

  const full = preview ? backgroundCanvas(preview.width, preview.height, p) : { width: 1, height: 1 }
  const scale = area.w && area.h ? Math.min(area.w / full.width, area.h / full.height) : 0
  const maxDim = preview ? Math.max(preview.width, preview.height) : 1000
  const set = (patch: Partial<BackgroundParams>) => setP((s) => ({ ...s, ...patch }))
  const cut = p.removeBg && cutout.url
  const shadowCss = p.shadow ? `0 ${(p.shadow / 3) * scale}px ${p.shadow * scale}px rgb(0 0 0 / 0.45)` : 'none'
  const needsPicture = p.fill === 'image' && !p.image

  const choosePicture = async () => {
    const [path] = await window.twirly.pickFiles()
    if (path) set({ fill: 'image', image: path })
  }

  return (
    <WindowFrame
      title="Add background"
      subtitle={file.name}
      footer={
        <EditorFooter
          {...job}
          idle={needsPicture ? 'Choose a picture for the background' : `Output ${full.width} × ${full.height} px · PNG`}
          primary="Save with background"
          primaryDisabled={!preview || needsPicture || (p.removeBg && !!cutout.error)}
          onPrimary={() => void job.run({ ...p })}
        />
      }
    >
      <div ref={areaRef} className="relative mx-4 mt-4 min-h-0 flex-1" data-testid="editor-preview">
        {loadError && <div className="p-6 text-center text-sm text-danger">{loadError}</div>}
        {preview && scale > 0 && (
          <div
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden"
            style={{ width: full.width * scale, height: full.height * scale }}
          >
            <div
              className="absolute inset-0"
              data-testid="background-layer"
              style={
                p.fill === 'image'
                  ? {
                      background: pictureUrl ? `center / cover no-repeat url(${pictureUrl})` : 'var(--color-raised)',
                      filter: p.blur ? `blur(${(p.blur / 2) * scale}px)` : undefined,
                      transform: p.blur ? 'scale(1.06)' : undefined,
                    }
                  : { background: `linear-gradient(${p.angle + 90}deg, ${p.from}, ${p.to})` }
              }
            />
            <img
              src={cut ? cutout.url : preview.dataUrl}
              alt=""
              data-testid="subject"
              className="relative"
              style={{
                width: preview.width * scale,
                height: preview.height * scale,
                opacity: p.removeBg && !cut ? 0.45 : 1,
                borderRadius: cut ? 0 : Math.min(p.corners, Math.min(preview.width, preview.height) / 2) * scale,
                boxShadow: cut ? 'none' : shadowCss,
                filter: cut && p.shadow ? `drop-shadow(${shadowCss})` : undefined,
              }}
            />
            {p.removeBg && cutout.busy && (
              <div className="absolute inset-x-0 bottom-3 text-center">
                <span className="rounded-md bg-bg/85 px-2.5 py-1 text-xs text-fg">Finding the subject…</span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="space-y-2.5 px-4 pb-3 pt-3">
        <FieldRow label="Original background">
          <Segmented
            label="Original background"
            value={p.removeBg ? 'remove' : 'keep'}
            onChange={(v) => set({ removeBg: v === 'remove' })}
            options={[
              { value: 'keep', label: 'Keep' },
              { value: 'remove', label: 'Remove', title: 'Cut out the subject (runs on this PC)' },
            ]}
          />
        </FieldRow>
        {p.removeBg && cutout.error && <p className="text-xs text-danger">{cutout.error}</p>}
        <FieldRow label="New background">
          <Segmented
            label="New background"
            value={p.fill}
            onChange={(fill) => (fill === 'image' && !p.image ? void choosePicture() : set({ fill }))}
            options={[
              { value: 'gradient', label: 'Colors' },
              { value: 'image', label: 'Picture' },
            ]}
          />
        </FieldRow>
        {p.fill === 'gradient' ? (
          <>
            <FieldRow label="Preset">
              <div className="flex flex-wrap justify-end gap-1.5" role="radiogroup" aria-label="Background preset">
                {BACKGROUND_PRESETS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={preset === b.id}
                    aria-label={b.id}
                    onClick={() => {
                      setPreset(b.id)
                      set({ from: b.from, to: b.to })
                    }}
                    className={`h-6 w-6 rounded-md border ${preset === b.id ? 'border-white ring-2 ring-accent' : 'border-line-strong'}`}
                    style={{ background: `linear-gradient(135deg, ${b.from}, ${b.to})` }}
                  />
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={preset === 'custom'}
                  aria-label="Custom"
                  title="Custom colors"
                  onClick={() => setPreset('custom')}
                  className={`flex h-6 items-center rounded-md border px-1.5 text-[11px] text-fg-2 ${preset === 'custom' ? 'border-white ring-2 ring-accent' : 'border-dashed border-line-strong'}`}
                >
                  Custom
                </button>
              </div>
            </FieldRow>
            {preset === 'custom' && (
              <>
                <FieldRow label="Colors">
                  <div className="flex items-center gap-2">
                    {(['from', 'to'] as const).map((k) => (
                      <label key={k} className="relative h-6 w-10 cursor-pointer overflow-hidden rounded-md border border-line-strong" style={{ background: p[k] }}>
                        <input
                          type="color"
                          aria-label={k === 'from' ? 'First color' : 'Second color'}
                          value={p[k]}
                          onChange={(e) => set({ [k]: e.target.value })}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        />
                      </label>
                    ))}
                    <Button className="h-6 px-2 text-[11px]" onClick={() => set({ to: p.from })} title="Use the first color only">
                      Solid
                    </Button>
                  </div>
                </FieldRow>
                <Slider label="Angle" value={p.angle} min={0} max={360} onChange={(angle) => set({ angle })} suffix="°" />
              </>
            )}
          </>
        ) : (
          <>
            <FieldRow label="Picture">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs text-fg-2" title={p.image}>
                  {p.image ? p.image.split(/[\\/]/).pop() : 'None'}
                </span>
                <Button className="h-6 shrink-0 px-2 text-[11px]" onClick={() => void choosePicture()}>
                  Choose…
                </Button>
              </div>
            </FieldRow>
            <Slider label="Blur" value={p.blur} min={0} max={Math.max(1, Math.round(maxDim * 0.05))} onChange={(blur) => set({ blur })} suffix=" px" />
          </>
        )}
        <Slider label="Padding" value={p.padding} min={0} max={Math.round(maxDim * 0.5)} onChange={(padding) => set({ padding })} suffix=" px" />
        {!p.removeBg && <Slider label="Corners" value={p.corners} min={0} max={Math.round(maxDim * 0.25)} onChange={(corners) => set({ corners })} suffix=" px" />}
        <Slider label="Shadow" value={p.shadow} min={0} max={Math.max(1, Math.round(maxDim * 0.1))} onChange={(shadow) => set({ shadow })} suffix=" px" />
        <FieldRow label="Ratio">
          <Segmented
            label="Canvas ratio"
            value={p.ratio}
            onChange={(ratio: BgRatio) => set({ ratio })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: '1:1', label: '1:1' },
              { value: '16:9', label: '16:9' },
              { value: '4:5', label: '4:5' },
            ]}
          />
        </FieldRow>
      </div>
    </WindowFrame>
  )
}
