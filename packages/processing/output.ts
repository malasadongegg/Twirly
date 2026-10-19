import { basename, dirname } from 'node:path'
import { outputFileName, type NamingOptions } from '@core/naming/output-name'
import { commitOutput, commitTempFile, releaseOutput, reserveOutputDir, reserveOutputPath, tempPathFor } from './fs/atomic'
import { sanitizeFileName } from '@core/naming/output-name'

export interface OutputOptions {
  /** Absolute directory for every output; defaults to each source file's folder. */
  outputDir?: string
  naming?: NamingOptions
}

/**
 * Turns "source file + suffix + extension" into a reserved, collision-safe path and writes it
 * atomically. Every processor writes through this, so naming and safety rules live in one place.
 */
export class OutputWriter {
  private readonly written: string[] = []

  constructor(private readonly opts: OutputOptions = {}) {}

  get outputs(): readonly string[] {
    return this.written
  }

  private dirFor(sourcePath: string): string {
    return this.opts.outputDir ?? dirname(sourcePath)
  }

  /** photo.png + "page-2" + "jpg" → reserved "<dir>/photo-page-2.jpg" (or "… (2).jpg"). */
  reserve(sourcePath: string, suffix: string, ext: string): Promise<string> {
    return reserveOutputPath(this.dirFor(sourcePath), outputFileName(basename(sourcePath), suffix, ext, this.opts.naming))
  }

  async write(sourcePath: string, suffix: string, ext: string, data: Uint8Array, signal?: AbortSignal): Promise<string> {
    const path = await this.reserve(sourcePath, suffix, ext)
    try {
      await commitOutput(path, data, signal)
    } catch (err) {
      await releaseOutput(path)
      throw err
    }
    this.written.push(path)
    return path
  }

  /**
   * For external tools (FFmpeg) that write the file themselves: reserves the final name, hands
   * the tool a temp path beside it, then commits or cleans up.
   */
  async produce(sourcePath: string, suffix: string, ext: string, run: (tmpPath: string) => Promise<void>): Promise<string> {
    const path = await this.reserve(sourcePath, suffix, ext)
    // Keep the real extension last: tools like FFmpeg pick the container from it.
    const tmp = tempPathFor(path) + '.' + ext
    try {
      await run(tmp)
      await commitTempFile(tmp, path)
    } catch (err) {
      await releaseOutput(tmp)
      await releaseOutput(path)
      throw err
    }
    this.written.push(path)
    return path
  }

  /** Create a new, collision-safe folder for outputs (e.g. extracted images), tracked for rollback. */
  async reserveDir(sourcePath: string, name: string): Promise<string> {
    const dir = await reserveOutputDir(this.dirFor(sourcePath), sanitizeFileName(name))
    this.written.push(dir)
    return dir
  }

  /** Record an output written by another writer (e.g. the image pipeline). */
  track(path: string): void {
    this.written.push(path)
  }

  /** Remove outputs produced since `mark` (= outputs.length captured earlier). */
  async rollbackTo(mark: number): Promise<void> {
    const removed = this.written.splice(mark)
    await Promise.all(removed.map((p) => releaseOutput(p)))
  }
}

/** "page-07" style suffix, zero-padded to the width of `total`. */
export function pageSuffix(prefix: string, n: number, total: number): string {
  return `${prefix}-${String(n).padStart(String(total).length, '0')}`
}
