import { z } from 'zod'
import { triggerVks } from './keys'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const settingsSchema = z.object({
  theme: z.enum(['dark', 'light']).default('dark'),
  accent: hex.default('#3b82f6'),
  animation: z.enum(['full', 'reduced', 'off']).default('full'),
  /** null = save next to the source file. */
  outputDir: z.string().min(1).nullable().default(null),
  naming: z.object({ separator: z.enum(['-', '_', ' ']).default('-') }).default({ separator: '-' }),
  quality: z
    .object({
      jpeg: z.number().int().min(1).max(100).default(88),
      webp: z.number().int().min(1).max(100).default(85),
      avif: z.number().int().min(1).max(100).default(60),
    })
    .default({ jpeg: 88, webp: 85, avif: 60 }),
  dragSummon: z
    .object({
      enabled: z.boolean().default(true),
      /** 'explorer': Explorer/desktop only. 'anywhere': any app. 'custom': the apps listed below. */
      scope: z.enum(['explorer', 'anywhere', 'custom']).default('explorer'),
      /** Process names for 'custom' scope, e.g. ["explorer.exe", "dopus.exe"]. */
      apps: z.array(z.string().regex(/^[\w .-]+\.exe$/i)).max(50).default(['explorer.exe']),
      /** KeyboardEvent.code or a side-agnostic modifier ("Shift", "Control", "Alt"). */
      trigger: z.string().refine((k) => triggerVks(k) !== null, 'Unsupported trigger key').default('Shift'),
    })
    .default({ enabled: true, scope: 'explorer', apps: ['explorer.exe'], trigger: 'Shift' }),
  startup: z
    .object({
      launchAtLogin: z.boolean().default(false),
      startHidden: z.boolean().default(false),
    })
    .default({ launchAtLogin: false, startHidden: false }),
  tray: z.object({ enabled: z.boolean().default(true), closeToTray: z.boolean().default(true) }).default({ enabled: true, closeToTray: true }),
  /** Per file kind: ordered action ids shown on the wheel (first 8 that apply). */
  wheelOrder: z.record(z.string(), z.array(z.string()).max(64)).default({}),
})

export type Settings = z.output<typeof settingsSchema>

/** A partial update; nested objects are merged one level deep. */
export const settingsPatchSchema = settingsSchema.partial()
export type SettingsPatch = z.input<typeof settingsPatchSchema>

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({})

/** Merge a validated patch into settings (one level deep for object values). */
export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  const next: Record<string, unknown> = { ...current }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const cur = (current as Record<string, unknown>)[k]
    next[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && k !== 'wheelOrder' ? { ...cur, ...v } : v
  }
  return settingsSchema.parse(next)
}
