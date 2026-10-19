import { z } from 'zod'
import type { MediaInfo } from '@shared/types'
import { AUDIO_FORMATS, type MediaFormat, VIDEO_FORMATS } from './media-actions'

export type { MediaInfo } from '@shared/types'

export const mediaEditSchema = z
  .object({
    start: z.number().min(0).default(0),
    end: z.number().positive().optional(),
    format: z.enum([...VIDEO_FORMATS, ...AUDIO_FORMATS] as [MediaFormat, ...MediaFormat[]]).optional(),
    quality: z.enum(['high', 'medium', 'low']).default('medium'),
    /** Output height in px for video (keeps aspect). */
    height: z.number().int().min(72).max(4320).optional(),
    /** Audio bitrate in kbps for lossy audio outputs. */
    audioKbps: z.number().int().min(32).max(512).optional(),
    removeAudio: z.boolean().default(false),
  })
  .refine((p) => p.end === undefined || p.end > p.start, { message: 'End must be after start' })

export type MediaEdit = z.output<typeof mediaEditSchema>

export interface MediaPlan {
  /** Arguments placed before `-i <input>` (fast, frame-accurate seeking when re-encoding). */
  preInput: string[]
  /** Arguments placed after the input and before the output path. */
  output: string[]
  ext: string
  /** Expected output duration, for progress. */
  durationSec: number
}

export class PlanError extends Error {}

const CRF = { mp4: { high: 18, medium: 23, low: 28 }, webm: { high: 28, medium: 33, low: 38 } }
const AUDIO_KBPS = { high: 256, medium: 192, low: 128 }

function audioArgs(format: MediaFormat, kbps: number): string[] {
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', `${kbps}k`]
    case 'm4a':
    case 'mp4':
      return ['-c:a', 'aac', '-b:a', `${kbps}k`]
    case 'ogg':
      return ['-c:a', 'libvorbis', '-b:a', `${kbps}k`]
    case 'webm':
      return ['-c:a', 'libopus', '-b:a', `${Math.min(kbps, 256)}k`]
    case 'wav':
      return ['-c:a', 'pcm_s16le']
    case 'flac':
      return ['-c:a', 'flac']
    case 'gif':
      return ['-an']
  }
}

/** Container for an audio-only result that keeps the source codec family where sensible. */
export function audioFormatFor(info: MediaInfo): MediaFormat {
  const c = info.audio?.codec ?? ''
  if (c === 'mp3') return 'mp3'
  if (c === 'flac') return 'flac'
  if (c === 'vorbis') return 'ogg'
  if (c.startsWith('pcm_')) return 'wav'
  return 'm4a'
}

/** Same-format output for "normalize": the source container when we can encode it. */
function sameAudioFormat(sourceFormat: string): MediaFormat {
  return (AUDIO_FORMATS as string[]).includes(sourceFormat) ? (sourceFormat as MediaFormat) : 'm4a'
}

function scaleFilter(height?: number): string[] {
  // -2 keeps the aspect ratio with an even width (required by yuv420p encoders).
  return height ? ['-vf', `scale=-2:${height}:flags=lanczos`] : []
}

