import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { ActionDefinition } from '@core/actions/types'
import type { FileInfo } from '@shared/types'
import type { Settings } from '@shared/settings'
import { pdfEditSchema, pdfRenderSchema } from '@core/actions/pdf-params'
import { OutputWriter, pageSuffix } from '@processing/output'
import { runImageAction } from '@processing/images/image-job'
import { imagesToPdf, loadPdf, merge, optimize, rebuild, rotateAll, split } from '@processing/pdf/pdf-ops'
import { compressPdf } from '@processing/pdf/compress'
import { toLines, toParagraphs, type TextRun } from '@core/pdf/paragraphs'
import { buildDocx, type DocxPage } from '@core/docx/docx'
import { basename } from 'node:path'
import { UserFacingError } from '@processing/errors'
import { withPdf, pdfWorker } from '../pdf/render-client'
import { mediaHandlers } from './media-handlers'
import { backgroundSchema, redactSchema } from '@core/actions/image-extras'
import { renderAnnotated, renderRedacted, renderWithBackground } from '@processing/images/extras'
import { annotateSchema } from '@core/image/annotate'
import { loadImage } from '@processing/images/process'

export interface JobContext {
  action: ActionDefinition
  files: FileInfo[]
  params: Record<string, unknown>
  signal: AbortSignal
  settings: Settings
  out: OutputWriter
  /** Report progress: files fully finished so far, and progress within the current one (0..1 or null). */
  progress(completed: number, fraction: number | null): void
  /** Run work for one file; on failure or cancel, removes outputs that file had already produced. */
  perFile<T>(index: number, fn: () => Promise<T>): Promise<T>
}

export type Handler = (ctx: JobContext) => Promise<void>

/** One-click conversions use the quality defaults from Settings unless the caller set one. */
export function withQualityDefault(actionId: string, params: Record<string, unknown>, settings: Settings): Record<string, unknown> {
  const fmt = /^image\.convert\.(jpeg|webp|avif)$/.exec(actionId)?.[1] as keyof Settings['quality'] | undefined
  return fmt && params.quality === undefined ? { ...params, quality: settings.quality[fmt] } : params
}

const eachFile =
  (fn: (ctx: JobContext, file: FileInfo, index: number) => Promise<void>): Handler =>
  async (ctx) => {
    for (let i = 0; i < ctx.files.length; i++) {
      ctx.signal.throwIfAborted()
      await ctx.perFile(i, () => fn(ctx, ctx.files[i]!, i))
      ctx.progress(i + 1, null)
    }
  }

const imageHandler: Handler = eachFile(async (ctx, file) => {
  await runImageAction({
    actionId: ctx.action.id,
    suffix: ctx.action.suffix,
    file,
    params: withQualityDefault(ctx.action.id, ctx.params, ctx.settings),
    signal: ctx.signal,
    outputDir: ctx.settings.outputDir ?? undefined,
    naming: { separator: ctx.settings.naming.separator },
    onOutput: (p) => ctx.out.track(p),
  })
})

const pdfToImages = (format: 'png' | 'jpeg'): Handler =>
  eachFile(async (ctx, file, i) => {
    const { dpi } = pdfRenderSchema.parse(ctx.params)
    const bytes = await readFile(file.path, { signal: ctx.signal })
    await withPdf(bytes, async ({ docId, pageCount }) => {
      for (let p = 0; p < pageCount; p++) {
        ctx.signal.throwIfAborted()
        const { png } = await pdfWorker<{ png: Uint8Array }>({ op: 'render', docId, page: p, dpi, maxPixels: 40_000_000 })
        const data = format === 'png' ? png : await sharp(png).jpeg({ quality: ctx.settings.quality.jpeg, mozjpeg: true }).toBuffer()
        const suffix = pageCount === 1 ? 'converted' : pageSuffix('page', p + 1, pageCount)
        await ctx.out.write(file.path, suffix, format === 'png' ? 'png' : 'jpg', data, ctx.signal)
        ctx.progress(i, (p + 1) / pageCount)
      }
    })
  })

const pdfToText: Handler = eachFile(async (ctx, file, i) => {
  const bytes = await readFile(file.path, { signal: ctx.signal })
  const pages = await withPdf(bytes, async ({ docId, pageCount }) => {
    const texts: string[] = []
    for (let p = 0; p < pageCount; p++) {
      ctx.signal.throwIfAborted()
      texts.push((await pdfWorker<{ text: string }>({ op: 'text', docId, page: p })).text)
      ctx.progress(i, (p + 1) / pageCount)
    }
    return texts
  })
  if (pages.every((t) => t.trim() === '')) throw new UserFacingError('This PDF has no text layer (it is probably scanned images). OCR is not supported yet.')
  await ctx.out.write(file.path, '', 'txt', new TextEncoder().encode(pages.join('\n\n')), ctx.signal)
})

const pdfStructural = (fn: (doc: Awaited<ReturnType<typeof loadPdf>>, ctx: JobContext) => Promise<Uint8Array>): Handler =>
  eachFile(async (ctx, file) => {
    const doc = await loadPdf(file.path, ctx.signal)
    await ctx.out.write(file.path, ctx.action.suffix, 'pdf', await fn(doc, ctx), ctx.signal)
  })

