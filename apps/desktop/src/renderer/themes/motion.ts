import { useReducedMotion, type Transition } from 'motion/react'
import { useSettings } from '../stores/settings'

/** Balanced springs: quick to settle, at most a hint of overshoot. */
export const springs = {
  wheel: { type: 'spring', stiffness: 520, damping: 34, mass: 0.8 },
  segment: { type: 'spring', stiffness: 700, damping: 40 },
  panel: { type: 'spring', stiffness: 420, damping: 36 },
} satisfies Record<string, Transition>

export const fades = {
  fast: { duration: 0.09, ease: [0.4, 0, 1, 1] },
  base: { duration: 0.14, ease: [0.2, 0, 0, 1] },
} satisfies Record<string, Transition>

/**
 * Motion settings. The OS reduced-motion preference always wins; otherwise Settings →
 * Animation (full / reduced / off) applies.
 */
export function useMotionPrefs() {
  const osReduced = useReducedMotion() ?? false
  const level = useSettings((s) => s.settings.animation)
  const off = level === 'off'
  const reduced = osReduced || level !== 'full'
  return {
    reduced,
    wheelEnter: off ? { duration: 0 } : reduced ? { duration: 0.08 } : springs.wheel,
    wheelInitialScale: reduced ? 1 : 0.82,
    segmentPush: reduced ? 0 : 3,
  }
}
