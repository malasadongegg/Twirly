import { randomBytes } from 'node:crypto'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { withCounter } from '@core/naming/output-name'

/**
 * Atomically claim a free output name in `dir`. An empty placeholder is created with O_EXCL,
 * so two concurrent jobs can never pick the same name, and an existing file is never touched.
 * Returns the claimed path; fill it with `commitOutput` or release it with `releaseOutput`.
 */
export async function reserveOutputPath(dir: string, fileName: string, maxAttempts = 9999): Promise<string> {
  for (let n = 1; n <= maxAttempts; n++) {
    const candidate = join(dir, withCounter(fileName, n))
    try {
      const handle = await open(candidate, 'wx')
      await handle.close()
      return candidate
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
  }
  throw new Error(`No free output name for ${fileName} after ${maxAttempts} attempts`)
}

/** Create a new, collision-safe folder in `dir` (mkdir without recursion fails if it exists). */
export async function reserveOutputDir(dir: string, name: string, maxAttempts = 9999): Promise<string> {
  for (let n = 1; n <= maxAttempts; n++) {
    const candidate = join(dir, n === 1 ? name : `${name} (${n})`)
    try {
      await mkdir(candidate)
      return candidate
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
  }
  throw new Error(`No free folder name for ${name}`)
}

/** Unique temp path next to `finalPath`, so the final rename never crosses volumes. */
export function tempPathFor(finalPath: string): string {
  return join(dirname(finalPath), `.${basename(finalPath)}.${randomBytes(4).toString('hex')}.twirly-tmp`)
}

/**
 * Write `data` to a temp file beside the reserved `finalPath`, then rename it over the
 * placeholder. Readers never observe a half-written output. On any failure the temp file is
 * removed and the error rethrown (the caller decides whether to release the reservation).
 */
export async function commitOutput(finalPath: string, data: Uint8Array, signal?: AbortSignal): Promise<void> {
  const tmp = tempPathFor(finalPath)
  try {
    await writeFile(tmp, data, { signal })
    signal?.throwIfAborted()
    await rename(tmp, finalPath)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

/** Move an already-written temp file (e.g. produced by FFmpeg) over the reservation. */
export async function commitTempFile(tmpPath: string, finalPath: string): Promise<void> {
  try {
    await rename(tmpPath, finalPath)
  } catch (err) {
    await rm(tmpPath, { force: true })
    throw err
  }
}

/** Remove a reserved placeholder (or partial output) after failure or cancellation. */
export async function releaseOutput(path: string): Promise<void> {
  // Recursive because some outputs are folders (extracted archives, image folders); these
  // paths are always ones Twirly reserved itself.
  await rm(path, { force: true, recursive: true })
}