const pdfSplit: Handler = eachFile(async (ctx, file, i) => {
  const parts = await split(await loadPdf(file.path, ctx.signal))
  for (let p = 0; p < parts.length; p++) {
    ctx.signal.throwIfAborted()
    await ctx.out.write(file.path, pageSuffix('page', p + 1, parts.length), 'pdf', parts[p]!, ctx.signal)
    ctx.progress(i, (p + 1) / parts.length)
  }
})

const pdfMerge: Handler = async (ctx) => {
  await ctx.perFile(0, async () => {
    const data = await merge(
      ctx.files.map((f) => f.path),
      ctx.signal,
    )
    await ctx.out.write(ctx.files[0]!.path, 'merged', 'pdf', data, ctx.signal)
  })
  ctx.progress(ctx.files.length, 1)
}

const imagesToPdfHandler: Handler = async (ctx) => {
  await ctx.perFile(0, async () => {
    const data = await imagesToPdf(
      ctx.files.map((f) => f.path),
      ctx.signal,
    )
    await ctx.out.write(ctx.files[0]!.path, ctx.files.length > 1 ? 'combined' : 'converted', 'pdf', data, ctx.signal)
  })
  ctx.progress(ctx.files.length, 1)
}

const backgroundHandler: Handler = eachFile(async (ctx, file) => {
  const params = backgroundSchema.parse(ctx.params)
  const data = await renderWithBackground(await loadImage(file.path, ctx.signal), params)
  await ctx.out.write(file.path, ctx.action.suffix, 'png', data, ctx.signal)
})

const redactHandler: Handler = eachFile(async (ctx, file) => {
  const params = redactSchema.parse(ctx.params)
  // Keep JPEG/WebP sources in their format; everything else becomes lossless PNG.
  const format = file.format === 'jpeg' ? 'jpeg' : file.format === 'webp' ? 'webp' : 'png'
  const data = await renderRedacted(await loadImage(file.path, ctx.signal), params, format)
  await ctx.out.write(file.path, ctx.action.suffix, format === 'jpeg' ? 'jpg' : format, data, ctx.signal)
})

const annotateHandler: Handler = eachFile(async (ctx, file) => {
  const { shapes } = annotateSchema.parse(ctx.params)
  const format = file.format === 'jpeg' ? 'jpeg' : file.format === 'webp' ? 'webp' : 'png'
  const data = await renderAnnotated(await loadImage(file.path, ctx.signal), shapes, format)
  await ctx.out.write(file.path, ctx.action.suffix, format === 'jpeg' ? 'jpg' : format, data, ctx.signal)
})

const pdfCompress: Handler = eachFile(async (ctx, file) => {
  const { data } = await compressPdf(await readFile(file.path, { signal: ctx.signal }), 'balanced', ctx.signal)
  await ctx.out.write(file.path, ctx.action.suffix, 'pdf', data, ctx.signal)
})

const pdfToDocx: Handler = eachFile(async (ctx, file, i) => {
  const bytes = await readFile(file.path, { signal: ctx.signal })
  const pages = await withPdf(bytes, async ({ docId, pageCount }) => {
    const out: DocxPage[] = []
    for (let p = 0; p < pageCount; p++) {
      ctx.signal.throwIfAborted()
      const layout = await pdfWorker<{ width: number; height: number; runs: TextRun[] }>({ op: 'layout', docId, page: p })
      out.push({ width: layout.width, height: layout.height, paragraphs: toParagraphs(toLines(layout.runs)) })
      ctx.progress(i, (p + 1) / pageCount)
    }
    return out
  })
  if (pages.every((pg) => pg.paragraphs.length === 0)) throw new UserFacingError('This PDF has no text layer (it is probably scanned images). OCR is not supported yet.')
  const title = basename(file.path).replace(/\.pdf$/i, '')
  await ctx.out.write(file.path, '', 'docx', buildDocx(pages, title), ctx.signal)
})

const HANDLERS: Record<string, Handler> = {
  'pdf.to-docx': pdfToDocx,
  'pdf.compress': pdfCompress,
  'image.annotate': annotateHandler,
  'image.background': backgroundHandler,
  'image.redact': redactHandler,
  'pdf.to-png': pdfToImages('png'),
  'pdf.to-jpeg': pdfToImages('jpeg'),
  'pdf.to-text': pdfToText,
  'pdf.split': pdfSplit,
  'pdf.rotate': pdfStructural((doc) => rotateAll(doc, 90)),
  'pdf.optimize': pdfStructural((doc) => optimize(doc)),
  'pdf.edit': pdfStructural((doc, ctx) => rebuild(doc, pdfEditSchema.parse(ctx.params).pages)),
  'pdf.merge': pdfMerge,
  'image.to-pdf': imagesToPdfHandler,
  ...mediaHandlers,
}

export function handlerFor(actionId: string): Handler | undefined {
  if (HANDLERS[actionId]) return HANDLERS[actionId]
  if (actionId === 'image.metadata') return undefined // view-only
  if (actionId.startsWith('image.')) return imageHandler
  return undefined
}
