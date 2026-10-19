import sharp, { type OverlayOptions } from 'sharp'
import { backgroundCanvas, type BackgroundParams, type RedactParams } from '@core/actions/image-extras'
import { UserFacingError } from '../errors'
import { cutoutRaw } from './remove-bg'
import { annotationsSvg, type Shape } from '@core/image/annotate'

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)

/**
 * Place the image on a gradient/solid or picture canvas with padding, rounded corners and a soft
 * shadow. With `removeBg` the subject is cut out first, and the shadow follows its outline.
 * Output is always PNG (lossless; the canvas is opaque so no alpha surprises).
 */
export async function renderWithBackground(input: Buffer, p: BackgroundParams, opts: { backgroundImage?: Buffer; signal?: AbortSignal } = {}): Promise<Buffer> {
  let image: Buffer
  let w: number
  let h: number
  if (p.removeBg) {
    const cut = await cutoutRaw(input, opts.signal, p.strokes)
    ;({ width: w, height: h } = cut)
    image = await sharp(cut.data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
  } else {
    const oriented = await sharp(input, { animated: false }).autoOrient().ensureAlpha().png().toBuffer({ resolveWithObject: true })
    ;({ width: w, height: h } = oriented.info)
    image = oriented.data
    // Rounded corners suit a photo card, not a cut-out subject.
    const r = Math.min(p.corners, Math.floor(Math.min(w, h) / 2))
    if (r > 0) {
      const mask = svg(w, h, `<rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/>`)
      image = await sharp(image).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
    }
  }

  const { width: W, height: H } = backgroundCanvas(w, h, p)
  if (W * H > 268_402_689) throw new UserFacingError('The result would be too large. Reduce the padding.')
  const x = Math.round((W - w) / 2)
  const y = Math.round((H - h) / 2)

  let background: Buffer
  if (p.fill === 'image') {
    if (!opts.backgroundImage) throw new UserFacingError('Choose a picture for the background.')
    let bg = sharp(opts.backgroundImage, { animated: false }).autoOrient().resize(W, H, { fit: 'cover', position: 'attention' }).removeAlpha()
    if (p.blur > 0) bg = bg.blur(Math.max(0.3, p.blur / 2))
    background = await bg.png().toBuffer()
  } else {
    // Gradient direction from the angle, as unit-square coordinates for SVG.
    const rad = (p.angle * Math.PI) / 180
    const [x1, y1, x2, y2] = [0.5 - Math.cos(rad) / 2, 0.5 - Math.sin(rad) / 2, 0.5 + Math.cos(rad) / 2, 0.5 + Math.sin(rad) / 2]
    background = svg(
      W,
      H,
      `<defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`,
    )
  }

  const layers: OverlayOptions[] = []
  if (p.shadow > 0) {
    // The shadow is the image's own alpha (a rounded card, or the cut-out outline), darkened and blurred.
    const alpha = await sharp(image).extractChannel(3).raw().toBuffer()
    const shade = Buffer.alloc(w * h * 4)
    for (let i = 0; i < w * h; i++) shade[i * 4 + 3] = Math.round(alpha[i]! * 0.45)
    const offset = Math.min(Math.round(p.shadow / 3), Math.max(0, H - y - h))
    const placed = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: shade, raw: { width: w, height: h, channels: 4 }, left: x, top: y + offset }])
      .png()
      .toBuffer()
    layers.push({ input: await sharp(placed).blur(Math.max(0.3, p.shadow / 2)).png().toBuffer(), left: 0, top: 0 })
  }
  layers.push({ input: image, left: x, top: y })

  return sharp(background).composite(layers).png({ compressionLevel: 9 }).toBuffer()
}

/**
 * Burn solid rectangles into the pixels. The output is re-encoded from the redacted raster and
 * carries **no metadata at all** (EXIF can contain an unredacted thumbnail, GPS, and so on).
 */
export async function renderRedacted(input: Buffer, p: RedactParams, format: 'png' | 'jpeg' | 'webp'): Promise<Buffer> {
  const base = sharp(input, { animated: false }).autoOrient()
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true })
  const color = p.fill === 'black' ? 0 : 255
  for (const r of p.regions) {
    const x0 = Math.max(0, r.left)
    const y0 = Math.max(0, r.top)
    const x1 = Math.min(info.width, r.left + r.width)
    const y1 = Math.min(info.height, r.top + r.height)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * info.width + x) * info.channels
        // Color channels to the fill; alpha (if any) fully opaque so nothing shows through.
        for (let c = 0; c < info.channels; c++) data[i + c] = info.channels === 4 && c === 3 ? 255 : color
      }
    }
  }
  // Built from raw pixels: sharp attaches no EXIF/XMP/ICC from the source.
  const out = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
  if (format === 'jpeg') return out.flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer()
  if (format === 'webp') return out.webp({ lossless: true }).toBuffer()
  return out.png({ compressionLevel: 9 }).toBuffer()
}

/** Burn annotations (rebuilt from validated shapes, never raw SVG) into the oriented image. */
export async function renderAnnotated(input: Buffer, shapes: Shape[], format: 'png' | 'jpeg' | 'webp'): Promise<Buffer> {
  const oriented = await sharp(input, { animated: false }).autoOrient().toBuffer({ resolveWithObject: true })
  const { width, height } = oriented.info
  const overlay = Buffer.from(annotationsSvg(shapes, width, height))
  const img = sharp(oriented.data).composite([{ input: overlay, left: 0, top: 0 }]).keepMetadata()
  if (format === 'jpeg') return img.flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer()
  if (format === 'webp') return img.webp({ quality: 92 }).toBuffer()
  return img.png({ compressionLevel: 9 }).toBuffer()
}
