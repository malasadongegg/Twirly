import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ImagePreview } from '@shared/api'
import { useJob } from '../../hooks/useJob'

export const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Load a downscaled preview of an image (plus its full, oriented dimensions). */
export function useImagePreview(path: string, maxSize = 1400) {
  const [preview, setPreview] = useState<ImagePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.twirly
      .imagePreview(path, maxSize)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(cleanError(e)))
    return () => {
      alive = false
    }
  }, [path, maxSize])
  return { preview, error }
}

/** Run an action on one file and expose its progress/outcome for an editor footer. */
export function useEditorJob(actionId: string, path: string) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const progress = useJob(jobId)
  const run = useCallback(
    async (params: Record<string, unknown>, overrideAction?: string) => {
      setSubmitError(null)
      try {
        const { jobId: id } = await window.twirly.runJob({ actionId: overrideAction ?? actionId, paths: [path], params })
        setJobId(id)
      } catch (e) {
        setSubmitError(cleanError(e))
      }
    },
    [actionId, path],
  )
  const busy = progress?.status === 'running' || progress?.status === 'queued' || (jobId !== null && !progress)
  const done = progress?.status === 'done'
  const error = submitError ?? (progress?.status === 'failed' ? (progress.error?.message ?? 'Failed') : null)
  const output = done ? progress.outputs.at(-1) : undefined
  return { run, busy, done, error, output }
}

/** Size of an element's content box, kept current. */
export function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: e!.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}
