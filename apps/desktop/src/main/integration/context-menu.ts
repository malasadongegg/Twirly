import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'

const run = promisify(execFile)

/** Per-user verb on every file type. HKCU only: no admin rights, removable at any time. */
export const VERB_KEY = 'HKCU\\Software\\Classes\\*\\shell\\Twirly'

/** The command Explorer runs for the verb. Dev builds launch electron.exe with the app path. */
export function verbCommand(execPath: string, appPathArg: string | null): string {
  const app = appPathArg ? ` "${appPathArg}"` : ''
  return `"${execPath}"${app} --files "%1"`
}

/** `reg.exe` argument lists (no shell is involved, so nothing is interpolated). */
export function installArgs(command: string, iconPath: string): string[][] {
  return [
    ['add', VERB_KEY, '/ve', '/d', 'Open with Twirly', '/f'],
    ['add', VERB_KEY, '/v', 'Icon', '/d', iconPath, '/f'],
    ['add', `${VERB_KEY}\\command`, '/ve', '/d', command, '/f'],
  ]
}

export const uninstallArgs = (): string[] => ['delete', VERB_KEY, '/f']

function currentCommand(): string {
  return app.isPackaged ? verbCommand(process.execPath, null) : verbCommand(process.execPath, app.getAppPath())
}

export async function isContextMenuInstalled(): Promise<boolean> {
  try {
    await run('reg.exe', ['query', `${VERB_KEY}\\command`], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

export async function installContextMenu(): Promise<void> {
  for (const args of installArgs(currentCommand(), process.execPath)) await run('reg.exe', args, { windowsHide: true })
}

export async function uninstallContextMenu(): Promise<void> {
  if (await isContextMenuInstalled()) await run('reg.exe', uninstallArgs(), { windowsHide: true })
}
