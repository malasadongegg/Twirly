import { useState } from 'react'
import type { FileInfo } from '@shared/types'
import { WindowFrame } from '../../components/FloatingWindow/WindowFrame'
import { EditorFooter } from './EditorFooter'
import { MaskedImage, TouchUpTools, useCutoutMask, useStrokes, type BrushTool } from './MaskTouchUp'
import { useBoxSize, useEditorJob, useImagePreview } from './useImageJob'

const PREVIEW_MAX = 1400

/** Transparency checkerboard behind the cut-out. */
const CHECKER: React.CSSProperties = {
  backgroundColor: '#2a3340',
  backgroundImage: 'conic-gradient(#1c2530 25%, transparent 0 50%, #1c2530 0 75%, transparent 0)',
  backgroundSize: '16px 16px',
}

/**
 * "Remove background": shows the automatic cut-out at once. Keep/Erase brushes fix what the model
 * got wrong; the strokes are re-applied to the full-resolution mask on save.
 */
export function RemoveBgEditor({ actionId, file }: { actionId: string; file: FileInfo }) {
  const { preview, error: loadError } = useImagePreview(file.path, PREVIEW_MAX)
  const job = useEditorJob(actionId, file.path)
  const [areaRef, area] = useBoxSize<HTMLDivElement>()
  const mask = useCutoutMask(file.path, PREVIEW_MAX, true)
  const { strokes, add, undo, reset } = useStrokes()
  const [tool, setTool] = useState<BrushTool>('off')
  const maxDim = preview ? Math.max(preview.width, preview.height) : 1000
  const [brush, setBrush] = useState<number | null>(null)
  const brushSize = brush ?? Math.max(2, Math.round(maxDim * 0.04))
  const scale = preview && area.w && area.h ? Math.min(area.w / preview.width, area.h / preview.height) : 0

  return (
    <WindowFrame
      title="Remove background"
      subtitle={file.name}
      footer={
        <EditorFooter
          {...job}
          idle={mask.busy ? 'Finding the subject…' : preview ? `Output ${preview.width} × ${preview.height} px · transparent PNG` : ''}
          primary="Save cut-out"
          primaryDisabled={!preview || !mask.url}
          onPrimary={() => void job.run({ strokes })}
        />
      }
    >
      <div ref={areaRef} className="relative mx-4 mt-4 min-h-0 flex-1" data-testid="editor-preview">
        {(loadError || mask.error) && <div className="p-6 text-center text-sm text-danger">{loadError ?? mask.error}</div>}
        {preview && scale > 0 && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md" style={CHECKER}>
            {mask.url ? (
              <MaskedImage
                imageUrl={preview.dataUrl}
                maskUrl={mask.url}
                width={preview.width}
                height={preview.height}
                scale={scale}
                strokes={strokes}
                tool={tool}
                brush={brushSize}
                onStroke={add}
              />
            ) : (
              <img src={preview.dataUrl} alt="" style={{ width: preview.width * scale, height: preview.height * scale, opacity: 0.45, display: 'block' }} />
            )}
            {mask.busy && (
              <div className="absolute inset-x-0 bottom-3 text-center">
                <span className="rounded-md bg-bg/85 px-2.5 py-1 text-xs text-fg">Finding the subject…</span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="space-y-2.5 px-4 pb-3 pt-3">
        <TouchUpTools
          tool={tool}
          onTool={setTool}
          brush={brushSize}
          onBrush={setBrush}
          maxBrush={Math.max(4, Math.round(maxDim * 0.25))}
          canUndo={strokes.length > 0}
          onUndo={undo}
          onReset={reset}
        />
        <p className="text-[11px] leading-relaxed text-fg-3">
          Not quite right? Choose <span className="text-fg-2">Keep</span> and paint over parts that should stay, or <span className="text-fg-2">Erase</span> to remove more.
        </p>
      </div>
    </WindowFrame>
  )
}
