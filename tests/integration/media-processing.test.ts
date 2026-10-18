import { execFileSync } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { planMediaJob } from '@core/actions/media-plan'
import { probeMedia, runFfmpeg } from '@processing/media/ffmpeg'
import { OutputWriter } from '@processing/output'
import { toUserFacing } from '@processing/errors'

const root = join(process.cwd(), 'tests', '.tmp', 'media-processing')
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-hide_banner', '-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

let video: string
let audio: string

/** Run one action end to end exactly like the app: probe → plan → FFmpeg into a temp file → commit. */
async function run(actionId: string, input: string, format: string, params: Record<string, unknown> = {}, signal?: AbortSignal, onProgress?: (f: number) => void) {
  const info = await probeMedia('ffprobe', input)
  const plan = planMediaJob(actionId, format, info, params)
  const out = new OutputWriter()
  return out.produce(input, 'out', plan.ext, (tmp) =>
    runFfmpeg({ ffmpeg: 'ffmpeg', input, output: tmp, preInput: plan.preInput, args: plan.output, durationSec: plan.durationSec, signal, onProgress }),
  )
}

describe.skipIf(!hasFfmpeg)('FFmpeg media processing (real ffmpeg)', () => {
  beforeAll(async () => {
    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })
    video = join(root, 'clip ñ.mp4')
    audio = join(root, 'tone.wav')
    // 3 s, 320×240 test pattern with a 440 Hz tone.
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video])
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audio])
  }, 60_000)
  afterAll(() => rm(root, { recursive: true, force: true }))

  it('probes duration and streams', async () => {
    const info = await probeMedia('ffprobe', video)
    expect(info.durationSec).toBeGreaterThan(2.9)
    expect(info.video).toMatchObject({ codec: 'h264', width: 320, height: 240 })
    expect(info.audio?.codec).toBe('aac')
  })

  it('converts video to WEBM with progress reaching 1', async () => {
    const seen: number[] = []
    const out = await run('video.to-webm', video, 'mp4', {}, undefined, (f) => seen.push(f))
    const info = await probeMedia('ffprobe', out)
    expect(info.video?.codec).toBe('vp9')
    expect(info.audio?.codec).toBe('opus')
    expect(seen.at(-1)).toBe(1)
  }, 60_000)

  it('trims and downscales in the editor path', async () => {
    const out = await run('video.edit', video, 'mp4', { start: 1, end: 2.5, height: 120 })
    const info = await probeMedia('ffprobe', out)
    expect(info.durationSec).toBeGreaterThan(1.3)
    expect(info.durationSec).toBeLessThan(1.7)
    expect(info.video).toMatchObject({ width: 160, height: 120 })
  }, 60_000)

  it('extracts AAC audio losslessly into M4A', async () => {
    const out = await run('video.extract-audio', video, 'mp4')
    expect(out.endsWith('.m4a')).toBe(true)
    const info = await probeMedia('ffprobe', out)
    expect(info.video).toBeUndefined()
    expect(info.audio?.codec).toBe('aac')
  }, 60_000)

  it('makes a GIF', async () => {
    const out = await run('video.to-gif', video, 'mp4')
    expect((await probeMedia('ffprobe', out)).video?.codec).toBe('gif')
  }, 60_000)

  it('converts and normalizes audio', async () => {
    const mp3 = await run('audio.to-mp3', audio, 'wav')
    expect((await probeMedia('ffprobe', mp3)).audio?.codec).toBe('mp3')
    const norm = await run('audio.normalize', audio, 'wav')
    expect(norm.endsWith('.wav')).toBe(true)
    expect((await probeMedia('ffprobe', norm)).audio?.codec).toBe('pcm_s16le')
  }, 60_000)

  it('cancellation kills FFmpeg and leaves no partial output', async () => {
    const dir = join(root, 'cancel')
    await mkdir(dir)
    const long = join(dir, 'long.mp4')
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=60', '-c:v', 'libx264', '-preset', 'ultrafast', long])
    const ctrl = new AbortController()
    const p = run('video.to-webm', long, 'mp4', {}, ctrl.signal, (f) => f > 0 && ctrl.abort())
    await expect(p).rejects.toThrow(/Cancelled/)
    expect(await readdir(dir)).toEqual(['long.mp4'])
  }, 120_000)

  it('reports damaged media readably', async () => {
    const bad = join(root, 'bad.mp4')
    execFileSync('node', ['-e', `require('fs').writeFileSync(process.argv[1], Buffer.from('0000001866747970', 'hex'))`, bad])
    const err = await probeMedia('ffprobe', bad).catch((e) => e)
    expect(toUserFacing(err).message).toMatch(/could not be read|damaged/)
  })
})
