import { useCallback, useEffect, useRef, useState } from 'react'
import { useWheelSession } from './useWheelSession'
import { useDragHost } from './useDragHost'
import { WheelStage } from './WheelStage'

/** If a drag-summon gets no OLE dragenter with files this fast, it was not a file drag. */
const SUMMON_TIMEOUT_MS = 700

/**
 * The always-on-top wheel window. Shown by main either on drag-summon (files unknown until the
 * drag enters) or with paths from the Explorer context menu (click/keyboard mode).
 */
export function WheelWindowApp() {
  const dismiss = useCallback(() => void window.twirly.wheel.dismiss(), [])
  const session = useWheelSession({ onFinished: dismiss })
  const [interactive, setInteractive] = useState(false)
  const summonTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const { openWithPaths, openPending, close } = session
  const phase = session.state.phase
  const real = session.state.real

  useDragHost({ session, onEnter: () => clearTimeout(summonTimer.current) })

  useEffect(() => {
    const offShow = window.twirly.wheel.onShow((e) => {
      clearTimeout(summonTimer.current)
      if (e.source === 'drag-summon') {
        setInteractive(false)
        openPending()
        summonTimer.current = setTimeout(close, SUMMON_TIMEOUT_MS)
      } else {
        setInteractive(true)
        void openWithPaths(e.paths)
      }
    })
    const offHide = window.twirly.wheel.onHide(() => clearTimeout(summonTimer.current))
    return () => {
      offShow()
      offHide()
    }
  }, [openWithPaths, openPending, close])

  // The mouse button came up without a drop reaching us: the user released elsewhere.
  useEffect(
    () =>
      window.twirly.wheel.onDragState(({ buttonDown }) => {
        if (!buttonDown && phase === 'open' && !real) setTimeout(close, 150)
      }),
    [phase, real, close],
  )

  // Click mode: clicking outside (window loses focus) cancels, like a context menu.
  useEffect(() => {
    if (!interactive) return
    const onBlur = () => phase === 'open' && close()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [interactive, phase, close])

  return (
    <div className="relative h-full w-full" data-testid="wheel-window">
      <WheelStage session={session} x={180} y={180} interactive={interactive} />
    </div>
  )
}
