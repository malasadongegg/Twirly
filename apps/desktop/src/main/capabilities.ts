import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Capabilities } from '@shared/types'
import { configureHeicDecoder, detectImageInputs, detectImageOutputs } from '@processing/images/process'

const run = promisify(execFile)

async function probe(command: string, args: string[]): Promise<string | null> {
  try {
    // execFile never goes through a shell, so nothing here is interpolated.
    const { stdout } = await run(command, args, { timeout: 5000, windowsHide: true })
    return stdout
  } catch {
    return null
  }
}

async function detectFfmpeg(path: string): Promise<Capabilities['ffmpeg']> {
  const version = await probe(path, ['-hide_banner', '-version'])
  if (!version) return { available: false, encoders: [] }
  const encList = (await probe(path, ['-hide_banner', '-encoders'])) ?? ''
  const encoders = [...encList.matchAll(/^\s[VAS][\w.]{5}\s+(\S+)/gm)].map((m) => m[1]!)
  return { available: true, path, version: /ffmpeg version (\S+)/.exec(version)?.[1], encoders }
}

let cached: Promise<Capabilities> | null = null

/** Detect once per session; `refresh` re-runs detection (Settings → Diagnostics). */
export function getCapabilities(opts: { ffmpegPath?: string; refresh?: boolean } = {}): Promise<Capabilities> {
  if (cached && !opts.refresh) return cached
  cached = (async () => {
    const ffmpegCmd = opts.ffmpegPath || 'ffmpeg'
    const ffprobeCmd = ffmpegCmd.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1')
    const [ffmpeg, ffprobeOut, soffice] = await Promise.all([
      detectFfmpeg(ffmpegCmd),
      probe(ffprobeCmd, ['-hide_banner', '-version']),
      probe('soffice', ['--version']),
    ])
    // HEIC through FFmpeg when it can decode HEVC.
    const decoders = ffmpeg.available ? ((await probe(ffmpegCmd, ['-hide_banner', '-decoders'])) ?? '') : ''
    const heic = /^\s*V\S*\s+hevc\s/m.test(decoders)
    configureHeicDecoder(heic ? ffmpegCmd : null)
    return {
      imageInput: [...detectImageInputs(), ...(heic ? ['heic'] : [])],
      imageOutput: detectImageOutputs(),
      ffmpeg,
      ffprobe: { available: ffprobeOut !== null, path: ffprobeOut !== null ? ffprobeCmd : undefined },
      libreoffice: { available: soffice !== null },
    }
  })()
  return cached
}