function encode(format: MediaFormat, info: MediaInfo, edit: MediaEdit): string[] {
  const kbps = edit.audioKbps ?? AUDIO_KBPS[edit.quality]
  const audio = edit.removeAudio || !info.audio ? ['-an'] : audioArgs(format, kbps)
  switch (format) {
    case 'mp4':
      return [
        ...scaleFilter(edit.height),
        '-c:v', 'libx264', '-preset', edit.quality === 'low' ? 'slow' : 'medium', '-crf', String(CRF.mp4[edit.quality]),
        '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart',
      ]
    case 'webm':
      return [...scaleFilter(edit.height), '-c:v', 'libvpx-vp9', '-crf', String(CRF.webm[edit.quality]), '-b:v', '0', '-row-mt', '1', ...audio]
    case 'gif': {
      const h = edit.height ?? Math.min(info.video?.height ?? 480, 480)
      const fps = edit.quality === 'high' ? 15 : edit.quality === 'medium' ? 12 : 8
      return ['-filter_complex', `fps=${fps},scale=-2:${h}:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-an']
    }
    default:
      return ['-vn', ...audioArgs(format, kbps)]
  }
}

/** Build FFmpeg arguments for a media action. Throws PlanError for impossible requests. */
export function planMediaJob(actionId: string, sourceFormat: string, info: MediaInfo, params: Record<string, unknown>): MediaPlan {
  const full = info.durationSec
  const simple = (format: MediaFormat, overrides: Partial<MediaEdit> = {}): MediaPlan => {
    const edit = mediaEditSchema.parse(overrides)
    return { preInput: [], output: encode(format, info, edit), ext: format, durationSec: full }
  }

  switch (actionId) {
    case 'video.to-mp4':
      return simple('mp4', { quality: 'high' })
    case 'video.to-webm':
      return simple('webm')
    case 'video.to-gif':
      return simple('gif')
    case 'video.compress':
      return simple('mp4', { quality: 'low' })
    case 'video.extract-audio': {
      if (!info.audio) throw new PlanError('This video has no audio track.')
      // AAC and MP3 can be copied losslessly into a matching container.
      if (info.audio.codec === 'aac') return { preInput: [], output: ['-vn', '-c:a', 'copy'], ext: 'm4a', durationSec: full }
      if (info.audio.codec === 'mp3') return { preInput: [], output: ['-vn', '-c:a', 'copy'], ext: 'mp3', durationSec: full }
      return simple('mp3', { quality: 'high' })
    }
    case 'audio.to-mp3':
      return simple('mp3')
    case 'audio.to-m4a':
      return simple('m4a')
    case 'audio.to-wav':
      return simple('wav')
    case 'audio.to-flac':
      return simple('flac')
    case 'audio.to-ogg':
      return simple('ogg')
    case 'audio.normalize': {
      const format = sameAudioFormat(sourceFormat)
      const enc = audioArgs(format, AUDIO_KBPS.high)
      // EBU R128 single-pass loudness normalization to -16 LUFS (streaming/podcast target).
      return { preInput: [], output: ['-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', ...enc], ext: format, durationSec: full }
    }
    case 'video.edit':
    case 'audio.edit': {
      const edit = mediaEditSchema.parse(params)
      const isVideo = actionId === 'video.edit'
      const format = edit.format ?? (isVideo ? 'mp4' : audioFormatFor(info))
      if (isVideo && !info.video) throw new PlanError('No video stream found.')
      if (!isVideo && (VIDEO_FORMATS as string[]).includes(format)) throw new PlanError(`${format.toUpperCase()} needs a video stream.`)
      const end = Math.min(edit.end ?? full, full)
      if (edit.start >= end) throw new PlanError('The trim range is empty.')
      const preInput = edit.start > 0 ? ['-ss', edit.start.toFixed(3)] : []
      const length = end - edit.start
      const output = [...(end < full || edit.start > 0 ? ['-t', length.toFixed(3)] : []), ...encode(format, info, edit)]
      return { preInput, output, ext: format, durationSec: length }
    }
    default:
      throw new PlanError(`Not a media action: ${actionId}`)
  }
}

/** Parse ffprobe -print_format json output. */
export function parseProbe(json: string): MediaInfo {
  const data = JSON.parse(json) as {
    format?: { duration?: string; format_name?: string; size?: string; bit_rate?: string }
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; sample_rate?: string; channels?: number; bit_rate?: string; disposition?: { attached_pic?: number } }[]
  }
  const num = (v?: string) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null)
  const streams = data.streams ?? []
  // Cover art in audio files is a "video" stream with attached_pic; it is not a video.
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const a = streams.find((s) => s.codec_type === 'audio')
  const fps = (() => {
    const [n, d] = (v?.avg_frame_rate ?? '').split('/').map(Number)
    return n && d ? Math.round((n / d) * 100) / 100 : null
  })()
  return {
    durationSec: num(data.format?.duration) ?? 0,
    formatName: data.format?.format_name ?? 'unknown',
    sizeBytes: num(data.format?.size) ?? 0,
    bitRate: num(data.format?.bit_rate),
    video: v ? { codec: v.codec_name ?? 'unknown', width: v.width ?? 0, height: v.height ?? 0, fps } : undefined,
    audio: a ? { codec: a.codec_name ?? 'unknown', sampleRate: num(a.sample_rate), channels: a.channels ?? null, bitRate: num(a.bit_rate) } : undefined,
  }
}

export interface FitPlan {
  /** Output height (keeps aspect), or undefined to keep the source size. */
  height?: number
  videoKbps: number
  audioKbps: number
  durationSec: number
}

/**
 * Bitrates for a two-pass encode that lands under `targetBytes` (with ~6 % headroom for the
 * container). Resolution steps down when the bitrate gets too low for it to look good.
 */
export function planFitSize(info: MediaInfo, targetBytes: number, sourceBytes: number, safety = 0.94): FitPlan {
  if (sourceBytes > 0 && sourceBytes <= targetBytes) throw new PlanError(`Already under ${Math.round(targetBytes / 1024 / 1024)} MB.`)
  if (!info.video) throw new PlanError('No video stream found.')
  if (!(info.durationSec > 0)) throw new PlanError('Could not read the video length.')
  const audioKbps = info.audio ? (info.durationSec > 600 ? 64 : 96) : 0
  const totalKbps = (targetBytes * 8 * safety) / info.durationSec / 1000
  const videoKbps = Math.floor(totalKbps - audioKbps)
  if (videoKbps < 120) throw new PlanError(`This video is too long to fit in ${Math.round(targetBytes / 1024 / 1024)} MB at watchable quality.`)
  const src = info.video.height
  const height = videoKbps < 500 ? 360 : videoKbps < 900 ? 480 : videoKbps < 2000 ? 720 : 1080
  return { height: height < src ? height : undefined, videoKbps, audioKbps, durationSec: info.durationSec }
}

/** FFmpeg arguments for pass 1 (analysis, no output) and pass 2 (the real file). */
export function fitPassArgs(plan: FitPlan, passLog: string): { pass1: string[]; pass2: string[] } {
  const scale = plan.height ? ['-vf', `scale=-2:${plan.height}:flags=lanczos`] : []
  const video = [...scale, '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${plan.videoKbps}k`, '-pix_fmt', 'yuv420p', '-passlogfile', passLog]
  return {
    pass1: [...video, '-pass', '1', '-an', '-f', 'null'],
    pass2: [...video, '-pass', '2', ...(plan.audioKbps ? ['-c:a', 'aac', '-b:a', `${plan.audioKbps}k`] : ['-an']), '-movflags', '+faststart'],
  }
}
