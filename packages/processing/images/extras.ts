import sharp, { type OverlayOptions } from 'sharp'
import { backgroundCanvas, type BackgroundParams, type RedactParams } from '@core/actions/image-extras'
import { UserFacingError } from '../errors'
import { annotationsSvg, type Shape } from '@core/image/annotate'

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)

/**
 * Place the image on a gradient/solid canvas with padding, rounded corners and a soft shadow.
 * Output is always PNG (lossless; the canvas is opaque so no alpha surprises).
 */
export async function renderWithBackground(input: Buffer, p: BackgroundParams): Promise<Buffer> {
  const oriented = await sharp(input, { animated: false }).autoOrient().png().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = oriented.info
  const r = Math.min(p.corners, Math.floor(Math.min(w, h) / 2))

  let image = oriented.data
  if (r > 0) {
    const mask = svg(w, h, `<rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/>`)
    image = await sharp(image).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
  }

  const { width: W, height: H } = backgroundCanvas(w, h, p)
  const x = Math.round((W - w) / 2)
  const y = Math.round((H - h) / 2)

  // Gradient direction from the angle, as unit-square coordinates for SVG.
  const rad = (p.angle * Math.PI) / 180
  const [x1, y1, x2, y2] = [0.5 - Math.cos(rad) / 2, 0.5 - Math.sin(rad) / 2, 0.5 + Math.cos(rad) / 2, 0.5 + Math.sin(rad) / 2]
  const background = svg(
    W,
    H,
    `<defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`,
  )

  const layers: OverlayOptions[] = []
  if (p.shadow > 0) {
    const offset = Math.round(p.shadow / 3)
    const shadowSvg = svg(W, H, `<rect x="${x}" y="${y + offset}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="rgba(0,0,0,0.45)"/>`)
    const shadow = await sharp(shadowSvg).blur(Math.max(0.3, p.shadow / 2)).png().toBuffer()
    layers.push({ input: shadow, left: 0, top: 0 })
  }
  layers.push({ input: image, left: x, top: y })

  if (W * H > 268_402_689) throw new UserFacingError('The result would be too large. Reduce the padding.')
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
