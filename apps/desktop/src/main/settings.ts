import { readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { DEFAULT_SETTINGS, mergeSettings, settingsSchema, type Settings } from '@shared/settings'
import { IPC } from '@shared/channels'

const file = () => join(app.getPath('userData'), 'settings.json')

let current: Settings | null = null
const listeners = new Set<(s: Settings, prev: Settings) => void>()

/** Load once; a missing or corrupt file falls back to defaults (and is rewritten on next save). */
export function getSettings(): Settings {
  if (current) return current
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(readFileSync(file(), 'utf8')))
    current = parsed.success ? parsed.data : DEFAULT_SETTINGS
  } catch {
    current = DEFAULT_SETTINGS
  }
  return current
}

let writing = Promise.resolve()

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const prev = getSettings()
  const next = mergeSettings(prev, patch)
  current = next
  // Serialize writes; write-then-rename so a crash never leaves a truncated file.
  writing = writing.then(async () => {
    const tmp = file() + '.tmp'
    await writeFile(tmp, JSON.stringify(next, null, 2))
    await rename(tmp, file())
  })
  await writing
  for (const l of listeners) l(next, prev)
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.settingsChanged, next)
  return next
}

export function onSettingsChanged(fn: (s: Settings, prev: Settings) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
