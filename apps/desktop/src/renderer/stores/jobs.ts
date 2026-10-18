import { create } from 'zustand'
import type { JobProgress } from '@shared/types'

interface JobsState {
  byId: Record<string, JobProgress>
  /** Most recent first. */
  order: string[]
}

/**
 * Latest progress for every job this window has heard about. It subscribes once, at module load,
 * so a job that finishes before a component subscribes (fast failures) is never missed.
 */
export const useJobsStore = create<JobsState>(() => ({ byId: {}, order: [] }))

if (typeof window !== 'undefined' && window.twirly) {
  window.twirly.onJobProgress((p) =>
    useJobsStore.setState((s) => ({
      byId: { ...s.byId, [p.jobId]: p },
      order: s.byId[p.jobId] ? s.order : [p.jobId, ...s.order].slice(0, 50),
    })),
  )
}
