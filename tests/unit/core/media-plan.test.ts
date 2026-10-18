import { describe, expect, it } from 'vitest'
import { parseProbe, planMediaJob, PlanError, type MediaInfo } from '@core/actions/media-plan'
import { resolveActions } from '@core/actions/resolve'
import type { Capabilities, FileInfo } from '@shared/types'

const info: MediaInfo = {
  durationSec: 10,
  formatName: 'mov,mp4',
  sizeBytes: 1000,
  bitRate: 1000,
  video: { codec: 'h264', width: 1920, height: 1080, fps: 30 },
  audio: { codec: 'aac', sampleRate: 48000, channels: 2, bitRate: 128000 },
}

describe('planMediaJob', () => {
  it('builds web-friendly MP4 arguments', () => {
    const p = planMediaJob('video.to-mp4', 'mov', info, {})
    expect(p.ext).toBe('mp4')
    expect(p.output).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']))
  })

  it('seeks before the input and limits duration when trimming', () => {
    const p = planMediaJob('video.edit', 'mp4', info, { start: 2, end: 5, height: 720 })
    expect(p.preInput).toEqual(['-ss', '2.000'])
    expect(p.output.slice(0, 2)).toEqual(['-t', '3.000'])
    expect(p.output).toContain('scale=-2:720:flags=lanczos')
    expect(p.durationSec).toBe(3)
  })

  it('clamps the end to the media length and rejects empty ranges', () => {
    expect(planMediaJob('video.edit', 'mp4', info, { start: 0, end: 99 }).durationSec).toBe(10)
    expect(() => planMediaJob('video.edit', 'mp4', info, { start: 10, end: 12 })).toThrow(PlanError)
    expect(() => planMediaJob('video.edit', 'mp4', info, { start: 5, end: 4 })).toThrow()
  })

  it('copies AAC audio losslessly when extracting', () => {
    expect(planMediaJob('video.extract-audio', 'mp4', info, {})).toMatchObject({ ext: 'm4a', output: ['-vn', '-c:a', 'copy'] })
  })

  it('refuses audio extraction from silent video', () => {
    expect(() => planMediaJob('video.extract-audio', 'mp4', { ...info, audio: undefined }, {})).toThrow(/no audio/)
  })

  it('keeps the source container when normalizing audio', () => {
    expect(planMediaJob('audio.normalize', 'flac', { ...info, video: undefined }, {}).ext).toBe('flac')
    expect(planMediaJob('audio.normalize', 'aac', { ...info, video: undefined }, {}).ext).toBe('m4a')
  })

  it('drops audio when asked or when the source has none', () => {
    expect(planMediaJob('video.edit', 'mp4', info, { removeAudio: true }).output).toContain('-an')
    expect(planMediaJob('video.to-mp4', 'mov', { ...info, audio: undefined }, {}).output).toContain('-an')
  })
})

describe('parseProbe', () => {
  it('ignores cover art and parses frame rates', () => {
    const json = JSON.stringify({
      format: { duration: '12.5', format_name: 'mp3', size: '2048', bit_rate: '320000' },
      streams: [
        { codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2 },
        { codec_type: 'video', codec_name: 'mjpeg', width: 500, height: 500, disposition: { attached_pic: 1 } },
      ],
    })
    const p = parseProbe(json)
    expect(p.durationSec).toBe(12.5)
    expect(p.video).toBeUndefined()
    expect(p.audio).toMatchObject({ codec: 'mp3', sampleRate: 44100, channels: 2 })
    expect(parseProbe(JSON.stringify({ streams: [{ codec_type: 'video', avg_frame_rate: '30000/1001' }] })).video?.fps).toBe(29.97)
  })
})

describe('media actions in the wheel', () => {
  const caps = (encoders: string[]): Capabilities => ({
    imageInput: [],
    imageOutput: [],
    ffmpeg: { available: true, encoders, path: 'ffmpeg' },
    ffprobe: { available: true, path: 'ffprobe' },
    libreoffice: { available: false },
  })
  const vid: FileInfo = { path: 'C:\\v.mov', name: 'v.mov', ext: 'mov', size: 1, kind: 'video', format: 'mov', extensionMismatch: false }

  it('hides actions whose encoders are missing', () => {
    const ids = resolveActions([vid], caps(['libx264', 'aac'])).actions.map((a) => a.id)
    expect(ids).toContain('video.to-mp4')
    expect(ids).not.toContain('video.to-webm')
    expect(ids).not.toContain('video.extract-audio') // needs libmp3lame
  })

  it('hides all media actions without FFmpeg', () => {
    const none: Capabilities = { ...caps([]), ffmpeg: { available: false, encoders: [] }, ffprobe: { available: false } }
    expect(resolveActions([vid], none).actions).toEqual([])
  })
})
