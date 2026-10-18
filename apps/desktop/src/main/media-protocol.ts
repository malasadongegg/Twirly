import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'

export const MEDIA_SCHEME = 'twirly-media'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
}

/** token → absolute path. Only files a user opened in an editor are ever served. */
const allowed = new Map<string, string>()

/** Must run before app 'ready'. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])
}

export function allowMedia(path: string): string {
  for (const [token, p] of allowed) if (p === path) return `${MEDIA_SCHEME}://file/${token}`
  const token = randomUUID()
  allowed.set(token, path)
  return `${MEDIA_SCHEME}://file/${token}`
}

/** Serve allowed files with HTTP Range support so <video> can seek. Must run after 'ready'. */
export function handleMediaScheme(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const token = new URL(req.url).pathname.replace(/^\//, '')
    const path = allowed.get(token)
    if (!path) return new Response('Not found', { status: 404 })
    const st = await stat(path).catch(() => null)
    if (!st?.isFile()) return new Response('Not found', { status: 404 })

    const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
    if (!range) {
      const body = Readable.toWeb(createReadStream(path)) as ReadableStream
      return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes' } })
    }
    let start = range[1] ? Number(range[1]) : NaN
    let end = range[2] ? Number(range[2]) : st.size - 1
    if (Number.isNaN(start)) {
      // "bytes=-500": the last 500 bytes
      start = Math.max(0, st.size - end)
      end = st.size - 1
    }
    end = Math.min(end, st.size - 1)
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } })
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes' },
    })
  })
}
