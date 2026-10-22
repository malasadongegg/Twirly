import type { Paragraph } from '../pdf/paragraphs'

/**
 * Markdown output for text that was never written as Markdown (Word runs, PDF text): every
 * character that could change how it renders is escaped, so the result reads as the source did.
 */
export function escapeInline(s: string): string {
  // "<" only matters before something that could be an HTML tag or autolink ("< 1 yr" is fine).
  return s.replace(/[\\`*_[\]>|~]|<(?=[A-Za-z/!?])/g, (c) => `\\${c}`)
}

/** Escape what would turn the start of a block into a heading, list, quote or rule. */
export function escapeBlockStart(s: string): string {
  return s.replace(/^(\s*)([#>+=-])/, '$1\\$2').replace(/^(\s*\d+)([.)])(\s|$)/, '$1\\$2$3')
}

const BULLET = /^[•◦▪▫●○■□‣⁃–—-]\s+/
const NUMBERED = /^(\d{1,3})[.)]\s+/

/** One converted paragraph as a Markdown block. Bullet glyphs and "1." become real list items. */
function paragraphBlock(p: Paragraph): { md: string; list: boolean } {
  const text = p.text.trim()
  if (p.heading) return { md: `${p.heading === 1 ? '#' : '##'} ${escapeInline(text)}`, list: false }
  const b = BULLET.exec(text)
  if (b) return { md: `- ${escapeBlockStart(escapeInline(text.slice(b[0].length)))}`, list: true }
  const n = NUMBERED.exec(text)
  if (n) return { md: `${n[1]}. ${escapeBlockStart(escapeInline(text.slice(n[0].length)))}`, list: true }
  return { md: escapeBlockStart(escapeInline(text)), list: false }
}

/** Join blocks with a blank line, except between consecutive list items (a tight list). */
export function joinBlocks(blocks: { md: string; list: boolean }[]): string {
  let out = ''
  blocks.forEach((b, i) => {
    if (i > 0) out += b.list && blocks[i - 1]!.list ? '\n' : '\n\n'
    out += b.md
  })
  return out ? `${out}\n` : ''
}

/** PDF paragraphs (from pdf/paragraphs) as Markdown, pages flowing into each other. */
export function paragraphsToMarkdown(pages: Paragraph[][]): string {
  return joinBlocks(
    pages
      .flat()
      .filter((p) => p.text.trim() !== '')
      .map(paragraphBlock),
  )
}

/**
 * Plain text as Markdown that renders like the text file looked: line breaks inside a paragraph
 * are kept (two trailing spaces), bullet glyphs become list items, raw HTML-looking text is
 * neutralised. Asterisks and underscores are left alone; in a .txt they are usually meant as
 * emphasis.
 */
export function textToMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.replace(/\s+$/, '')
    if (line === '') {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    line = line.replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\').replace(/<(?=[A-Za-z/!?])/g, '&lt;')
    const b = /^(\s*)[•◦▪●○■‣⁃]\s+/.exec(line)
    if (b) line = `${b[1]}- ${line.slice(b[0].length)}`
    const next = lines[i + 1]?.trim() ?? ''
    // Keep the text file's own line breaks, but not after the last line of a paragraph.
    out.push(next !== '' ? `${line}  ` : line)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.length ? `${out.join('\n')}\n` : ''
}

/** Split CSV text into rows, honouring quotes. The delimiter is detected from the first line. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = [',', ';', '\t', '|']
    .map((d) => [d, firstLine.split(d).length] as const)
    .sort((a, b) => b[1] - a[1])[0]![0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === delim) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const tableCell = (s: string) => escapeInline(s.trim()).replace(/\r?\n/g, '<br>')

/** A Markdown table; the first row is the header. Short rows are padded. */
export function tableToMarkdown(rows: string[][], cell: (s: string) => string = tableCell): string {
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? '')).join(' | ')} |`
  return [line(rows[0]!), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n')
}

export function csvToMarkdown(text: string): string {
  const table = tableToMarkdown(parseCsv(text))
  return table ? `${table}\n` : ''
}

/** Data files (JSON, XML, YAML…) are kept verbatim in a fenced code block. */
export function codeToMarkdown(text: string, language: string): string {
  const body = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  // The fence must be longer than any backtick run inside the text.
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language}\n${body}\n${fence}\n`
}

const FENCED: Record<string, string> = {
  json: 'json',
  xml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  ini: 'ini',
  log: 'text',
}

/** A text-kind file as Markdown, by its detected format. */
export function textFileToMarkdown(text: string, format: string): string {
  if (format === 'csv') return csvToMarkdown(text)
  if (FENCED[format]) return codeToMarkdown(text, FENCED[format]!)
  return textToMarkdown(text)
}

export interface TextStats {
  words: number
  characters: number
  charactersNoSpaces: number
  lines: number
  paragraphs: number
  /** Minutes at 230 words a minute, at least 1 when there is any text. */
  readingMinutes: number
}

export function textStats(text: string): TextStats {
  const norm = text.replace(/\r\n?/g, '\n')
  const words = norm.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-_.@]*/gu)?.length ?? 0
  const chars = [...norm.replace(/\n/g, '')]
  return {
    words,
    characters: chars.length,
    charactersNoSpaces: chars.filter((c) => !/\s/.test(c)).length,
    lines: norm.trim() === '' ? 0 : norm.replace(/\n+$/, '').split('\n').length,
    paragraphs: norm.split(/\n\s*\n/).filter((p) => p.trim() !== '').length,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / 230)),
  }
}

/** "1,234 words · 7,890 characters · 6 min read" */
export function describeStats(s: TextStats): string {
  const n = (x: number) => x.toLocaleString('en-US')
  return `${n(s.words)} word${s.words === 1 ? '' : 's'} · ${n(s.characters)} characters · ${s.readingMinutes} min read`
}
