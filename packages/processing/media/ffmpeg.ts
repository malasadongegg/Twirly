import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { parseProbe, type MediaInfo } from '@core/actions/media-plan'
import { CancelledError, UserFacingError } from '../errors'

const execFileP = promisify(execFile)

export async function probeMedia(ffprobe: string, path: string): Promise<MediaInfo> {
  try {
    const { stdout } = await execFileP(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    })
    return parseProbe(stdout)
  } catch (err) {
    throw new UserFacingError('The media file could not be read. It may be damaged or in an unsupported format.', (err as Error).message)
  }
}

export interface FfmpegRun {
  ffmpeg: string
  input: string
  output: string
  preInput: string[]
  args: string[]
  /** Expected output duration, used to turn out_time into a fraction. */
  durationSec: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

/** Last lines of stderr that explain a failure, without FFmpeg's banner noise. */
function explain(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter((l) => l.trim() && !/^\s*(built with|configuration:|lib\w+\s+\d)/.test(l))
  return lines.slice(-6).join('\n')
}

/**
 * Run FFmpeg without a shell (arguments are passed as an array, so file names are never
 * interpreted). Progress comes from `-progress pipe:1`. Abort kills the process; the caller
 * removes the partial output.
 */
export function runFfmpeg(run: FfmpegRun): Promise<void> {
  return new Promise((resolve, reject) => {
    if (run.signal?.aborted) return reject(new CancelledError())
    const args = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...run.preInput, '-i', run.input, ...run.args, run.output]
    const child = spawn(run.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let buffered = ''
    let cancelled = false

    const onAbort = () => {
      cancelled = true
      child.kill()
    }
    run.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffered += chunk
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim())
        if (m && run.durationSec > 0) run.onProgress?.(Math.min(1, Number(m[1]) / 1e6 / run.durationSec))
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_000)
    })
    child.on('error', (err) => {
      run.signal?.removeEventListener('abort', onAbort)
      reject(new UserFacingError('FFmpeg could not be started.', err.message))
    })
    child.on('close', (code) => {
      run.signal?.removeEventListener('abort', onAbort)
      if (cancelled) return reject(new CancelledError())
      if (code === 0) {
        run.onProgress?.(1)
        return resolve()
      }
      const detail = explain(stderr)
      const msg = /No space left/i.test(detail)
        ? 'The disk is full.'
        : /Invalid data found|could not find codec|moov atom not found/i.test(detail)
          ? 'The media file is damaged or in an unsupported format.'
          : /Permission denied/i.test(detail)
            ? 'Permission denied while writing the output.'
            : 'FFmpeg failed to process the file.'
      reject(new UserFacingError(msg, detail))
    })
  })
}
