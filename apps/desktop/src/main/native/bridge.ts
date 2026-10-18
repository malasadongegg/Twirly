import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { app } from 'electron'
import { parseHelperMessage, type HelperMessage } from './protocol'
import { spikeLog } from '../spike-log'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { triggerVks } from '@shared/keys'

export interface NativeBridgeHandlers {
  onSummon: () => void
  onMouseUp: () => void
}

export interface NativeBridgeStatus {
  state: 'unsupported' | 'missing' | 'starting' | 'running' | 'crashed'
  detail?: string
}

let status: NativeBridgeStatus = { state: 'starting' }
export const getNativeBridgeStatus = (): NativeBridgeStatus => status

export type HelperConfig = Settings['dragSummon']

let helperConfig: HelperConfig = DEFAULT_SETTINGS.dragSummon
let child: ChildProcess | null = null

function pushConfig(): void {
  if (!child?.stdin?.writable) return
  const { enabled, scope, apps, trigger } = helperConfig
  const message = { type: 'config', enabled, scope, apps, triggerVks: triggerVks(trigger) ?? triggerVks('Shift') }
  child.stdin.write(JSON.stringify(message) + '\n')
}

/** Apply Settings → Integration. Takes effect immediately; re-sent after helper restarts. */
export function setHelperConfig(config: HelperConfig): void {
  helperConfig = config
  pushConfig()
}

function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'helper', 'TwirlyHelper.exe')
    : // Dev: the bundle lives in <repo>/out/main, so the repo root is two levels up.
      join(__dirname, '..', '..', 'native', 'windows-helper', 'bin', 'publish', 'TwirlyHelper.exe')
}

/**
 * Starts the input-state helper. It talks over its own stdio pipes (JSON lines), which only this
 * process holds, so no other program can inject summon events. If the helper is missing or
 * crashes repeatedly, drag-summon is simply unavailable: the drop zone and the context menu
 * keep working.
 */
export function startNativeBridge(handlers: NativeBridgeHandlers, initial?: HelperConfig): void {
  if (initial) helperConfig = initial
  if (process.platform !== 'win32') {
    status = { state: 'unsupported', detail: 'Drag-summon requires Windows' }
    return
  }
  const exe = helperPath()
  if (!existsSync(exe)) {
    status = { state: 'missing', detail: `Helper not found at ${exe}. Run "npm run helper:build".` }
    spikeLog('helper-status', { ...status })
    return
  }

  let restarts = 0

  const launch = () => {
    status = { state: 'starting' }
    child = spawn(exe, ['--parent-pid', String(process.pid)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const lines = createInterface({ input: child.stdout! })
    lines.on('line', (line) => {
      const msg = parseHelperMessage(line)
      if (msg) dispatch(msg)
    })
    child.stderr!.on('data', (d: Buffer) => console.warn('[helper]', d.toString().trim()))
    child.on('exit', (code) => {
      if (app.isReady() && !quitting && restarts < 3) {
        restarts++
        status = { state: 'crashed', detail: `Helper exited with code ${code}; restarting` }
        setTimeout(launch, 500 * restarts)
      } else if (!quitting) {
        status = { state: 'crashed', detail: `Helper exited with code ${code}` }
      }
    })
  }

  const dispatch = (msg: HelperMessage) => {
    spikeLog('helper', msg)
    switch (msg.type) {
      case 'ready':
        status = { state: 'running', detail: `Helper v${msg.version}` }
        pushConfig()
        break
      case 'summon':
        handlers.onSummon()
        break
      case 'mouseup':
        handlers.onMouseUp()
        break
      case 'error':
        console.warn('[helper]', msg.message)
        break
    }
  }

  let quitting = false
  app.on('before-quit', () => {
    quitting = true
    child?.kill()
  })
  launch()
}
