import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { RadialWheel } from '../../components/RadialWheel/RadialWheel'
import { JobToast } from '../../components/ProgressIndicator/JobToast'
import { useJob } from '../../hooks/useJob'
import { fades, useMotionPrefs } from '../../themes/motion'
import { hubLabelFor, type WheelSession } from './useWheelSession'

export const WHEEL_SIZE = 320

/** Auto-dismiss delays after a job ends (failures stay until dismissed). */
const DISMISS_AFTER = { done: 1400, cancelled: 900, failed: 0 } as const
/** Long enough to reach a follow-up button such as "Touch up". */
const DISMISS_WITH_FOLLOW_UP = 6000

/**
 * Renders the wheel, then morphs into the progress toast once an instant action starts.
 * Positioned by the host: (x, y) is the wheel center in the host's coordinate space.
 */
export function WheelStage({ session, x, y, interactive, autoDismissErrors = false }: { session: WheelSession; x: number; y: number; interactive: boolean; autoDismissErrors?: boolean }) {
  const { state, hover, select, close, cancelJob } = session
  const motionPrefs = useMotionPrefs()
  const progress = useJob(state.job?.id ?? null)

  // After a one-image Remove background: offer the brush editor on the same photo; saving there
  // replaces the cut-out that was just made.
  const cutout = progress?.status === 'done' && state.job?.actionId === 'image.remove-bg' && state.files.length === 1 ? progress.outputs[0] : undefined
  const followUp = cutout
    ? {
        label: 'Touch up',
        onClick: () => {
          void window.twirly.openEditor({ actionId: 'image.remove-bg-touchup', paths: [state.files[0]!.path], replace: cutout })
          close()
        },
      }
    : undefined
  const hasFollowUp = !!followUp

  useEffect(() => {
    const status = progress?.status
    // Failures stay until dismissed in the main window; the floating wheel clears them itself
    // after a while so it never lingers unnoticed over other apps.
    const delay =
      status === 'done' && hasFollowUp ? DISMISS_WITH_FOLLOW_UP : status === 'done' || status === 'cancelled' ? DISMISS_AFTER[status] : status === 'failed' && autoDismissErrors ? 7000 : null
    if (delay === null) return
    const t = setTimeout(close, delay)
    return () => clearTimeout(t)
  }, [progress?.status, close, autoDismissErrors, hasFollowUp])

  // Validation errors shown on the floating wheel clear themselves too.
  useEffect(() => {
    if (!autoDismissErrors || state.phase !== 'error') return
    const t = setTimeout(close, 6000)
    return () => clearTimeout(t)
  }, [autoDismissErrors, state.phase, close])

  const showWheel = state.phase === 'open' || state.phase === 'error'
  const items = state.actions.map((a) => ({ id: a.id, label: a.label, title: a.title, icon: a.icon }))

  return (
    <div className="pointer-events-none absolute" style={{ left: x, top: y }}>
      {/* mode=wait: the toast enters only after the wheel has left, never underneath it. */}
      <AnimatePresence mode="wait">
        {showWheel && (
          <motion.div
            key="wheel"
            className="pointer-events-auto absolute"
            style={{ left: -WHEEL_SIZE / 2, top: -WHEEL_SIZE / 2, width: WHEEL_SIZE, height: WHEEL_SIZE }}
            initial={{ opacity: 0, scale: motionPrefs.wheelInitialScale, filter: motionPrefs.reduced ? 'none' : 'blur(4px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: motionPrefs.reduced ? 1 : 0.94, transition: fades.fast }}
            transition={motionPrefs.wheelEnter}
          >
            <RadialWheel
              items={state.phase === 'error' ? [] : items}
              activeIndex={state.active}
              hubLabel={hubLabelFor(state)}
              hubTone={state.phase === 'error' ? 'danger' : state.emptyReason ? 'muted' : 'normal'}
              size={WHEEL_SIZE}
              interactive={interactive || !!state.clickToChoose}
              onHover={hover}
              onSelect={select}
              onCancel={close}
            />
            {state.phase === 'error' && (
              <button
                type="button"
                onClick={close}
                className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-line bg-elevated px-3 py-1 text-xs text-fg-2 hover:text-fg"
              >
                Dismiss
              </button>
            )}
          </motion.div>
        )}
        {state.phase === 'running' && state.job && (
          <motion.div key="toast" className="pointer-events-auto absolute" style={{ left: -144, top: -40 }}>
            <JobToast title={state.job.title} progress={progress} onCancel={cancelJob} onDismiss={close} followUp={followUp} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
