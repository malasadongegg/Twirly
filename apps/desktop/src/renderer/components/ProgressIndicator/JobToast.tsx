import { motion } from 'motion/react'
import { Check, Copy, FolderOpen, X, AlertTriangle } from 'lucide-react'
import type { JobProgress } from '@shared/types'
import { IconButton } from '../ui/controls'
import { springs } from '../../themes/motion'

export interface JobToastProps {
  title: string
  progress: JobProgress | null
  onCancel: () => void
  onDismiss: () => void
}

/** Compact progress card shown at the drop point while an instant action runs. */
export function JobToast({ title, progress, onCancel, onDismiss }: JobToastProps) {
  const status = progress?.status ?? 'queued'
  const total = progress?.total ?? 1
  const completed = progress?.completed ?? 0
  const running = status === 'queued' || status === 'running'
  const fraction = status === 'done' ? 1 : total > 0 ? (completed + (progress?.fraction ?? 0)) / total : 0
  const lastOutput = progress?.outputs.at(-1)

  const subtitle =
    status === 'done'
      ? `${completed} of ${total} saved`
      : status === 'failed'
        ? (progress?.error?.message ?? 'Failed')
        : status === 'cancelled'
          ? 'Cancelled'
          : `${completed} of ${total} saved`

  return (
    <motion.div
      role="status"
      aria-live="polite"
      data-testid="job-toast"
      data-status={status}
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
      transition={springs.panel}
      className="w-72 rounded-[var(--radius-panel)] border border-line bg-surface/95 p-3 shadow-[var(--shadow-panel)]"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          {status === 'done' ? (
            <Check size={16} className="text-success" />
          ) : status === 'failed' ? (
            <AlertTriangle size={16} className="text-danger" />
          ) : (
            <span className="block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-fg">{title}</div>
          <div className={`mt-0.5 text-xs ${status === 'failed' ? 'text-danger' : 'text-fg-2'}`} data-testid="job-toast-subtitle">
            {subtitle}
          </div>
        </div>
        {running ? (
          <IconButton label="Cancel" onClick={onCancel}>
            <X size={14} />
          </IconButton>
        ) : (
          <div className="flex">
            {status === 'done' && lastOutput && (
              <IconButton label="Show in folder" onClick={() => void window.twirly.showInFolder(lastOutput)}>
                <FolderOpen size={14} />
              </IconButton>
            )}
            {status === 'failed' && progress?.error?.detail && (
              <IconButton label="Copy details" onClick={() => void navigator.clipboard.writeText(progress.error?.detail ?? '')}>
                <Copy size={14} />
              </IconButton>
            )}
            <IconButton label="Dismiss" onClick={onDismiss}>
              <X size={14} />
            </IconButton>
          </div>
        )}
      </div>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-raised">
        <motion.div
          className={`h-full rounded-full ${status === 'failed' ? 'bg-danger' : 'bg-accent'}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(fraction, running ? 0.06 : 0) * 100}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>
    </motion.div>
  )
}
