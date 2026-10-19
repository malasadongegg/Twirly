import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Capabilities, FileInfo } from '@shared/types'
import type { ActionDefinition } from '@core/actions/types'
import { describeSelection, resolveActions } from '@core/actions/resolve'
import { provisionalFiles, type DragItemLike } from '@core/file-types/mime'
import { formatBytes } from '@core/format/bytes'
import { ACTIONS, DEFAULT_WHEEL_ORDER } from '@core/actions/definitions'
import { useSettings } from '../../stores/settings'

let capsPromise: Promise<Capabilities> | null = null
const getCaps = () => (capsPromise ??= window.twirly.capabilities())

export type WheelPhase = 'closed' | 'open' | 'running' | 'error'

export interface WheelState {
  phase: WheelPhase
  files: FileInfo[]
  /** True once real paths are known (after a drop, or when opened with paths). */
  real: boolean
  actions: ActionDefinition[]
  emptyReason?: string
  active: number | null
  job?: { id: string; title: string }
  error?: string
  /** Opened from a drop whose types were unknown mid-drag: the user now clicks a segment. */
  clickToChoose?: boolean
}

const CLOSED: WheelState = { phase: 'closed', files: [], real: false, actions: [], active: null }

export function hubLabelFor(state: WheelState): string {
  if (state.error) return state.error
  if (state.emptyReason) return state.emptyReason
  const n = state.files.length
  if (n === 0) return state.phase === 'open' ? 'Move to choose' : ''
  // Unknown types mid-drag (folders, some videos): the centre reveals the real actions on drop.
  if (!state.real && state.files.every((f) => f.kind === 'unknown')) return 'Drop in the centre for all actions'
  if (!state.real) return n === 1 ? '1 file' : `${n} files`
  const total = state.files.reduce((s, f) => s + Math.max(f.size, 0), 0)
  return n === 1 ? formatBytes(total) : `${describeSelection(state.files)} · ${formatBytes(total)}`
}

/**
 * The wheel's state machine, shared by the wheel window (drag-summon, context menu) and the main
 * window's drop zone. Hosts translate DOM events into these calls.
 */
export function useWheelSession(opts: { onFinished?: () => void } = {}) {
  const [state, setState] = useState<WheelState>(CLOSED)
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  })
  const { onFinished } = opts

  const resolve = useCallback(async (files: FileInfo[], real: boolean, clickToChoose = false) => {
    const caps = await getCaps()
    const custom = useSettings.getState().settings.wheelOrder
    const kind = files[0]?.kind ?? 'unknown'
    const { actions, emptyReason } = resolveActions(files, caps, { ...DEFAULT_WHEEL_ORDER, ...custom }, ACTIONS, { exclusive: kind in custom })
    // During a drag, an unknown MIME type (common for .heic on Windows) is not final: the real
    // file is inspected on drop. Say so instead of claiming the type is unsupported.
    const unknownWhileDragging = !real && files.length > 0 && files.every((f) => f.kind === 'unknown')
    setState({
      phase: 'open',
      files,
      real,
      actions,
      emptyReason: unknownWhileDragging ? 'Drop to see actions' : emptyReason,
      active: null,
      clickToChoose,
    })
  }, [])

  /** Opened by a drag that has not dropped yet: only MIME types are known. */
  /** Drag-summon: show the empty wheel at once; actions fill in on the first OLE dragenter. */
  const openPending = useCallback(() => setState({ ...CLOSED, phase: 'open' }), [])

  const openFromDragItems = useCallback((items: ArrayLike<DragItemLike>) => resolve(provisionalFiles(items), false), [resolve])

  /** Opened with real paths (context menu, file picker). */
  const openWithPaths = useCallback(
    async (paths: string[]) => {
      const { files, rejected } = await window.twirly.inspect(paths)
      if (files.length === 0) {
        setState({ ...CLOSED, phase: 'open', emptyReason: rejected[0]?.reason ?? 'No usable files', real: true })
        return
      }
      await resolve(files, true)
    },
    [resolve],
  )

  const hover = useCallback((index: number | null) => {
    setState((s) => (s.phase === 'open' && s.active !== index ? { ...s, active: index } : s))
  }, [])

  const close = useCallback(() => {
    setState(CLOSED)
    onFinished?.()
  }, [onFinished])

  const execute = useCallback(
    async (action: ActionDefinition, paths: string[]) => {
      try {
        if (action.mode === 'editor') {
          await window.twirly.openEditor({ actionId: action.id, paths })
          close()
          return
        }
        const { jobId } = await window.twirly.runJob({ actionId: action.id, paths, params: {} })
        setState((s) => ({ ...s, phase: 'running', job: { id: jobId, title: action.title } }))
      } catch (err) {
        setState((s) => ({ ...s, phase: 'error', error: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
      }
    },
    [close],
  )

  /** Click/keyboard selection when paths are already known. */
  const select = useCallback(
    (index: number) => {
      const s = stateRef.current
      const action = s.actions[index]
      if (s.phase !== 'open' || !action || !s.real) return
      void execute(
        action,
        s.files.map((f) => f.path),
      )
    },
    [execute],
  )

  /**
   * Files were dropped on segment `index` (or on the hub/outside when null). The action chosen from
   * provisional MIME info is re-validated against the real files before anything runs.
   */
  const drop = useCallback(
    async (paths: string[], index: number | null) => {
      const s = stateRef.current
      const chosen = index !== null ? s.actions[index] : undefined
      if (!chosen && paths.length > 0 && !s.real && s.files.every((f) => f.kind === 'unknown')) {
        // Types were unknown mid-drag: inspect the real files and let the user pick by click.
        const { files } = await window.twirly.inspect(paths)
        if (files.length > 0) await resolve(files, true, true)
        else close()
        return
      }
      if (!chosen || paths.length === 0) {
        close()
        return
      }
      const { files, rejected } = await window.twirly.inspect(paths)
      const caps = await getCaps()
      const valid = resolveActions(files, caps, { [files[0]?.kind ?? 'unknown']: [chosen.id] }).actions
      if (rejected.length > 0 || !valid.some((a) => a.id === chosen.id)) {
        const reason = rejected[0]?.reason ?? `${chosen.title} cannot process ${files.length === 1 ? files[0]!.name : 'these files'}`
        setState((st) => ({ ...st, files, real: true, phase: 'error', error: reason }))
        return
      }
      setState((st) => ({ ...st, files, real: true }))
      await execute(
        chosen,
        files.map((f) => f.path),
      )
    },
    [close, execute, resolve],
  )

  const cancelJob = useCallback(() => {
    const job = stateRef.current.job
    if (job) void window.twirly.cancelJob(job.id)
  }, [])

  return { state, openPending, openFromDragItems, openWithPaths, hover, select, drop, close, cancelJob }
}

export type WheelSession = ReturnType<typeof useWheelSession>
