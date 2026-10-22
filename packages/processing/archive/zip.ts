import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, opendir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { sanitizeFileName, splitName } from '@core/naming/output-name'
import { reserveOutputDir } from '../fs/atomic'
import { CancelledError, UserFacingError } from '../errors'

/** Formats that are already compressed: storing them is as small and much faster. */
const STORE = /\.(jpe?g|png|webp|avif|heic|gif|mp4|mov|mkv|webm|mp3|m4a|aac|ogg|flac|zip|7z|rar|gz|bz2|xz|pdf|docx|xlsx|pptx)$/i

export interface ZipLimits {
  /** Refuse archives whose declared total uncompressed size exceeds this. */
  maxTotalBytes: number
  maxEntries: number
  /** Refuse archives that claim to expand more than this ratio (zip bombs), above 100 MB. */
  maxRatio: number
}

export const DEFAULT_LIMITS: ZipLimits = { maxTotalBytes: 20 * 1024 ** 3, maxEntries: 100_000, maxRatio: 200 }

async function* walk(dir: string, prefix: string): AsyncGenerator<{ path: string; name: string; isDir: boolean }> {
  let empty = true
  for await (const entry of await opendir(dir)) {
    empty = false
    const full = join(dir, entry.name)
    const name = `${prefix}/${entry.name}`
    // Never follow symlinks or junctions: they can point anywhere (even back up the tree).
    const st = await lstat(full)
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) yield* walk(full, name)
    else if (st.isFile()) yield { path: full, name, isDir: false }
  }
  if (empty) yield { path: dir, name: prefix, isDir: true }
}

/** Zip files and folders (recursively) into `outPath`. Names inside are made unique. */
export async function zipPaths(sources: string[], outPath: string, signal?: AbortSignal, onEntry?: (n: number) => void): Promise<void> {
  const zip = new yazl.ZipFile()
  const out = createWriteStream(outPath)
  const done = pipeline(zip.outputStream, out)
  const used = new Set<string>()
  const unique = (name: string) => {
    let n = 1
    let candidate = name
    while (used.has(candidate.toLowerCase())) candidate = `${splitName(name).base} (${++n})${splitName(name).ext ? '.' + splitName(name).ext : ''}`
    used.add(candidate.toLowerCase())
    return candidate
  }
  let count = 0
  try {
    for (const src of sources) {
      signal?.throwIfAborted()
      const st = await lstat(src)
      if (st.isDirectory()) {
        const root = unique(basename(src))
        for await (const e of walk(src, root)) {
          signal?.throwIfAborted()
          if (e.isDir) zip.addEmptyDirectory(e.name)
          else zip.addReadStream(createReadStream(e.path), e.name, { compress: !STORE.test(e.name) })
          onEntry?.(++count)
        }
      } else if (st.isFile()) {
        const name = unique(basename(src))
        zip.addReadStream(createReadStream(src), name, { compress: !STORE.test(name) })
        onEntry?.(++count)
      }
    }
    zip.end()
    await done
  } catch (err) {
    ;(zip.outputStream as unknown as { destroy(): void }).destroy()
    out.destroy()
    throw err
  }
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolveP, reject) =>
    // decodeStrings + validation: yauzl rejects absolute paths and ".." segments itself.
    yauzl.open(path, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, autoClose: true }, (err, zf) => (err ? reject(err) : resolveP(zf))),
  )
}

/** Read every entry header (no data) to check the archive before extracting anything. */
async function listEntries(path: string): Promise<yauzl.Entry[]> {
  const zf = await openZip(path)
  return new Promise((resolveP, reject) => {
    const entries: yauzl.Entry[] = []
    zf.on('entry', (e: yauzl.Entry) => {
      entries.push(e)
      zf.readEntry()
    })
    zf.on('end', () => resolveP(entries))
    zf.on('error', reject)
    zf.readEntry()
  })
}

const isSymlinkEntry = (e: yauzl.Entry) => ((e.externalFileAttributes >>> 16) & 0o170000) === 0o120000
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** Make each path segment a legal Windows name. */
function safeRelative(name: string): string {
  return name
    .split('/')
    .filter((s) => s && s !== '.')
    .map((s) => {
      const clean = sanitizeFileName(s)
      return WINDOWS_RESERVED.test(clean) ? `_${clean}` : clean
    })
    .join(sep)
}

export interface ExtractResult {
  folder: string
  files: number
}

/**
 * Extract a ZIP next to itself into a new, collision-safe folder. If the archive holds exactly
 * one top-level folder, that folder is recreated (instead of nesting it inside another).
 */
