// Downloads a shared-library FFmpeg build into vendor/ffmpeg so the installer can ship it and
// video, audio and HEIC work with nothing else installed. Skips the download when already present.
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import yauzl from 'yauzl'

// GPL build (libx264, libvpx, libopus, libmp3lame, libvorbis). Pinned to the 9.0 release line.
const URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip'

const root = join(import.meta.dirname, '..')
const dest = join(root, 'vendor', 'ffmpeg')
const force = process.argv.includes('--force')

if (!force && existsSync(join(dest, 'ffmpeg.exe')) && existsSync(join(dest, 'ffprobe.exe'))) {
  console.log('FFmpeg already in', dest)
  process.exit(0)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
const zipPath = join(root, 'vendor', 'ffmpeg-download.zip')

console.log('Downloading', URL)
const res = await fetch(URL)
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath))

// Keep only what Twirly runs: ffmpeg, ffprobe, their DLLs, and the licence.
const wanted = (name) => /\/bin\/(ffmpeg\.exe|ffprobe\.exe|[^/]+\.dll)$/i.test(name) || /^[^/]+\/LICENSE\.txt$/i.test(name)

await new Promise((resolve, reject) => {
  yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
    if (err) return reject(err)
    zip.on('error', reject)
    zip.on('end', resolve)
    zip.on('entry', (entry) => {
      if (!wanted(entry.fileName)) return zip.readEntry()
      zip.openReadStream(entry, (e, stream) => {
        if (e) return reject(e)
        pipeline(stream, createWriteStream(join(dest, basename(entry.fileName))))
          .then(() => zip.readEntry())
          .catch(reject)
      })
    })
    zip.readEntry()
  })
})
rmSync(zipPath, { force: true })

if (!existsSync(join(dest, 'ffmpeg.exe')) || !existsSync(join(dest, 'ffprobe.exe'))) throw new Error('ffmpeg.exe/ffprobe.exe missing from the archive')
writeFileSync(
  join(dest, 'README.txt'),
  `FFmpeg (https://ffmpeg.org), licensed under the GNU GPL (see LICENSE.txt).\nBuild: ${URL}\nSource code: https://github.com/FFmpeg/FFmpeg and https://github.com/BtbN/FFmpeg-Builds\n`,
)
console.log('FFmpeg ready in', dest)
