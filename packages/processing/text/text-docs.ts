import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib'
import { buildDocx } from '@core/docx/docx'
import type { Paragraph } from '@core/pdf/paragraphs'

/** Decode text as UTF-8 (BOM stripped), falling back to Windows-1252 for legacy files. */
export async function readText(path: string, signal?: AbortSignal): Promise<string> {
  const buf = await readFile(path, { signal })
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

const MONO_FORMATS = ['json', 'csv', 'log', 'xml', 'yml', 'yaml', 'ini']

export interface TextLine {
  text: string
  /** 0 body, 1–3 Markdown heading level, 'bullet' list item. */
  style: 0 | 1 | 2 | 3 | 'bullet'
}

/** Light Markdown awareness for .md (headings, bullets); everything else stays literal. */
export function parseLines(text: string, markdown: boolean): TextLine[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n')
    .map((raw): TextLine => {
      if (!markdown) return { text: raw, style: 0 }
      const h = /^(#{1,3})\s+(.*)$/.exec(raw)
      if (h) return { text: h[2]!.replace(/[*_`]/g, ''), style: h[1]!.length as 1 | 2 | 3 }
      const b = /^\s*[-*+]\s+(.*)$/.exec(raw)
      if (b) return { text: `• ${b[1]!.replace(/\*\*|__|`/g, '')}`, style: 'bullet' }
      return { text: raw.replace(/\*\*|__|`/g, ''), style: 0 }
    })
}

const FONT_DIR = 'C:\\Windows\\Fonts\\'
async function loadFont(doc: PDFDocument, files: string[], fallback: StandardFonts): Promise<{ font: PDFFont; unicode: boolean }> {
  for (const f of files) {
    if (existsSync(FONT_DIR + f)) return { font: await doc.embedFont(await readFile(FONT_DIR + f), { subset: true }), unicode: true }
  }
  return { font: await doc.embedFont(fallback), unicode: false }
}

/** Wrap one line to `maxWidth`, breaking long words if they don't fit at all. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return ['']
  const out: string[] = []
  let line = ''
  for (const word of text.split(/(\s+)/)) {
    const next = line + word
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      line = next
      continue
    }
    if (line.trim()) out.push(line.trimEnd())
    line = word.trimStart()
    while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
      let cut = line.length - 1
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut--
      out.push(line.slice(0, cut))
      line = line.slice(cut)
    }
  }
  out.push(line.trimEnd())
  return out
}

/** A4 PDF of a text file: Segoe UI (Consolas for data formats), wrapped, paginated. */
export async function textToPdf(text: string, format: string, title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(title)
  doc.setCreator('Twirly')
  const mono = MONO_FORMATS.includes(format)
  const body = mono ? await loadFont(doc, ['consola.ttf', 'cour.ttf'], StandardFonts.Courier) : await loadFont(doc, ['segoeui.ttf', 'arial.ttf'], StandardFonts.Helvetica)
  const bold = mono ? body : await loadFont(doc, ['segoeuib.ttf', 'arialbd.ttf'], StandardFonts.HelveticaBold)
  // Standard PDF fonts only cover Windows-1252; keep the rest readable instead of crashing.
  // eslint-disable-next-line no-control-regex
  const safe = (s: string, unicode: boolean) => (unicode ? s : s.replace(/[^\x00-\xFF\u20AC\u2022]/g, '?'))

  const [W, H, M] = [595.28, 841.89, 56]
  const sizes = { 0: mono ? 9.5 : 11, bullet: mono ? 9.5 : 11, 1: 20, 2: 16, 3: 13 } as const
  let page = doc.addPage([W, H])
  let y = H - M
  for (const line of parseLines(text, format === 'md')) {
    const size = sizes[line.style]
    const font = line.style === 0 || line.style === 'bullet' ? body : bold
    const lead = size * 1.45
    const gapBefore = typeof line.style === 'number' && line.style > 0 ? size * 0.6 : 0
    const parts = wrap(safe(line.text, font.unicode), font.font, size, W - 2 * M - (line.style === 'bullet' ? 12 : 0))
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      if (y - gapBefore - lead < M) {
        page = doc.addPage([W, H])
        y = H - M
      }
      y -= lead + (i === 0 ? gapBefore : 0)
      page.drawText(part, { x: M + (line.style === 'bullet' ? 12 : 0), y, size, font: font.font })
    }
  }
  return doc.save({ useObjectStreams: true })
}

/** Word document of a text file: one paragraph per line, Markdown headings become Heading styles. */
export function textToDocx(text: string, format: string, title: string): Uint8Array {
  const paragraphs: Paragraph[] = parseLines(text, format === 'md')
    .filter((l) => l.text.trim() !== '')
    .map((l) => ({ text: l.text, heading: l.style === 1 ? 1 : l.style === 2 || l.style === 3 ? 2 : 0 }))
  return buildDocx([{ width: 595.28, height: 841.89, paragraphs: paragraphs.length ? paragraphs : [{ text: ' ', heading: 0 }] }], title)
}
