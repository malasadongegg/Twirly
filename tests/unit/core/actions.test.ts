import { describe, expect, it } from 'vitest'
import type { Capabilities, FileInfo } from '@shared/types'
import { describeSelection, MAX_WHEEL_SEGMENTS, resolveActions } from '@core/actions/resolve'
import { ACTIONS } from '@core/actions/definitions'
import { planImageJob } from '@core/actions/image-plan'

const caps: Capabilities = {
  imageInput: ['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif'],
  imageOutput: ['png', 'jpeg', 'webp', 'avif', 'tiff'],
  ffmpeg: { available: false, encoders: [] },
  ffprobe: { available: false },
  libreoffice: { available: false },
}

const file = (format: string, kind: FileInfo['kind'] = 'image'): FileInfo => ({
  path: `C:\\x\\a.${format}`,
  name: `a.${format}`,
  ext: format,
  size: 1000,
  kind,
  format,
  extensionMismatch: false,
})

describe('resolveActions', () => {
  it('never offers converting an image to its own format', () => {
    const ids = resolveActions([file('png')], caps).actions.map((a) => a.id)
    expect(ids).not.toContain('image.convert.png')
    expect(ids).toContain('image.convert.jpeg')
  })

  it('caps the wheel at 8 segments in default order', () => {
    const { actions } = resolveActions([file('png')], caps)
    expect(actions.length).toBe(MAX_WHEEL_SEGMENTS)
    expect(actions[0]!.id).toBe('image.convert.jpeg')
  })

  it('drops single-file editor actions for multi-file selections', () => {
    const ids = resolveActions([file('png'), file('jpeg')], caps).actions.map((a) => a.id)
    expect(ids).not.toContain('image.crop')
    expect(ids).toContain('image.compress')
  })

  it('offers only actions valid for every file', () => {
    const ids = resolveActions([file('png'), file('webp')], caps).actions.map((a) => a.id)
    expect(ids).not.toContain('image.convert.png')
    expect(ids).not.toContain('image.convert.webp')
  })

  it('hides formats this build cannot encode', () => {
    const noAvif = { ...caps, imageOutput: ['png', 'jpeg', 'webp'] }
    const ids = resolveActions([file('png')], noAvif).actions.map((a) => a.id)
    expect(ids).not.toContain('image.convert.avif')
  })

  it('explains undecodable images instead of offering broken actions', () => {
    const r = resolveActions([file('heic')], caps)
    expect(r.actions).toEqual([])
    expect(r.emptyReason).toMatch(/HEIC/)
  })

  it('explains mixed selections with nothing in common', () => {
    const r = resolveActions([file('png'), file('pdf', 'pdf')], caps)
    expect(r.actions).toEqual([])
    expect(r.emptyReason).toBe('No common actions for 1 image, 1 PDF')
  })

  it('rejects unknown files', () => {
    expect(resolveActions([file('zip', 'unknown')], caps).emptyReason).toBe('Unsupported file type')
  })

  it('honours a user-defined order', () => {
    const { actions } = resolveActions([file('png')], caps, { image: ['image.rotate', 'image.crop'] })
    expect(actions.slice(0, 2).map((a) => a.id)).toEqual(['image.rotate', 'image.crop'])
  })
})

describe('describeSelection', () => {
  it('pluralises per kind', () => {
    expect(describeSelection([file('png'), file('jpeg'), file('pdf', 'pdf')])).toBe('2 images, 1 PDF')
  })
})

describe('action registry', () => {
  it('has unique ids and short labels', () => {
    const ids = ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ACTIONS) expect(a.label.length).toBeLessThanOrEqual(10)
  })
})

describe('planImageJob', () => {
  it('maps conversions to the target format', () => {
    expect(planImageJob('image.convert.webp', file('png'), {}).format).toBe('webp')
  })
  it('keeps the source format for compress/rotate, falling back to PNG for GIF', () => {
    expect(planImageJob('image.compress', file('jpeg'), {}).format).toBe('jpeg')
    expect(planImageJob('image.rotate', file('gif'), {}).format).toBe('png')
  })
  it('validates editor params', () => {
    const plan = planImageJob('image.crop', file('png'), { crop: { left: 1, top: 2, width: 3, height: 4 }, format: 'webp' })
    expect(plan.ops.crop).toEqual({ left: 1, top: 2, width: 3, height: 4 })
    expect(plan.format).toBe('webp')
    expect(() => planImageJob('image.crop', file('png'), { crop: { left: -1, top: 0, width: 1, height: 1 } })).toThrow()
  })
})

describe('resolveActions with a customized wheel', () => {
  it('shows only the listed actions, in the listed order', () => {
    const { actions } = resolveActions([file('png')], caps, { image: ['image.crop', 'image.convert.webp'] }, ACTIONS, { exclusive: true })
    expect(actions.map((a) => a.id)).toEqual(['image.crop', 'image.convert.webp'])
  })
  it('explains when every action is hidden', () => {
    const r = resolveActions([file('png')], caps, { image: ['image.convert.png'] }, ACTIONS, { exclusive: true })
    expect(r.emptyReason).toMatch(/hidden/)
  })
})
