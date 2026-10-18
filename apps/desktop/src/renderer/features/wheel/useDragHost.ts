import { useEffect, useRef } from 'react'
import { wheelIndexAt } from '../../components/RadialWheel/RadialWheel'
import { WHEEL_SIZE } from './WheelStage'
import type { WheelSession } from './useWheelSession'

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')

export interface DragHostOptions {
  session: WheelSession
  /** Called on the first dragenter with files, with the pointer position (client coords). */
  onEnter?: (clientX: number, clientY: number) => void
  /** Delay before closing after the drag leaves the window, so jittery exits are forgiven. */
  leaveGraceMs?: number
}

/**
 * Wires window-level HTML5 drag events to a wheel session. Works identically for drags that
 * start in Explorer (OLE, via Chromium's IDropTarget) and drags inside the app.
 *
 * Safety: every dragover/drop forces dropEffect = 'copy'. In Explorer, Shift requests a MOVE;
 * accepting a move could make Explorer delete the source after the drop. We never accept one.
 */
export function useDragHost({ session, onEnter, leaveGraceMs = 400 }: DragHostOptions): void {
  const sessionRef = useRef(session)
  const onEnterRef = useRef(onEnter)
  useEffect(() => {
    sessionRef.current = session
    onEnterRef.current = onEnter
  })

  useEffect(() => {
    let leaveTimer: ReturnType<typeof setTimeout> | undefined
    let depth = 0

    const segmentAt = (e: DragEvent): number | null => {
      const svg = document.querySelector('[data-testid="radial-wheel"]')
      const count = sessionRef.current.state.actions.length
      return svg && count > 0 ? wheelIndexAt(svg, e.clientX, e.clientY, WHEEL_SIZE, count) : null
    }

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      clearTimeout(leaveTimer)
      const s = sessionRef.current
      if (depth === 1 && (s.state.phase === 'closed' || (s.state.phase === 'open' && !s.state.real && s.state.files.length === 0))) {
        onEnterRef.current?.(e.clientX, e.clientY)
        void s.openFromDragItems(e.dataTransfer!.items)
      }
    }

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      sessionRef.current.hover(segmentAt(e))
    }

    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth > 0) return
      clearTimeout(leaveTimer)
      leaveTimer = setTimeout(() => {
        const s = sessionRef.current
        if (s.state.phase === 'open' && !s.state.real) s.close()
      }, leaveGraceMs)
    }

    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      clearTimeout(leaveTimer)
      if (!e.dataTransfer || e.dataTransfer.dropEffect === 'move') {
        // Should be impossible (we always set copy); refuse rather than risk a move.
        sessionRef.current.close()
        return
      }
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.twirly.pathForFile(f))
        .filter(Boolean)
      void sessionRef.current.drop(paths, segmentAt(e))
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      clearTimeout(leaveTimer)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [leaveGraceMs])
}
