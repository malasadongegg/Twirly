/** Split "photo.final.png" into { base: "photo.final", ext: "png" }. Dotfiles keep their name. */
export function splitName(fileName: string): { base: string; ext: string } {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return { base: fileName, ext: '' }
  return { base: fileName.slice(0, dot), ext: fileName.slice(dot + 1) }
}

export interface NamingOptions {
  separator?: string
}

/** First candidate name: photo.png + converted + webp -> photo-converted.webp */
export function outputFileName(sourceName: string, suffix: string, ext: string, opts: NamingOptions = {}): string {
  const { base } = splitName(sourceName)
  const sep = opts.separator ?? '-'
  return sanitizeFileName(`${base}${suffix ? sep + suffix : ''}${ext ? '.' + ext : ''}`)
}

/** The n-th collision alternative: photo-converted (2).webp */
export function withCounter(fileName: string, n: number): string {
  if (n <= 1) return fileName
  const { base, ext } = splitName(fileName)
  return `${base} (${n})${ext ? '.' + ext : ''}`
}

// Characters Windows forbids in file names, plus ASCII control characters.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"/\\|?*\x00-\x1f]/g

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(FORBIDDEN, '_').replace(/[. ]+$/, '')
  return cleaned.length > 0 ? cleaned : 'output'
}
