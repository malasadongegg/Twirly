import { z } from 'zod'

export { IPC } from './channels'

const pathString = z.string().min(1).max(32767)

export const inspectFilesSchema = z.array(pathString).min(1).max(500)

export const runJobSchema = z.object({
  actionId: z.string().min(1).max(100),
  paths: z.array(pathString).min(1).max(500),
  params: z.record(z.string(), z.unknown()).default({}),
})
export type RunJobRequest = z.input<typeof runJobSchema>

export const openEditorSchema = z.object({
  actionId: z.string().min(1).max(100),
  paths: z.array(pathString).min(1).max(500),
})
export type OpenEditorRequest = z.infer<typeof openEditorSchema>

export const imagePreviewSchema = z.object({
  path: pathString,
  maxSize: z.number().int().min(16).max(4096),
})

export const wheelShowSchema = z.object({
  /** Files already known (context menu / drop zone). Empty when summoned by a live drag. */
  paths: z.array(pathString).max(500),
  source: z.enum(['drag-summon', 'drop-zone', 'context-menu']),
})
export type WheelShowPayload = z.infer<typeof wheelShowSchema>

export interface EditorContext {
  actionId: string
  paths: string[]
}
