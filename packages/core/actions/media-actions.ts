import type { Capabilities } from '@shared/types'
import type { ActionDefinition } from './types'

/** FFmpeg encoders each output needs. Checked against `ffmpeg -encoders` at runtime. */
export const ENCODERS = {
  mp4: ['libx264', 'aac'],
  webm: ['libvpx-vp9', 'libopus'],
  gif: ['gif'],
  mp3: ['libmp3lame'],
  m4a: ['aac'],
  wav: ['pcm_s16le'],
  flac: ['flac'],
  ogg: ['libvorbis'],
} as const

export type MediaFormat = keyof typeof ENCODERS
export const VIDEO_FORMATS: MediaFormat[] = ['mp4', 'webm', 'gif']
export const AUDIO_FORMATS: MediaFormat[] = ['mp3', 'm4a', 'wav', 'flac', 'ogg']

export function missingEncoders(format: MediaFormat, caps: Capabilities): string[] {
  return ENCODERS[format].filter((e) => !caps.ffmpeg.encoders.includes(e))
}

const needs =
  (...formats: MediaFormat[]) =>
  (caps: Capabilities): string | null => {
    if (!caps.ffmpeg.available || !caps.ffprobe.available) return 'FFmpeg is not installed'
    const missing = formats.flatMap((f) => missingEncoders(f, caps))
    return missing.length ? `FFmpeg lacks encoders: ${missing.join(', ')}` : null
  }

const VIDEO: ActionDefinition['kinds'] = ['video']
const AUDIO: ActionDefinition['kinds'] = ['audio']

const base = { minFiles: 1, maxFiles: 50, mode: 'instant' as const }

export const MEDIA_ACTIONS: ActionDefinition[] = [
  { ...base, id: 'video.to-mp4', label: 'MP4', title: 'Convert to MP4', icon: 'film', kinds: VIDEO, excludeFormats: ['mp4'], unavailableReason: needs('mp4'), suffix: 'converted' },
  { ...base, id: 'video.to-webm', label: 'WEBM', title: 'Convert to WEBM', icon: 'film', kinds: VIDEO, excludeFormats: ['webm'], unavailableReason: needs('webm'), suffix: 'converted' },
  { ...base, id: 'video.compress', label: 'COMPRESS', title: 'Compress video', icon: 'shrink', kinds: VIDEO, unavailableReason: needs('mp4'), suffix: 'compressed' },
  { ...base, id: 'video.extract-audio', label: 'AUDIO', title: 'Extract audio', icon: 'audio-lines', kinds: VIDEO, unavailableReason: needs('mp3'), suffix: 'audio' },
  { ...base, id: 'video.to-gif', label: 'GIF', title: 'Convert to GIF', icon: 'images', kinds: VIDEO, unavailableReason: needs('gif'), suffix: 'converted' },
  {
    id: 'video.edit',
    label: 'TRIM',
    title: 'Trim & export',
    icon: 'scissors',
    kinds: VIDEO,
    minFiles: 1,
    maxFiles: 1,
    mode: 'editor',
    editor: 'media',
    unavailableReason: needs('mp4'),
    suffix: 'trimmed',
  },
  { ...base, id: 'audio.to-mp3', label: 'MP3', title: 'Convert to MP3', icon: 'music', kinds: AUDIO, excludeFormats: ['mp3'], unavailableReason: needs('mp3'), suffix: 'converted' },
  { ...base, id: 'audio.to-m4a', label: 'M4A', title: 'Convert to M4A', icon: 'music', kinds: AUDIO, excludeFormats: ['m4a'], unavailableReason: needs('m4a'), suffix: 'converted' },
  { ...base, id: 'audio.to-wav', label: 'WAV', title: 'Convert to WAV', icon: 'music', kinds: AUDIO, excludeFormats: ['wav'], unavailableReason: needs('wav'), suffix: 'converted' },
  { ...base, id: 'audio.to-flac', label: 'FLAC', title: 'Convert to FLAC', icon: 'music', kinds: AUDIO, excludeFormats: ['flac'], unavailableReason: needs('flac'), suffix: 'converted' },
  { ...base, id: 'audio.to-ogg', label: 'OGG', title: 'Convert to OGG', icon: 'music', kinds: AUDIO, excludeFormats: ['ogg'], unavailableReason: needs('ogg'), suffix: 'converted' },
  { ...base, id: 'audio.normalize', label: 'NORMALIZE', title: 'Normalize loudness', icon: 'volume-2', kinds: AUDIO, unavailableReason: needs('mp3', 'm4a'), suffix: 'normalized' },
  {
    id: 'audio.edit',
    label: 'TRIM',
    title: 'Trim & export',
    icon: 'scissors',
    kinds: AUDIO,
    minFiles: 1,
    maxFiles: 1,
    mode: 'editor',
    editor: 'media',
    unavailableReason: needs('mp3'),
    suffix: 'trimmed',
  },
]

export const DEFAULT_VIDEO_ORDER = ['video.to-mp4', 'video.compress', 'video.edit', 'video.extract-audio', 'video.to-gif', 'video.to-webm']
export const DEFAULT_AUDIO_ORDER = ['audio.to-mp3', 'audio.to-m4a', 'audio.edit', 'audio.normalize', 'audio.to-wav', 'audio.to-flac', 'audio.to-ogg']
