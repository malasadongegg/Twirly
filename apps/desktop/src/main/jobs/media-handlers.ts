import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MEDIA_ACTIONS } from '@core/actions/media-actions'
import { fitPassArgs, planFitSize, PlanError, planMediaJob } from '@core/actions/media-plan'
import { probeMedia, runFfmpeg } from '@processing/media/ffmpeg'
import { UserFacingError } from '@processing/errors'
import { getCapabilities } from '../capabilities'
import type { Handler } from './handlers'

async function tools() {
  const caps = await getCapabilities()
  const ffmpeg = caps.ffmpeg.path
  const ffprobe = caps.ffprobe.path
  if (!caps.ffmpeg.available || !ffmpeg || !ffprobe) throw new UserFacingError('FFmpeg is not installed. Install it and re-detect in Settings → Diagnostics.')
  return { ffmpeg, ffprobe }
}

const plan = <T>(fn: () => T): T => {
  try {
    return fn()
  } catch (err) {
    if (err instanceof PlanError) throw new UserFacingError(err.message)
    throw err
  }
}

const mediaHandler: Handler = async (ctx) => {
  const { ffmpeg, ffprobe } = await tools()
  for (let i = 0; i < ctx.files.length; i++) {
    ctx.signal.throwIfAborted()
    const file = ctx.files[i]!
    await ctx.perFile(i, async () => {
      const info = await probeMedia(ffprobe, file.path)
      const p = plan(() => planMediaJob(ctx.action.id, file.format, info, ctx.params))
      await ctx.out.produce(file.path, ctx.action.suffix, p.ext, (tmp) =>
        runFfmpeg({ ffmpeg, input: file.path, output: tmp, preInput: p.preInput, args: p.output, durationSec: p.durationSec, signal: ctx.signal, onProgress: (f) => ctx.progress(i, f) }),
      )
    })
    ctx.progress(i + 1, null)
  }
}

/** Two-pass encode to a size limit (Messenger 25 MB, Discord 10 MB); one retry if it overshoots. */
const fitSize =
  (targetBytes: number): Handler =>
  async (ctx) => {
    const { ffmpeg, ffprobe } = await tools()
    for (let i = 0; i < ctx.files.length; i++) {
      ctx.signal.throwIfAborted()
      const file = ctx.files[i]!
      await ctx.perFile(i, async () => {
        const info = await probeMedia(ffprobe, file.path)
        const logDir = await mkdtemp(join(tmpdir(), 'twirly-2pass-'))
        try {
          await ctx.out.produce(file.path, ctx.action.suffix, 'mp4', async (tmp) => {
            for (const safety of [0.94, 0.82]) {
              const fp = plan(() => planFitSize(info, targetBytes, file.size, safety))
              const { pass1, pass2 } = fitPassArgs(fp, join(logDir, 'pass'))
              const common = { ffmpeg, input: file.path, preInput: [], durationSec: fp.durationSec, signal: ctx.signal }
              await runFfmpeg({ ...common, output: 'NUL', args: pass1, onProgress: (f) => ctx.progress(i, f / 2) })
              await runFfmpeg({ ...common, output: tmp, args: pass2, onProgress: (f) => ctx.progress(i, 0.5 + f / 2) })
              if ((await stat(tmp)).size <= targetBytes) return
            }
            throw new UserFacingError(`Could not get this video under ${Math.round(targetBytes / 1024 / 1024)} MB.`)
          })
        } finally {
          await rm(logDir, { recursive: true, force: true })
        }
      })
      ctx.progress(i + 1, null)
    }
  }

export const mediaHandlers: Record<string, Handler> = {
  ...Object.fromEntries(MEDIA_ACTIONS.map((a) => [a.id, mediaHandler])),
  'video.fit-25mb': fitSize(25 * 1024 * 1024),
  'video.fit-10mb': fitSize(10 * 1024 * 1024),
}
