import { appendFileSync } from 'node:fs'

const target = process.env.TWIRLY_SPIKE_LOG

/**
 * Evidence log for integration experiments (docs/native-integration.md). Disabled unless
 * TWIRLY_SPIKE_LOG names a file. Never enabled in normal use.
 */
export function spikeLog(event: string, data: Record<string, unknown> = {}): void {
  if (!target) return
  try {
    appendFileSync(target, JSON.stringify({ t: Date.now(), event, ...data }) + '\n')
  } catch {
    // Logging must never break the app.
  }
}
