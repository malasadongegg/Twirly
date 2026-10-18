import type { JobProgress } from '@shared/types'
import { useJobsStore } from '../stores/jobs'

/** Live progress for one job id (null until the first event). */
export function useJob(jobId: string | null): JobProgress | null {
  return useJobsStore((s) => (jobId ? (s.byId[jobId] ?? null) : null))
}

export const isFinished = (p: JobProgress | null): boolean =>
  !!p && (p.status === 'done' || p.status === 'failed' || p.status === 'cancelled')
