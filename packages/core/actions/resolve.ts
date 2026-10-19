import type { Capabilities, FileInfo } from '@shared/types'
import { acceptsFile, type ActionDefinition, type ResolvedActions } from './types'
import { ACTIONS, DEFAULT_WHEEL_ORDER } from './definitions'

export const MAX_WHEEL_SEGMENTS = 8

const KIND_NOUN: Record<string, [string, string]> = {
  image: ['image', 'images'],
  pdf: ['PDF', 'PDFs'],
  video: ['video', 'videos'],
  audio: ['audio file', 'audio files'],
  document: ['document', 'documents'],
  text: ['text file', 'text files'],
  archive: ['archive', 'archives'],
  folder: ['folder', 'folders'],
  unknown: ['unsupported file', 'unsupported files'],
}

/** "2 images, 1 PDF" */
export function describeSelection(files: FileInfo[]): string {
  const counts = new Map<string, number>()
  for (const f of files) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1)
  return [...counts]
    .map(([kind, n]) => {
      const [one, many] = KIND_NOUN[kind] ?? [kind, kind]
      return `${n} ${n === 1 ? one : many}`
    })
    .join(', ')
}

/**
 * Actions valid for every file in the selection on this machine, in wheel order, capped at
 * MAX_WHEEL_SEGMENTS. `order` maps a file kind to action ids; ids not listed sort after the
 * listed ones in registry order, unless `exclusive` is set (the user customized the wheel), in
 * which case only listed ids appear.
 */
export function resolveActions(
  files: FileInfo[],
  caps: Capabilities,
  order: Record<string, string[]> = DEFAULT_WHEEL_ORDER,
  registry: ActionDefinition[] = ACTIONS,
  opts: { exclusive?: boolean } = {},
): ResolvedActions {
  if (files.length === 0) return { actions: [], emptyReason: 'No files' }
  const valid = registry.filter(
    (a) =>
      files.length >= a.minFiles &&
      files.length <= a.maxFiles &&
      files.every((f) => acceptsFile(a, f, caps)) &&
      !a.unavailableReason?.(caps),
  )

  if (valid.length === 0) {
    if (files.every((f) => f.kind === 'unknown')) return { actions: [], emptyReason: 'Unsupported file type' }
    const kinds = new Set(files.map((f) => f.kind))
    const undecodable = files.find((f) => f.kind === 'image' && !caps.imageInput.includes(f.format))
    if (undecodable) return { actions: [], emptyReason: `${undecodable.format.toUpperCase()} images are not supported yet` }
    return {
      actions: [],
      emptyReason: kinds.size > 1 ? `No common actions for ${describeSelection(files)}` : 'No actions available',
    }
  }

  const preferred = order[files[0]!.kind] ?? []
  if (opts.exclusive && preferred.length > 0) {
    const listed = valid.filter((a) => preferred.includes(a.id)).sort((a, b) => preferred.indexOf(a.id) - preferred.indexOf(b.id))
    return listed.length > 0 ? { actions: listed.slice(0, MAX_WHEEL_SEGMENTS) } : { actions: [], emptyReason: 'All actions for this type are hidden in Settings' }
  }
  const rank = (a: ActionDefinition) => {
    const i = preferred.indexOf(a.id)
    return i === -1 ? preferred.length + registry.indexOf(a) : i
  }
  return { actions: [...valid].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_WHEEL_SEGMENTS) }
}
