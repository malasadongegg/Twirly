import sharp from 'sharp'
import type { InferenceSession } from 'onnxruntime-node'
import { CancelledError, UserFacingError } from '../errors'

/**
 * Background removal with IS-Net (general use), run locally through ONNX Runtime on the CPU.
 * Pre/post-processing follows rembg's IS-Net session: 1024×1024 RGB scaled by the image maximum,
 * minus 0.5; the first output is min-max normalised into an alpha mask.
 */
const SIZE = 1024

let modelPath: string | null = null
let session: Promise<InferenceSession> | null = null
let queue: Promise<unknown> = Promise.resolve()

/** Set by main once it knows where the bundled model lives (null = unavailable). */
export function configureRemoveBgModel(path: string | null): void {
  if (path !== modelPath) session = null
  modelPath = path
}

export const removeBgAvailable = (): boolean => modelPath !== null

function getSession(): Promise<InferenceSession> {
  if (!modelPath) return Promise.reject(new UserFacingError('The background-removal model is missing. Reinstall Twirly.'))
  session ??= import('onnxruntime-node').then((ort) =>
    ort.InferenceSession.create(modelPath!, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' }),
  )
  session.catch(() => (session = null))
  return session
}

/** One inference at a time: each holds a few hundred MB of activations. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new CancelledError()
}

/** Alpha mask (1 channel, width×height) for the oriented image. */
export async function backgroundMask(input: Buffer, signal?: AbortSignal): Promise<{ mask: Buffer; width: number; height: number }> {
  const { data: rgba, info } = await sharp(input, { animated: false }).autoOrient().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  // The model sees RGB; transparent areas are flattened onto white first.
  const rgb = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .flatten({ background: '#ffffff' })
    .resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then((r) => {
      if (r.info.channels !== 3) throw new Error(`expected RGB, got ${r.info.channels} channels`)
      return r.data
    })
  check(signal)

  let max = 1
  for (let i = 0; i < rgb.length; i++) if (rgb[i]! > max) max = rgb[i]!
  const plane = SIZE * SIZE
  const tensor = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    tensor[i] = rgb[i * 3]! / max - 0.5
    tensor[plane + i] = rgb[i * 3 + 1]! / max - 0.5
    tensor[2 * plane + i] = rgb[i * 3 + 2]! / max - 0.5
  }

  const pred = await serialized(async () => {
    check(signal)
    const s = await getSession()
    const ort = await import('onnxruntime-node')
    const out = await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]) })
    return out[s.outputNames[0]!]!.data as Float32Array
  })
  check(signal)

  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < plane; i++) {
    const v = pred[i]!
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const range = hi - lo || 1
  const small = Buffer.alloc(plane)
  for (let i = 0; i < plane; i++) small[i] = Math.round(((pred[i]! - lo) / range) * 255)
  const mask = await sharp(small, { raw: { width: SIZE, height: SIZE, channels: 1 } }).resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).extractChannel(0).raw().toBuffer()
  return { mask, width, height }
}

/** The subject on a transparent background (RGBA raw), keeping any existing transparency. */
export async function cutoutRaw(input: Buffer, signal?: AbortSignal): Promise<{ data: Buffer; width: number; height: number }> {
  const { mask, width, height } = await backgroundMask(input, signal)
  const data = await sharp(input, { animated: false }).autoOrient().ensureAlpha().raw().toBuffer()
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = Math.round((data[i * 4 + 3]! * mask[i]!) / 255)
  return { data, width, height }
}

/** Transparent PNG of the subject. Also reports how much of the image was kept (0..1). */
export async function removeBackground(input: Buffer, signal?: AbortSignal): Promise<{ png: Buffer; kept: number }> {
  const { data, width, height } = await cutoutRaw(input, signal)
  let opaque = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 127) opaque++
  const png = await sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer()
  return { png, kept: opaque / (width * height) }
}
