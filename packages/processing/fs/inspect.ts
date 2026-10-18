import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { FileInfo, FileRejection, InspectResult } from '@shared/types'
import { detectFormat, extensionMatches, SIGNATURE_BYTES } from '@core/file-types/signatures'
import { splitName } from '@core/naming/output-name'

async function readHead(path: string): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const buf = new Uint8Array(SIGNATURE_BYTES)
    const { bytesRead } = await handle.read(buf, 0, SIGNATURE_BYTES, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

export async function inspectPath(path: string): Promise<FileInfo | FileRejection> {
  try {
    const st = await stat(path)
    if (st.isDirectory()) return { path, reason: 'Folders are not supported yet' }
    if (!st.isFile()) return { path, reason: 'Not a regular file' }
    const name = basename(path)
    const ext = splitName(name).ext.toLowerCase()
    const head = await readHead(path)
    const { format, kind } = detectFormat(head, ext)
    return { path, name, ext, size: st.size, kind, format, extensionMismatch: !extensionMatches(format, ext) }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const reason =
      code === 'ENOENT' ? 'File not found' : code === 'EACCES' || code === 'EPERM' ? 'Permission denied' : code === 'EBUSY' ? 'File is locked' : 'Cannot read file'
    return { path, reason }
  }
}

export async function inspectPaths(paths: string[]): Promise<InspectResult> {
  const results = await Promise.all([...new Set(paths)].map(inspectPath))
  const files: FileInfo[] = []
  const rejected: FileRejection[] = []
  for (const r of results) ('reason' in r ? rejected : files).push(r as never)
  return { files, rejected }
}
