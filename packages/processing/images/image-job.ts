import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FileInfo } from '@shared/types'
import { planImageJob } from '@core/actions/image-plan'
import { imageOutputExt } from '@core/actions/image-formats'
import { outputFileName, type NamingOptions } from '@core/naming/output-name'
import { commitOutput, releaseOutput, reserveOutputPath } from '../fs/atomic'
import { loadImage, renderImage } from './process'

export interface ImageJobInput {
  actionId: string
  suffix: string
  file: FileInfo
  params: Record<string, unknown>
  /** Output directory; defaults to the source file's folder. */
  outputDir?: string
  naming?: NamingOptions
  signal?: AbortSignal
  /** Called with the final path once the output is committed. */
  onOutput?: (path: string) => void
}

/** Run one image action on one file. Returns the written output path. */
export async function runImageAction(input: ImageJobInput): Promise<string> {
  const { file, signal } = input
  const plan = planImageJob(input.actionId, file, input.params)
  const source = await loadImage(file.path, signal)
  signal?.throwIfAborted()
  // Same format, different extension (e.g. .jfif → .jpg): copy the bytes, no re-compression.
  const lossless = /^image\.convert\./.test(input.actionId) && file.format === plan.format
  const rendered = lossless ? { data: await readFile(file.path, { signal }) } : await renderImage(source, plan.ops, plan.format)
  signal?.throwIfAborted()

  const dir = input.outputDir ?? dirname(file.path)
  const finalPath = await reserveOutputPath(dir, outputFileName(file.name, input.suffix, imageOutputExt(plan.format), input.naming))
  try {
    await commitOutput(finalPath, rendered.data, signal)
  } catch (err) {
    await releaseOutput(finalPath)
    throw err
  }
  input.onOutput?.(finalPath)
  return finalPath
}