export async function extractZip(zipPath: string, signal?: AbortSignal, limits: ZipLimits = DEFAULT_LIMITS, onFile?: (n: number, total: number) => void): Promise<ExtractResult> {
  let entries: yauzl.Entry[]
  try {
    entries = await listEntries(zipPath)
  } catch (err) {
    const msg = (err as Error).message
    if (/invalid relative path|absolute path/i.test(msg)) throw new UserFacingError('This ZIP contains unsafe file paths and was not extracted.', msg)
    throw new UserFacingError('The ZIP file is damaged or not a ZIP.', msg)
  }
  if (entries.length > limits.maxEntries) throw new UserFacingError(`This ZIP has too many files (${entries.length}).`)
  if (entries.some((e) => e.generalPurposeBitFlag & 1)) throw new UserFacingError('Password-protected ZIPs are not supported yet.')
  const total = entries.reduce((s, e) => s + e.uncompressedSize, 0)
  const packed = entries.reduce((s, e) => s + e.compressedSize, 0) || 1
  if (total > limits.maxTotalBytes || (total > 100 * 1024 ** 2 && total / packed > limits.maxRatio))
    throw new UserFacingError('This ZIP expands to an unsafe size (possible zip bomb) and was not extracted.')

  const files = entries.filter((e) => !e.fileName.endsWith('/') && !isSymlinkEntry(e))
  const tops = new Set(entries.map((e) => e.fileName.split('/')[0]))
  const singleRoot = tops.size === 1 && entries.every((e) => e.fileName.includes('/'))
  const rootName = singleRoot ? [...tops][0]! : splitName(basename(zipPath)).base
  const dest = await reserveOutputDir(dirname(zipPath), sanitizeFileName(rootName))
  const strip = singleRoot ? rootName.length + 1 : 0

  try {
    const zf = await openZip(zipPath)
    let written = 0
    await new Promise<void>((resolveP, reject) => {
      const fail = (err: unknown) => {
        zf.close()
        reject(err)
      }
      zf.on('error', fail)
      zf.on('end', () => resolveP())
      zf.on('entry', async (e: yauzl.Entry) => {
        try {
          if (signal?.aborted) return fail(new CancelledError())
          const rel = safeRelative(e.fileName.slice(strip))
          if (!rel || isSymlinkEntry(e)) return zf.readEntry()
          const target = resolve(dest, rel)
          // Defence in depth: never write outside the destination folder.
          if (target !== dest && !target.startsWith(dest + sep)) return fail(new UserFacingError('This ZIP contains unsafe file paths.'))
          if (e.fileName.endsWith('/')) {
            await mkdir(target, { recursive: true })
            return zf.readEntry()
          }
          await mkdir(dirname(target), { recursive: true })
          const stream = await new Promise<NodeJS.ReadableStream>((res, rej) => zf.openReadStream(e, (err, s) => (err ? rej(err) : res(s!))))
          // 'wx': an entry can't overwrite a file another entry already wrote.
          await pipeline(stream, createWriteStream(target, { flags: 'wx' }), { signal })
          written++ // not inside the optional call: its arguments are skipped when onFile is absent
          onFile?.(written, files.length)
          zf.readEntry()
        } catch (err) {
          fail(err)
        }
      })
      zf.readEntry()
    })
    return { folder: dest, files: written }
  } catch (err) {
    await rm(dest, { recursive: true, force: true })
    if (signal?.aborted) throw new CancelledError()
    throw err
  }
}

/** Entries of a ZIP-based Office/ODF document's embedded media, extracted into `dest`. */
export async function extractMatching(zipPath: string, match: (name: string) => boolean, dest: string, signal?: AbortSignal): Promise<string[]> {
  const zf = await openZip(zipPath)
  const out: string[] = []
  const used = new Set<string>()
  await new Promise<void>((resolveP, reject) => {
    zf.on('error', reject)
    zf.on('end', () => resolveP())
    zf.on('entry', async (e: yauzl.Entry) => {
      try {
        signal?.throwIfAborted()
        if (e.fileName.endsWith('/') || !match(e.fileName)) return zf.readEntry()
        let name = sanitizeFileName(basename(e.fileName))
        for (let n = 2; used.has(name.toLowerCase()); n++) name = `${splitName(basename(e.fileName)).base} (${n}).${splitName(basename(e.fileName)).ext}`
        used.add(name.toLowerCase())
        const target = join(dest, name)
        const stream = await new Promise<NodeJS.ReadableStream>((res, rej) => zf.openReadStream(e, (err, s) => (err ? rej(err) : res(s!))))
        await pipeline(stream, createWriteStream(target, { flags: 'wx' }), { signal })
        out.push(target)
        zf.readEntry()
      } catch (err) {
        zf.close()
        reject(err)
      }
    })
    zf.readEntry()
  })
  return out
}

/**
 * Read the named entries of a ZIP into memory (Office XML parts). Entries larger than `maxBytes`
 * uncompressed are refused rather than read, so a crafted document can't exhaust memory.
 */
export async function readZipEntries(zipPath: string, names: string[], signal?: AbortSignal, maxBytes = 200 * 1024 ** 2): Promise<Map<string, Buffer>> {
  const wanted = new Set(names)
  const out = new Map<string, Buffer>()
  const zf = await openZip(zipPath)
  await new Promise<void>((resolveP, reject) => {
    zf.on('error', reject)
    zf.on('end', () => resolveP())
    zf.on('entry', async (e: yauzl.Entry) => {
      try {
        signal?.throwIfAborted()
        if (!wanted.has(e.fileName)) return zf.readEntry()
        if (e.uncompressedSize > maxBytes) throw new UserFacingError(`${e.fileName} inside this file is too large to read.`)
        const stream = await new Promise<NodeJS.ReadableStream>((res, rej) => zf.openReadStream(e, (err, s) => (err ? rej(err) : res(s!))))
        const chunks: Buffer[] = []
        for await (const chunk of stream) chunks.push(chunk as Buffer)
        out.set(e.fileName, Buffer.concat(chunks))
        zf.readEntry()
      } catch (err) {
        zf.close()
        reject(err)
      }
    })
    zf.readEntry()
  })
  return out
}
