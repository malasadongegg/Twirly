// Downloads the background-removal model into vendor/models so the installer can ship it.
// IS-Net general-use (DIS, Apache-2.0), as packaged by rembg. Skips when already present.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const MODEL = {
  file: 'isnet-general-use.onnx',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
  sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
}

const dest = join(import.meta.dirname, '..', 'vendor', 'models')
const target = join(dest, MODEL.file)

const sha256 = (path) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })

if (existsSync(target) && (await sha256(target)) === MODEL.sha256) {
  console.log('Model already in', dest)
  process.exit(0)
}

mkdirSync(dest, { recursive: true })
const tmp = `${target}.download`
console.log('Downloading', MODEL.url)
const res = await fetch(MODEL.url)
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
const got = await sha256(tmp)
if (got !== MODEL.sha256) {
  rmSync(tmp, { force: true })
  throw new Error(`Checksum mismatch for ${MODEL.file}: ${got}`)
}
renameSync(tmp, target)
writeFileSync(
  join(dest, 'README.txt'),
  'isnet-general-use.onnx: IS-Net (Highly Accurate Dichotomous Image Segmentation, https://github.com/xuebinqin/DIS),\nApache License 2.0. ONNX export from rembg (https://github.com/danielgatis/rembg, MIT).\n',
)
console.log('Model ready in', dest)
