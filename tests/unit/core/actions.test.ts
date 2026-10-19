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
  office: { word: false, excel: false, powerpoint: false },
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

  it('never offers image actions for images this build cannot decode', () => {
    const r = resolveActions([file('heic')], caps)
    expect(r.actions.filter((a) => a.id.startsWith('image.'))).toEqual([])
    expect(r.actions.map((a) => a.id)).toContain('file.copy-path')
  })

  it('offers only the actions mixed selections share', () => {
    const r = resolveActions([file('png'), file('pdf', 'pdf')], caps)
    expect(r.actions.every((a) => a.id.startsWith('file.'))).toBe(true)
  })

  it('explains selections that nothing can handle', () => {
    expect(resolveActions([file('png'), file('folder', 'folder')], caps, undefined, ACTIONS.filter((a) => !a.id.startsWith('file.'))).emptyReason).toBe('No common actions for 1 image, 1 folder')
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

describe('new kinds: folders, archives, documents, text, anything', () => {
  const ids = (f: FileInfo[], c: Capabilities = caps) => resolveActions(f, c).actions.map((a) => a.id)
  it('offers zip, images → PDF and copy path for folders', () => {
    expect(ids([file('folder', 'folder')])).toEqual(['file.zip', 'folder.images-to-pdf', 'file.copy-path'])
  })
  it('offers extract first for ZIPs, but not for 7z/RAR', () => {
    expect(ids([file('zip', 'archive')])[0]).toBe('archive.extract')
    expect(ids([file('7z', 'archive')])).not.toContain('archive.extract')
  })
  it('gives unknown files generic actions instead of nothing', () => {
    expect(ids([file('exe', 'unknown')])).toEqual(['file.zip', 'file.copy-path', 'file.checksum'])
  })
  it('only offers Office → PDF when Office or LibreOffice can do it', () => {
    expect(ids([file('docx', 'document')])).not.toContain('document.to-pdf')
    expect(ids([file('docx', 'document')], { ...caps, office: { word: true, excel: false, powerpoint: false } })[0]).toBe('document.to-pdf')
    expect(ids([file('xlsx', 'document')], { ...caps, office: { word: true, excel: false, powerpoint: false } })).not.toContain('document.to-pdf')
    expect(ids([file('pptx', 'document')], { ...caps, libreoffice: { available: true } })).toContain('document.to-pdf')
  })
  it('text files get PDF/DOCX, and combine needs two', () => {
    expect(ids([file('txt', 'text')]).slice(0, 2)).toEqual(['text.to-pdf', 'text.to-docx'])
    expect(ids([file('txt', 'text')])).not.toContain('text.combine')
    expect(ids([file('txt', 'text'), file('md', 'text')])).toContain('text.combine')
  })
  it('keeps the image wheel focused on image tools', () => {
    expect(ids([file('png')])).not.toContain('file.copy-path')
  })
  it('mixed selections can still zip or copy paths', () => {
    expect(ids([file('png'), file('pdf', 'pdf')])).toEqual(expect.arrayContaining(['file.zip', 'file.copy-path']))
  })
})

describe('same format, different extension', () => {
  it('offers JPG for .jfif (JPEG inside) but not for .jpg', () => {
    const jfif: FileInfo = { ...file('jpeg'), ext: 'jfif', name: 'a.jfif' }
    expect(resolveActions([jfif], caps).actions.map((a) => a.id)).toContain('image.convert.jpeg')
    expect(resolveActions([{ ...file('jpeg'), ext: 'jpg' }], caps).actions.map((a) => a.id)).not.toContain('image.convert.jpeg')
  })
})
