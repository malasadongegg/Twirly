import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
import { docxToMarkdown, type DocxMarkdown, type DocxParts } from '@core/markdown/docx-markdown'
import { sanitizeFileName, splitName } from '@core/naming/output-name'
import { readZipEntries } from '../archive/zip'
import { UserFacingError } from '../errors'

const PARTS: Record<keyof DocxParts, string> = {
  document: 'word/document.xml',
  styles: 'word/styles.xml',
  numbering: 'word/numbering.xml',
  rels: 'word/_rels/document.xml.rels',
  footnotes: 'word/footnotes.xml',
  endnotes: 'word/endnotes.xml',
}

/** "media/image1.png" (relative to word/) → its path inside the .docx, or null if it points outside. */
function mediaEntry(target: string): string | null {
  const p = posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join('word', target))
  return p.startsWith('..') ? null : p
}

export interface DocxConversion extends DocxMarkdown {
  /** Copy the linked images into `dir` (created if missing). Names match the Markdown links. */
  writeImages(dir: string, signal?: AbortSignal): Promise<number>
}

/**
 * A .docx as Markdown. Images are linked as "<imagesDirName>/<file>"; pass no name to leave them
 * out. Call writeImages with the real folder afterwards.
 */
export async function convertDocx(
  path: string,
  imagesDirName: string | null,
  signal?: AbortSignal,
): Promise<DocxConversion> {
  const entries = await readZipEntries(path, Object.values(PARTS), signal).catch((err) => {
    if (err instanceof UserFacingError) throw err
    throw new UserFacingError('This Word file is damaged or not a .docx.', String(err))
  })
  const doc = entries.get(PARTS.document)
  if (!doc) throw new UserFacingError('This Word file has no document body (it may be damaged).')
  const parts = Object.fromEntries(
    Object.entries(PARTS).flatMap(([k, name]) =>
      entries.has(name) ? [[k, entries.get(name)!.toString('utf8')]] : [],
    ),
  ) as unknown as DocxParts

  // Images keep their names from the .docx; duplicates (rare: media in different folders) get a number.
  const names = new Map<string, string>()
  const used = new Set<string>()
  const fileName = (target: string) => {
    let name = names.get(target)
    if (!name) {
      const { base, ext } = splitName(sanitizeFileName(basename(target)))
      const dot = ext ? `.${ext}` : ''
      name = `${base}${dot}`
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})${dot}`
      used.add(name.toLowerCase())
      names.set(target, name)
    }
    return name
  }
  const result = docxToMarkdown(parts, {
    imageLink: imagesDirName
      ? (target) => (mediaEntry(target) ? `${imagesDirName}/${fileName(target)}` : null)
      : undefined,
  })

  return {
    ...result,
    async writeImages(dir, sig) {
      const wanted = result.images.map((t) => [t, mediaEntry(t)!] as const)
      const data = await readZipEntries(
        path,
        wanted.map(([, e]) => e),
        sig,
      )
      await mkdir(dir, { recursive: true })
      let written = 0
      for (const [target, entry] of wanted) {
        const bytes = data.get(entry)
        if (!bytes) continue
        await writeFile(join(dir, fileName(target)), bytes, { flag: 'wx', signal: sig })
        written++
      }
      return written
    },
  }
}
