const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** Human file size, base 1024, one decimal above KB: 1.2 MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${UNITS[unit]}`
}
