import { useCallback, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeft,
  FolderOpen,
  Minus,
  MousePointerClick,
  Settings as SettingsIcon,
  Upload,
  X,
} from 'lucide-react'
import type { JobProgress } from '@shared/types'
import { useWheelSession } from '../wheel/useWheelSession'
import { useDragHost } from '../wheel/useDragHost'
import { WheelStage, WHEEL_SIZE } from '../wheel/WheelStage'
import { Button, IconButton } from '../../components/ui/controls'
import { useJobsStore } from '../../stores/jobs'
import { SettingsView } from '../settings/SettingsView'

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

function TitleBar({ view, onToggleSettings }: { view: 'home' | 'settings'; onToggleSettings: () => void }) {
  return (
    <header className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-line pl-4 pr-1">
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden>
          <circle r="7" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
          <circle r="2.5" fill="var(--color-accent)" />
        </svg>
        <span className="font-[family-name:var(--font-display)] text-[13px] font-semibold tracking-wide">
          Twirly{view === 'settings' && <span className="font-normal text-fg-3"> · Settings</span>}
        </span>
      </div>
      <div className="no-drag flex items-center gap-0.5">
        <IconButton label={view === 'settings' ? 'Back' : 'Settings'} onClick={onToggleSettings}>
          {view === 'settings' ? <ArrowLeft size={15} /> : <SettingsIcon size={15} />}
        </IconButton>
        <IconButton label="Minimize" onClick={() => void window.twirly.minimizeWindow()}>
          <Minus size={15} />
        </IconButton>
        <IconButton
          label="Close"
          className="hover:bg-danger/80 hover:text-white"
          onClick={() => void window.twirly.closeWindow()}
        >
          <X size={15} />
        </IconButton>
      </div>
    </header>
  )
}

function ActivityList({ jobs }: { jobs: JobProgress[] }) {
  if (jobs.length === 0) return null
  return (
    <section aria-label="Recent activity" className="mt-4">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-3">Recent</h2>
      <ul className="space-y-1.5">
        {jobs.slice(0, 4).map((j) => (
          <li
            key={j.jobId}
            className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2"
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${j.status === 'done' ? 'bg-success' : j.status === 'failed' ? 'bg-danger' : j.status === 'cancelled' ? 'bg-fg-3' : 'bg-accent'}`}
            />
            <span className="min-w-0 flex-1 truncate text-xs">
              {j.title}
              <span className="text-fg-3">
                {' '}
                · {j.status === 'failed' ? j.error?.message : `${j.completed}/${j.total}`}
              </span>
            </span>
            {j.outputs.at(-1) && (
              <IconButton
                label="Show in folder"
                onClick={() => void window.twirly.showInFolder(j.outputs.at(-1)!)}
              >
                <FolderOpen size={13} />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function HomeApp() {
  const session = useWheelSession()
  const stageRef = useRef<HTMLDivElement>(null)
  const [center, setCenter] = useState({ x: 0, y: 0 })
  const [interactive, setInteractive] = useState(false)
  const [view, setView] = useState<'home' | 'settings'>('home')
  const byId = useJobsStore((s) => s.byId)
  const order = useJobsStore((s) => s.order)
  const jobs = useMemo(() => order.map((id) => byId[id]!).filter(Boolean), [order, byId])
  const open = session.state.phase !== 'closed'

  /** Center the wheel on a client point, clamped so it stays fully inside the stage. */
  const centerAt = useCallback((clientX: number, clientY: number) => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return
    const half = WHEEL_SIZE / 2 + 4
    setCenter({
      x: clamp(clientX - r.left, half, r.width - half),
      y: clamp(clientY - r.top, half, r.height - half),
    })
  }, [])

  useDragHost({
    session,
    onEnter: (x, y) => {
      setInteractive(false)
      centerAt(x, y)
    },
  })

  const browse = async () => {
    const paths = await window.twirly.pickFiles()
    if (paths.length === 0) return
    const r = stageRef.current!.getBoundingClientRect()
    centerAt(r.left + r.width / 2, r.top + r.height / 2)
    setInteractive(true)
    await session.openWithPaths(paths)
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar view={view} onToggleSettings={() => setView((v) => (v === 'home' ? 'settings' : 'home'))} />
      {view === 'settings' ? (
        <main className="min-h-0 flex-1">
          <SettingsView />
        </main>
      ) : (
        <main ref={stageRef} className="relative flex-1 overflow-hidden p-4">
          <motion.div
            animate={{ opacity: open ? 0.25 : 1, scale: open ? 0.985 : 1 }}
            transition={{ duration: 0.15 }}
            className="flex h-full flex-col"
          >
            <div
              data-testid="drop-zone"
              className="flex flex-1 flex-col items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface/60 px-6 text-center"
            >
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-line bg-elevated shadow-[var(--shadow-glow)]">
                <Upload size={22} className="text-accent-hover" />
              </div>
              <h1 className="font-[family-name:var(--font-display)] text-base font-semibold">
                Drop files here
              </h1>
              <p className="mt-1 max-w-64 text-xs leading-relaxed text-fg-2">
                The action wheel opens under your cursor. Release on an action to run it.
              </p>
              <Button className="mt-4" onClick={() => void browse()}>
                <MousePointerClick size={14} /> Browse files…
              </Button>
            </div>
            <ActivityList jobs={jobs} />
          </motion.div>

          <AnimatePresence>
            {open && (
              <motion.div
                key="scrim"
                className="absolute inset-0 bg-bg/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => interactive && session.state.phase === 'open' && session.close()}
              onContextMenu={(e) => {
                e.preventDefault()
                if (session.state.phase === 'open' || session.state.phase === 'error') session.close()
              }}
              />
            )}
          </AnimatePresence>
          <WheelStage session={session} x={center.x} y={center.y} interactive={interactive} />
        </main>
      )}
    </div>
  )
}
