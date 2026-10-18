import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { configureHeicDecoder, loadImage } from '@processing/images/process'
import { runImageAction } from '@processing/images/image-job'
import { inspectPath } from '@processing/fs/inspect'
import type { FileInfo } from '@shared/types'

sharp.cache(false)

const fixtures = join(process.cwd(), 'tests', 'fixtures', 'heic')
const grid = join(fixtures, 'C007.heic')
const camera = join(fixtures, '3B_HEIC_SDR.heic')
const out = join(process.cwd(), 'tests', '.tmp', 'heic-out')
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

// Run `node scripts/fetch-test-fixtures.mjs` to get the samples.
describe.skipIf(!hasFfmpeg || !existsSync(grid) || !existsSync(camera))('HEIC via FFmpeg (real samples)', () => {
  beforeAll(async () => {
    configureHeicDecoder('ffmpeg')
    await rm(out, { recursive: true, force: true })
    await mkdir(out, { recursive: true })
  })
  afterAll(() => configureHeicDecoder(null))

  it('detects HEIC by signature', async () => {
    const info = (await inspectPath(grid)) as FileInfo
    expect([info.kind, info.format]).toEqual(['image', 'heic'])
  })

  it('composes a 2×2 tile grid into the full image', async () => {
    const meta = await sharp(await loadImage(grid)).metadata()
    expect([meta.width, meta.height]).toEqual([2560, 1440])
  }, 60_000)

  it('converts a 45 MP camera HEIC to JPEG', async () => {
    const copy = join(out, 'camera.heic')
    execFileSync(process.platform === 'win32' ? 'cmd' : 'cp', process.platform === 'win32' ? ['/c', 'copy', '/y', camera, copy] : [camera, copy], { stdio: 'ignore' })
    const file = (await inspectPath(copy)) as FileInfo
    const result = await runImageAction({ actionId: 'image.convert.jpeg', suffix: 'converted', file, params: {} })
    const meta = await sharp(result).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 8256, 5504])
  }, 120_000)

  it('explains when FFmpeg is not available', async () => {
    configureHeicDecoder(null)
    await expect(loadImage(grid)).rejects.toThrow(/needs FFmpeg/)
    configureHeicDecoder('ffmpeg')
  })
})
