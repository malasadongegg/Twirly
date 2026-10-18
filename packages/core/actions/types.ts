import type { Capabilities, FileInfo, FileKind } from '@shared/types'

/** Lucide icon names used by actions. The renderer maps these to components. */
export type ActionIcon =
  | 'file-image'
  | 'crop'
  | 'scaling'
  | 'shrink'
  | 'rotate-cw'
  | 'eraser'
  | 'file-type'
  | 'files'
  | 'scissors'
  | 'file-text'
  | 'images'
  | 'music'
  | 'film'
  | 'info'
  | 'file-stack'
  | 'split'
  | 'layout-grid'
  | 'package'
  | 'file-output'
  | 'audio-lines'
  | 'volume-2'
  | 'gauge'
  | 'image-plus'
  | 'eye-off'
  | 'tag'
  | 'pen-line'

export type ActionMode = 'instant' | 'editor'
export type EditorKind = 'image' | 'pdf' | 'media' | 'background' | 'redact' | 'metadata' | 'annotate'

export interface ActionDefinition {
  id: string
  /** Short wheel label, uppercase, ≤ 10 chars. */
  label: string
  /** Full name, used in the hub, toasts and editors ("Convert to WEBP"). */
  title: string
  icon: ActionIcon
  kinds: FileKind[]
  /** Restrict to these detected formats (optional). */
  formats?: string[]
  /** Hide for these detected formats, e.g. "convert to PNG" for a PNG. */
  excludeFormats?: string[]
  minFiles: number
  maxFiles: number
  /** Returns a reason string when this machine cannot run the action, else null. */
  unavailableReason?: (caps: Capabilities) => string | null
  /** Per-file capability check, e.g. "can this build decode this image format?" */
  canRead?: (file: FileInfo, caps: Capabilities) => boolean
  mode: ActionMode
  /** Many inputs → one output (merge, images → PDF). Otherwise each file is processed on its own. */
  aggregate?: boolean
  editor?: EditorKind
  /** Output name suffix: photo.png -> photo-<suffix>.<ext>. */
  suffix: string
}

export interface ResolvedActions {
  actions: ActionDefinition[]
  /** Explains an empty result (e.g. mixed selection with nothing in common). */
  emptyReason?: string
}

export function acceptsFile(action: ActionDefinition, file: FileInfo, caps?: Capabilities): boolean {
  if (!action.kinds.includes(file.kind)) return false
  if (caps && action.canRead && !action.canRead(file, caps)) return false
  if (action.formats && !action.formats.includes(file.format)) return false
  if (action.excludeFormats?.includes(file.format)) return false
  return true
}
