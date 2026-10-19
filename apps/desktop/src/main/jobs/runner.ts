import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { WebContents } from 'electron'
import { ACTIONS_BY_ID } from '@core/actions/definitions'
import { acceptsFile } from '@core/actions/types'
import { IPC, type RunJobRequest } from '@shared/ipc'
import type { JobProgress } from '@shared/types'
import { inspectPaths } from '@processing/fs/inspect'
import { OutputWriter } from '@processing/output'
import { isCancellation, toUserFacing, UserFacingError } from '@processing/errors'
import { getCapabilities } from '../capabilities'
import { spikeLog } from '../spike-log'
import { getSettings } from '../settings'
import { handlerFor, type JobContext } from './handlers'

interface Job {
  progress: JobProgress
  controller: AbortController
  listeners: Set<WebContents>
}

/**
 * Runs actions in the main process. Heavy work happens in libvips threads, FFmpeg processes or
 * the hidden PDF render window, so the main event loop and every renderer stay responsive.
 * Progress is pushed to the requesting window and any observers (the main window's activity list).
 */
export class JobRunner {
  private jobs = new Map<string, Job>()
  private observers = new Set<WebContents>()

  observe(contents: WebContents): void {
    this.observers.add(contents)
    contents.once('destroyed', () => this.observers.delete(contents))
  }

  start(req: Required<RunJobRequest>, requester: WebContents): string {
    const action = ACTIONS_BY_ID.get(req.actionId)
    if (!action) throw new UserFacingError(`Unknown action: ${req.actionId}`)
    if (!handlerFor(action.id)) throw new UserFacingError(`No handler for ${action.title}`)

    const jobId = randomUUID()
    const job: Job = {
      controller: new AbortController(),
      listeners: new Set([requester, ...this.observers]),
      progress: {
        jobId,
        actionId: action.id,
        title: action.title,
        status: 'queued',
        completed: 0,
        total: action.aggregate ? 1 : req.paths.length,
        fraction: null,
        outputs: [],
      },
    }
    this.jobs.set(jobId, job)
    spikeLog('job-start', { actionId: req.actionId, paths: req.paths })
    void this.execute(job, req)
    return jobId
  }

  cancel(jobId: string): void {
    this.jobs.get(jobId)?.controller.abort()
  }

  private emit(job: Job, patch: Partial<JobProgress>): void {
    Object.assign(job.progress, patch)
    spikeLog('job', { ...job.progress })
    for (const wc of job.listeners) if (!wc.isDestroyed()) wc.send(IPC.jobProgress, { ...job.progress })
  }

  private async execute(job: Job, req: Required<RunJobRequest>): Promise<void> {
    const action = ACTIONS_BY_ID.get(req.actionId)!
    const { signal } = job.controller
    const settings = getSettings()
    const out = new OutputWriter({ outputDir: settings.outputDir ?? undefined, naming: { separator: settings.naming.separator } })
    this.emit(job, { status: 'running' })
    try {
      // Re-inspect in main: never trust the renderer's idea of what a file is.
      const { files, rejected } = await inspectPaths(req.paths)
      if (rejected.length > 0) throw new UserFacingError(`${rejected[0]!.reason}: ${rejected[0]!.path}`)
      const caps = await getCapabilities()
      const bad = files.find((f) => !acceptsFile(action, f, caps))
      if (bad) throw new UserFacingError(`${action.title} cannot process ${bad.name}`)
      if (files.length < action.minFiles || files.length > action.maxFiles)
        throw new UserFacingError(`${action.title} needs ${action.minFiles}–${action.maxFiles} files`)
      const unavailable = action.unavailableReason?.(caps)
      if (unavailable) throw new UserFacingError(unavailable)
      if (settings.outputDir) await assertDirectory(settings.outputDir)

      let lastEmit = 0
      const ctx: JobContext = {
        action,
        files,
        params: req.params,
        signal,
        settings,
        out,
        progress: (completed, fraction) => {
          // Throttle fractional updates; always send file completions.
          const now = Date.now()
          if (fraction !== null && fraction < 1 && now - lastEmit < 100) return
          lastEmit = now
          this.emit(job, { completed: Math.min(completed, job.progress.total), fraction, outputs: [...out.outputs] })
        },
        setMessage: (message) => {
          job.progress.message = message
        },
        perFile: async (_index, fn) => {
          const mark = out.outputs.length
          try {
            return await fn()
          } catch (err) {
            await out.rollbackTo(mark)
            throw err
          }
        },
      }
      await handlerFor(action.id)!(ctx)
      this.emit(job, { status: 'done', completed: job.progress.total, fraction: 1, outputs: [...out.outputs] })
    } catch (err) {
      if (isCancellation(err) || signal.aborted) {
        this.emit(job, { status: 'cancelled', outputs: [...out.outputs] })
      } else {
        const e = toUserFacing(err)
        this.emit(job, { status: 'failed', outputs: [...out.outputs], error: { message: e.message, detail: e.detail } })
      }
    } finally {
      setTimeout(() => this.jobs.delete(job.progress.jobId), 60_000)
    }
  }
}

async function assertDirectory(dir: string): Promise<void> {
  const st = await stat(dir).catch(() => null)
  if (!st?.isDirectory()) throw new UserFacingError(`The output folder does not exist: ${dir}. Change it in Settings.`)
}
