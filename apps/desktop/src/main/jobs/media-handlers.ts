import { MEDIA_ACTIONS } from '@core/actions/media-actions'
import { PlanError, planMediaJob } from '@core/actions/media-plan'
import { probeMedia, runFfmpeg } from '@processing/media/ffmpeg'
import { UserFacingError } from '@processing/errors'
import { getCapabilities } from '../capabilities'
import type { Handler } from './handlers'

const mediaHandler: Handler = async (ctx) => {
  const caps = await getCapabilities()
  const ffmpeg = caps.ffmpeg.path
  const ffprobe = caps.ffprobe.path
  if (!caps.ffmpeg.available || !ffmpeg || !ffprobe) throw new UserFacingError('FFmpeg is not installed. Install it and re-detect in Settings → Diagnostics.')

  for (let i = 0; i < ctx.files.length; i++) {
    ctx.signal.throwIfAborted()
    const file = ctx.files[i]!
    await ctx.perFile(i, async () => {
      const info = await probeMedia(ffprobe, file.path)
      let plan
      try {
        plan = planMediaJob(ctx.action.id, file.format, info, ctx.params)
      } catch (err) {
        if (err instanceof PlanError) throw new UserFacingError(err.message)
        throw err
      }
      await ctx.out.produce(file.path, ctx.action.suffix, plan.ext, (tmp) =>
        runFfmpeg({
          ffmpeg,
          input: file.path,
          output: tmp,
          preInput: plan.preInput,
          args: plan.output,
          durationSec: plan.durationSec,
          signal: ctx.signal,
          onProgress: (f) => ctx.progress(i, f),
        }),
      )
    })
    ctx.progress(i + 1, null)
  }
}

export const mediaHandlers: Record<string, Handler> = Object.fromEntries(MEDIA_ACTIONS.map((a) => [a.id, mediaHandler]))
