import { useEffect, useId, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { hitTest, polar, segmentCenterAngle, segmentLabelPoint, segmentPath, type WheelGeometry } from '@core/wheel/geometry'
import type { ActionIcon } from '@core/actions/types'
import { ACTION_ICONS } from './icons'
import { fades, springs, useMotionPrefs } from '../../themes/motion'

export interface WheelItem {
  id: string
  label: string
  title: string
  icon: ActionIcon
}

export interface RadialWheelProps {
  items: WheelItem[]
  /** Highlighted segment (pointer or keyboard), or null. */
  activeIndex: number | null
  /** Hub text when nothing is highlighted (file size, "3 files", an error...). */
  hubLabel: string
  hubTone?: 'normal' | 'muted' | 'danger'
  /** Diameter in CSS px. */
  size?: number
  /** Click/keyboard mode. In drag mode the parent feeds `activeIndex` from dragover events. */
  interactive?: boolean
  onHover?: (index: number | null) => void
  onSelect?: (index: number) => void
  onCancel?: () => void
}

/** Wheel proportions, derived from the reference analysis and tuned for Obsidian. */
export function wheelGeometry(size: number, count: number): WheelGeometry {
  const outer = size / 2 - 10
  return { count: Math.max(count, 1), outer, inner: Math.round(outer * 0.42), gap: 6, corner: 12 }
}

/** Segment index under a client-space point, using the same geometry the SVG draws. */
export function wheelIndexAt(el: Element, clientX: number, clientY: number, size: number, count: number): number | null {
  const rect = el.getBoundingClientRect()
  const scale = rect.width / size || 1
  const x = (clientX - rect.left - rect.width / 2) / scale
  const y = (clientY - rect.top - rect.height / 2) / scale
  return hitTest(x, y, wheelGeometry(size, count))
}

export function RadialWheel({
  items,
  activeIndex,
  hubLabel,
  hubTone = 'normal',
  size = 320,
  interactive = false,
  onHover,
  onSelect,
  onCancel,
}: RadialWheelProps) {
  const uid = useId().replace(/:/g, '')
  const motionPrefs = useMotionPrefs()
  const count = items.length
  const g = useMemo(() => wheelGeometry(size, count), [size, count])
  const paths = useMemo(() => items.map((_, i) => segmentPath(i, g)), [items, g])
  const hubR = g.inner - 9
  const active = activeIndex !== null ? items[activeIndex] : undefined
  const hubText = active ? active.title : hubLabel
  const hubLines = wrapHubText(hubText, hubR)
  const svgRef = useRef<SVGSVGElement>(null)

  // Click/keyboard mode takes focus as soon as it mounts, like a context menu.
  useEffect(() => {
    if (interactive) svgRef.current?.focus()
  }, [interactive])

  const indexFromPointer = (e: PointerEvent<SVGSVGElement>) => wheelIndexAt(e.currentTarget, e.clientX, e.clientY, size, count)

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!interactive || count === 0) return
    const cur = activeIndex ?? -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      onHover?.((cur + 1) % count)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault()
      onHover?.((cur - 1 + count) % count)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (activeIndex !== null) onSelect?.(activeIndex)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel?.()
    } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= count) {
      e.preventDefault()
      onSelect?.(Number(e.key) - 1)
    }
  }

  return (
    <svg
      ref={svgRef}
      role="menu"
      aria-label="File actions"
      aria-activedescendant={activeIndex !== null ? `${uid}-seg-${activeIndex}` : undefined}
      tabIndex={interactive ? 0 : -1}
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      className="overflow-visible outline-none"
      data-testid="radial-wheel"
      data-hub={hubText}
      onKeyDown={onKeyDown}
      onPointerMove={interactive ? (e) => onHover?.(indexFromPointer(e)) : undefined}
      onPointerLeave={interactive ? () => onHover?.(null) : undefined}
      onContextMenu={(e) => {
        // Right-click anywhere on the wheel cancels it.
        e.preventDefault()
        onCancel?.()
      }}
      onPointerUp={
        interactive
          ? (e) => {
              const i = indexFromPointer(e)
              if (i !== null) onSelect?.(i)
            }
          : undefined
      }
    >
      <defs>
        <radialGradient id={`${uid}-rim`} r="0.5">
          <stop offset="0.7" stopColor="rgb(11 15 20 / 0.9)" />
          <stop offset="1" stopColor="rgb(11 15 20 / 0.75)" />
        </radialGradient>
        <linearGradient id={`${uid}-active`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent-hover)" />
          <stop offset="1" stopColor="var(--color-accent)" />
        </linearGradient>
        <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>

      {/* Rim: the translucent disc everything sits on. */}
      <circle r={size / 2 - 1} fill={`url(#${uid}-rim)`} stroke="var(--color-line-strong)" strokeWidth={1} />

      {items.map((item, i) => {
        const isActive = i === activeIndex
        const push = isActive ? polar(motionPrefs.segmentPush, segmentCenterAngle(i, count)) : { x: 0, y: 0 }
        const label = segmentLabelPoint(i, g)
        const Icon = ACTION_ICONS[item.icon]
        return (
          <motion.g
            key={item.id}
            id={`${uid}-seg-${i}`}
            role="menuitem"
            aria-label={item.title}
            data-active={isActive || undefined}
            data-testid={`wheel-segment-${item.id}`}
            animate={{ x: push.x, y: push.y }}
            transition={springs.segment}
            style={{ cursor: interactive ? 'pointer' : undefined }}
          >
            {isActive && <path d={paths[i]} fill="var(--color-accent)" opacity={0.55} filter={`url(#${uid}-glow)`} />}
            <path
              d={paths[i]}
              fill={isActive ? `url(#${uid}-active)` : 'var(--wheel-segment)'}
              stroke={isActive ? 'rgb(147 197 253 / 0.6)' : 'var(--color-line)'}
              strokeWidth={1}
              style={{ transition: 'fill 90ms ease-out' }}
            />
            <Icon
              x={label.x - 9}
              y={label.y - 17}
              width={18}
              height={18}
              strokeWidth={1.75}
              color={isActive ? '#ffffff' : 'var(--color-fg-2)'}
              aria-hidden
            />
            <text
              x={label.x}
              y={label.y + 15}
              textAnchor="middle"
              fontSize={10}
              fontWeight={650}
              letterSpacing="0.06em"
              fill={isActive ? '#ffffff' : 'var(--color-fg)'}
              style={{ pointerEvents: 'none' }}
            >
              {item.label}
            </text>
          </motion.g>
        )
      })}

      {/* Hub: the file indicator. Shows file info, or the highlighted action. */}
      <circle r={hubR} fill="var(--color-bg)" stroke="var(--color-line-strong)" strokeWidth={1} />
      <circle r={hubR - 5} fill="none" stroke={active ? 'rgb(59 130 246 / 0.45)' : 'var(--color-line)'} strokeWidth={1} style={{ transition: 'stroke 120ms' }} />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.text
          key={hubText}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={hubLines.length > 1 ? 10 : 11.5}
          fontWeight={600}
          fill={hubTone === 'danger' ? 'var(--color-danger)' : hubTone === 'muted' ? 'var(--color-fg-2)' : 'var(--color-fg)'}
          initial={motionPrefs.reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={motionPrefs.reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={fades.base}
          aria-live="polite"
          data-testid="wheel-hub"
        >
          {hubLines.map((line, i) => (
            <tspan key={i} x={0} dy={i === 0 ? `${-(hubLines.length - 1) * 0.6}em` : '1.2em'}>
              {line}
            </tspan>
          ))}
        </motion.text>
      </AnimatePresence>
    </svg>
  )
}

/**
 * Wrap hub text onto at most three centered lines that fit inside the hub circle
 * (about 5.4 px per character at the hub font size). Only overflow beyond that is truncated.
 */
export function wrapHubText(text: string, hubR: number, maxLines = 3): string[] {
  const maxChars = Math.max(6, Math.floor((hubR * 2 - 8) / 5.4))
  if (text.length <= maxChars) return [text]
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= maxChars || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  const kept = lines.slice(0, maxLines)
  if (lines.length > maxLines) kept[maxLines - 1] = kept[maxLines - 1]!.slice(0, maxChars - 1) + '…'
  return kept.map((l) => (l.length > maxChars ? l.slice(0, maxChars - 1) + '…' : l))
}
