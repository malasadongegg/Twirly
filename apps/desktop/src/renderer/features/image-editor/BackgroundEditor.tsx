import { useState } from 'react'
import type { FileInfo } from '@shared/types'
import { BACKGROUND_PRESETS, backgroundCanvas, type BackgroundParams, type BgRatio } from '@core/actions/image-extras'
import { WindowFrame } from '../../components/FloatingWindow/WindowFrame'
import { FieldRow, Segmented, Slider } from '../../components/ui/controls'
import { EditorFooter } from './EditorFooter'
import { useBoxSize, useEditorJob, useImagePreview } from './useImageJob'

/**
 * "Add background": the preview is pure CSS (instant while dragging sliders); the export is
 * rendered by sharp in main with the same parameters at full resolution.
 */
export function BackgroundEditor({ actionId, file }: { actionId: string; file: FileInfo }) {
  const { preview, error: loadError } = useImagePreview(file.path)
  const job = useEditorJob(actionId, file.path)
  const [areaRef, area] = useBoxSize<HTMLDivElement>()
  const [preset, setPreset] = useState<string>('aurora')
  const [p, setP] = useState<BackgroundParams>({ from: '#3b82f6', to: '#a855f7', angle: 135, padding: 0, corners: 0, shadow: 0, ratio: 'auto' })
  const [initialized, setInitialized] = useState(false)

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

  return (
    <WindowFrame
      title="Add background"
      subtitle={file.name}
      footer={
        <EditorFooter
          {...job}
          idle={`Output ${full.width} × ${full.height} px · PNG`}
          primary="Save with background"
          primaryDisabled={!preview}
          onPrimary={() => void job.run({ ...p })}
        />
      }
    >
      <div ref={areaRef} className="relative mx-4 mt-4 min-h-0 flex-1" data-testid="editor-preview">
        {loadError && <div className="p-6 text-center text-sm text-danger">{loadError}</div>}
        {preview && scale > 0 && (
          <div
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ width: full.width * scale, height: full.height * scale, background: `linear-gradient(${p.angle + 90}deg, ${p.from}, ${p.to})` }}
          >
            <img
              src={preview.dataUrl}
              alt=""
              style={{
                width: preview.width * scale,
                height: preview.height * scale,
                borderRadius: Math.min(p.corners, Math.min(preview.width, preview.height) / 2) * scale,
                boxShadow: p.shadow ? `0 ${(p.shadow / 3) * scale}px ${p.shadow * scale}px rgb(0 0 0 / 0.45)` : 'none',
              }}
            />
          </div>
        )}
      </div>
      <div className="space-y-2.5 px-4 pb-3 pt-3">
        <FieldRow label="Background">
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
            <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-md border border-dashed border-line-strong" title="Custom color">
              <input
                type="color"
                aria-label="Custom color"
                value={p.from}
                onChange={(e) => {
                  setPreset('custom')
                  set({ from: e.target.value, to: e.target.value })
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <span className="pointer-events-none flex h-full items-center justify-center text-xs text-fg-2">+</span>
            </label>
          </div>
        </FieldRow>
        <Slider label="Padding" value={p.padding} min={0} max={Math.round(maxDim * 0.5)} onChange={(padding) => set({ padding })} suffix=" px" />
        <Slider label="Corners" value={p.corners} min={0} max={Math.round(maxDim * 0.25)} onChange={(corners) => set({ corners })} suffix=" px" />
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
