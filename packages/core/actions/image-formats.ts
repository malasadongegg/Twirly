/** Image output formats Twirly offers. `sharpId` is sharp's format key. */
export const IMAGE_OUTPUTS = [
  { id: 'png', label: 'PNG', ext: 'png', sharpId: 'png' },
  { id: 'jpeg', label: 'JPG', ext: 'jpg', sharpId: 'jpeg' },
  { id: 'webp', label: 'WEBP', ext: 'webp', sharpId: 'webp' },
  { id: 'avif', label: 'AVIF', ext: 'avif', sharpId: 'heif' },
  { id: 'tiff', label: 'TIFF', ext: 'tiff', sharpId: 'tiff' },
  { id: 'bmp', label: 'BMP', ext: 'bmp', sharpId: 'raw' },
] as const

export type ImageOutputFormat = (typeof IMAGE_OUTPUTS)[number]['id']

export const IMAGE_OUTPUT_IDS = IMAGE_OUTPUTS.map((f) => f.id) as ImageOutputFormat[]

export const imageOutputExt = (format: ImageOutputFormat): string =>
  IMAGE_OUTPUTS.find((f) => f.id === format)?.ext ?? format

/** Map a detected input format to the same output format when we can encode it, else PNG. */
export function sameOrPng(format: string): ImageOutputFormat {
  return (IMAGE_OUTPUT_IDS as string[]).includes(format) ? (format as ImageOutputFormat) : 'png'
}
