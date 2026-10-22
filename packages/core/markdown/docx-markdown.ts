import { child, find, findAll, isElement, kids, parseXml, type XmlElement } from '../xml/parse'
import { codeToMarkdown, escapeBlockStart, escapeInline, joinBlocks, tableToMarkdown } from './markdown'

/** The XML parts of a .docx that matter for its text. Only `document` is required. */
export interface DocxParts {
  document: string
  styles?: string
  numbering?: string
  /** word/_rels/document.xml.rels: hyperlink targets and image files. */
  rels?: string
  footnotes?: string
  endnotes?: string
}

export interface DocxMarkdownOptions {
  /** Link for an embedded image ("media/image1.png" → "report-images/image1.png"), or null to leave it out. */
  imageLink?: (target: string) => string | null
}

export interface DocxMarkdown {
  markdown: string
  /** Plain text, one paragraph per line (for word counts). */
  text: string
  /** Image targets the Markdown links to, relative to word/ ("media/image1.png"). */
  images: string[]
}

interface Segment {
  text: string
  b: boolean
  i: boolean
  s: boolean
  code: boolean
  href?: string
  /** Pre-built Markdown (images, footnote marks): emitted as is. */
  raw?: boolean
  br?: boolean
}

interface Block {
  md: string
  list: boolean
  /** A paragraph set entirely in a monospace font: neighbours join into one fenced block. */
  code?: string
}

interface StyleInfo {
  name: string
  basedOn?: string
  outline?: number
  numId?: string
  ilvl?: number
  bold?: boolean
  italic?: boolean
  mono?: boolean
}

const W_VAL = 'w:val'
const on = (el: XmlElement | undefined) => !!el && !['0', 'false', 'off'].includes(el.attrs[W_VAL] ?? 'true')
const MONO_FONT = /consolas|courier|mono|menlo|lucida console|source code/i

function parseStyles(xml: string | undefined): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>()
  if (!xml) return map
  for (const st of findAll(parseXml(xml), 'w:style')) {
    const id = st.attrs['w:styleId']
    if (!id) continue
    const pPr = child(st, 'w:pPr')
    const rPr = child(st, 'w:rPr')
    const numPr = child(pPr, 'w:numPr')
    const outline = child(pPr, 'w:outlineLvl')?.attrs[W_VAL]
    map.set(id, {
      name: child(st, 'w:name')?.attrs[W_VAL] ?? id,
      basedOn: child(st, 'w:basedOn')?.attrs[W_VAL],
      outline: outline !== undefined ? Number(outline) : undefined,
      numId: child(numPr, 'w:numId')?.attrs[W_VAL],
      ilvl: child(numPr, 'w:ilvl') ? Number(child(numPr, 'w:ilvl')!.attrs[W_VAL]) : undefined,
      bold: child(rPr, 'w:b') ? on(child(rPr, 'w:b')) : undefined,
      italic: child(rPr, 'w:i') ? on(child(rPr, 'w:i')) : undefined,
      mono: MONO_FONT.test(child(rPr, 'w:rFonts')?.attrs['w:ascii'] ?? '') || undefined,
    })
  }
  return map
}

/** numId → level → is it a bullet list? */
function parseNumbering(xml: string | undefined): (numId: string, ilvl: number) => boolean {
  if (!xml) return () => true
  const root = parseXml(xml)
  const abstract = new Map<string, Map<number, string>>()
  for (const a of findAll(root, 'w:abstractNum')) {
    const lvls = new Map<number, string>()
    for (const l of kids(a, 'w:lvl'))
      lvls.set(Number(l.attrs['w:ilvl'] ?? 0), child(l, 'w:numFmt')?.attrs[W_VAL] ?? 'bullet')
    abstract.set(a.attrs['w:abstractNumId'] ?? '', lvls)
  }
  const nums = new Map<string, string>()
  for (const n of findAll(root, 'w:num'))
    nums.set(n.attrs['w:numId'] ?? '', child(n, 'w:abstractNumId')?.attrs[W_VAL] ?? '')
  return (numId, ilvl) => {
    const fmt = abstract.get(nums.get(numId) ?? '')?.get(ilvl)
    return fmt === undefined || fmt === 'bullet' || fmt === 'none'
  }
}

function parseRels(xml: string | undefined): Map<string, { target: string; external: boolean }> {
  const map = new Map<string, { target: string; external: boolean }>()
  if (!xml) return map
  for (const r of findAll(parseXml(xml), 'Relationship')) {
    if (r.attrs.Id && r.attrs.Target)
      map.set(r.attrs.Id, { target: r.attrs.Target, external: r.attrs.TargetMode === 'External' })
  }
  return map
}

const linkUrl = (url: string) => url.replace(/[ ()<>]/g, (c) => encodeURIComponent(c))

/** Wrap text in emphasis markers, keeping surrounding spaces outside them ("** a**" never renders). */
function emphasize(text: string, marks: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!
  return m[2] ? `${m[1]}${marks}${m[2]}${[...marks].reverse().join('')}${m[3]}` : text
}

function inlineCode(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

function renderSegments(segs: Segment[], breakMd: string): string {
  let out = ''
  let i = 0
  while (i < segs.length) {
    const s = segs[i]!
    if (s.br) {
      out += breakMd
      i++
      continue
    }
    if (s.raw) {
      out += s.text
      i++
      continue
    }
    // A run of segments sharing link and formatting is written as one piece.
    let j = i
    let text = ''
    while (
      j < segs.length &&
      !segs[j]!.br &&
      !segs[j]!.raw &&
      segs[j]!.href === s.href &&
      segs[j]!.b === s.b &&
      segs[j]!.i === s.i &&
      segs[j]!.s === s.s &&
      segs[j]!.code === s.code
    )
      text += segs[j++]!.text
    // Links group across formatting changes.
    if (s.href !== undefined) {
      let k = j
      const inner: Segment[] = segs.slice(i, j).map((x) => ({ ...x, href: undefined }))
      while (k < segs.length && !segs[k]!.br && segs[k]!.href === s.href)
        inner.push({ ...segs[k++]!, href: undefined })
      const label = renderSegments(inner, ' ').trim()
      out += label ? `[${label}](${linkUrl(s.href)})` : ''
      i = k
      continue
    }
    if (s.code && text.trim()) out += inlineCode(text)
    else {
      const marks = (s.b ? '**' : '') + (s.i ? '*' : '') + (s.s ? '~~' : '')
      out += marks ? emphasize(escapeInline(text), marks) : escapeInline(text)
    }
    i = j
  }
  return out
}

export function docxToMarkdown(parts: DocxParts, opts: DocxMarkdownOptions = {}): DocxMarkdown {
  const styles = parseStyles(parts.styles)
  const isBullet = parseNumbering(parts.numbering)
  const rels = parseRels(parts.rels)
  const images: string[] = []
  const notes: { kind: 'footnote' | 'endnote'; id: string }[] = []
  const plain: string[] = []

  const styleChain = (id: string | undefined): StyleInfo[] => {
    const chain: StyleInfo[] = []
    for (
      let s = id ? styles.get(id) : undefined;
      s && chain.length < 10;
      s = s.basedOn ? styles.get(s.basedOn) : undefined
    )
      chain.push(s)
    return chain
  }

  function headingLevel(styleId: string | undefined, pPr: XmlElement | undefined): number {
    const own = child(pPr, 'w:outlineLvl')?.attrs[W_VAL]
    if (own !== undefined && Number(own) < 9) return Math.min(6, Number(own) + 1)
    for (const s of styleChain(styleId)) {
      const named = /^heading\s*([1-9])$/i.exec(s.name)
      if (named) return Math.min(6, Number(named[1]))
      if (/^title$/i.test(s.name)) return 1
      if (s.outline !== undefined && s.outline < 9) return Math.min(6, s.outline + 1)
    }
    const byId = /^(?:heading|berschrift|titre|titolo|kop)\s*([1-9])$/i.exec(styleId ?? '')
    return byId ? Math.min(6, Number(byId[1])) : styleId === 'Title' ? 1 : 0
  }

  function runFormat(
    r: XmlElement,
    base: Pick<Segment, 'b' | 'i' | 's' | 'code'>,
  ): Pick<Segment, 'b' | 'i' | 's' | 'code'> {
    const rPr = child(r, 'w:rPr')
    const fmt = { ...base }
    for (const s of styleChain(child(rPr, 'w:rStyle')?.attrs[W_VAL])) {
      if (/strong/i.test(s.name) || s.bold) fmt.b = true
      if (/emphasis/i.test(s.name) || s.italic) fmt.i = true
      if (s.mono || /code|source|verbatim/i.test(s.name)) fmt.code = true
    }
    if (child(rPr, 'w:b')) fmt.b = on(child(rPr, 'w:b'))
    if (child(rPr, 'w:i')) fmt.i = on(child(rPr, 'w:i'))
    if (child(rPr, 'w:strike') || child(rPr, 'w:dstrike'))
      fmt.s = on(child(rPr, 'w:strike') ?? child(rPr, 'w:dstrike'))
    if (MONO_FONT.test(child(rPr, 'w:rFonts')?.attrs['w:ascii'] ?? '')) fmt.code = true
    return fmt
  }

  /** Inline content of a paragraph (or footnote paragraph) as segments. */
  function inline(p: XmlElement, base: Pick<Segment, 'b' | 'i' | 's' | 'code'>): Segment[] {
    const segs: Segment[] = []
    // Complex fields: begin → instruction → separate → shown result → end. Only the result shows.
    const fields: { instr: string; inResult: boolean; href?: string }[] = []
    const fieldHref = () => [...fields].reverse().find((f) => f.href)?.href
    const inInstr = () => fields.some((f) => !f.inResult)

    const walk = (el: XmlElement, href: string | undefined) => {
      for (const c of el.children) {
        if (!isElement(c)) continue
        switch (c.name) {
          case 'w:r':
            run(c, href)
            break
          case 'w:hyperlink': {
            const rel = c.attrs['r:id'] ? rels.get(c.attrs['r:id']) : undefined
            const target = rel ? rel.target : c.attrs['w:anchor'] ? `#${c.attrs['w:anchor']}` : undefined
            walk(c, target ?? href)
            break
          }
          case 'w:del':
          case 'w:moveFrom':
          case 'w:pPr':
            break
          default:
            // w:ins, w:moveTo, w:smartTag, w:customXml, w:sdt/w:sdtContent, w:fldSimple…
            walk(c, href)
        }
      }
    }

    const run = (r: XmlElement, href: string | undefined) => {
      const fmt = runFormat(r, base)
      const link = href ?? fieldHref()
      const push = (text: string) => {
        if (!inInstr() && text) segs.push({ text, ...fmt, href: link })
      }
      for (const c of r.children) {
        if (!isElement(c)) continue
        switch (c.name) {
          case 'w:t':
            push(c.children.filter((x) => typeof x === 'string').join(''))
            break
          case 'w:tab':
          case 'w:ptab':
            push(' ')
            break
          case 'w:noBreakHyphen':
            push('-')
            break
          case 'w:br':
          case 'w:cr':
            if (!inInstr() && (c.attrs['w:type'] ?? 'textWrapping') === 'textWrapping')
              segs.push({ text: '', ...fmt, br: true })
            break
          case 'w:fldChar': {
            const t = c.attrs['w:fldCharType']
            if (t === 'begin') fields.push({ instr: '', inResult: false })
            else if (t === 'separate' && fields.length) {
              const f = fields[fields.length - 1]!
              f.inResult = true
              const url = /HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(f.instr)
              if (url) f.href = /\\l/.test(f.instr) ? `#${url[1]}` : url[1]
            } else if (t === 'end') fields.pop()
            break
          }
          case 'w:instrText':
            if (fields.length) fields[fields.length - 1]!.instr += c.children.join('')
            break
          case 'w:footnoteReference':
          case 'w:endnoteReference': {
            if (inInstr()) break
            const kind = c.name === 'w:footnoteReference' ? 'footnote' : 'endnote'
            notes.push({ kind, id: c.attrs['w:id'] ?? '' })
            segs.push({ text: `[^${notes.length}]`, ...fmt, raw: true })
            break
          }
          case 'w:drawing':
          case 'w:pict':
          case 'w:object': {
            if (inInstr()) break
            const blip = find(c, 'a:blip')?.attrs['r:embed'] ?? find(c, 'v:imagedata')?.attrs['r:id']
            const rel = blip ? rels.get(blip) : undefined
            if (!rel || rel.external) break
            const linkTo = opts.imageLink?.(rel.target)
            if (!linkTo) break
            const doc = find(c, 'wp:docPr')
            const alt = (doc?.attrs.descr || doc?.attrs.title || '').replace(/\s+/g, ' ').trim()
            if (!images.includes(rel.target)) images.push(rel.target)
            segs.push({ text: `![${escapeInline(alt)}](${linkUrl(linkTo)})`, ...fmt, raw: true })
            break
          }
        }
      }
    }

    walk(p, undefined)
    return segs
  }

  const plainOf = (segs: Segment[]) =>
    segs
      .map((s) => (s.br ? '\n' : s.raw ? '' : s.text))
      .join('')
      .trim()

  // Ordered-list counters per list and level; a shallower item resets the deeper ones.
  const counters = new Map<string, number[]>()

  function paragraph(p: XmlElement): Block | null {
    const pPr = child(p, 'w:pPr')
    const styleId = child(pPr, 'w:pStyle')?.attrs[W_VAL]
    const chain = styleChain(styleId)
    const base = {
      b: false,
      i: false,
      s: false,
      code: chain.some((s) => s.mono || /^(code|html preformatted|source)/i.test(s.name)),
    }
    const segs = inline(p, base)
    const text = plainOf(segs)
    if (text) plain.push(text)
    if (!segs.some((s) => s.raw) && !text) return null

    const level = headingLevel(styleId, pPr)
    if (level) return { md: `${'#'.repeat(level)} ${renderSegments(segs, ' ').trim()}`, list: false }

    const numPr = child(pPr, 'w:numPr')
    const fromStyle = chain.find((s) => s.numId !== undefined)
    const numId = child(numPr, 'w:numId')?.attrs[W_VAL] ?? fromStyle?.numId
    if (numId && numId !== '0') {
      const ilvl = Math.min(8, Number(child(numPr, 'w:ilvl')?.attrs[W_VAL] ?? fromStyle?.ilvl ?? 0))
      const bullet = isBullet(numId, ilvl)
      const c = counters.get(numId) ?? []
      c[ilvl] = (c[ilvl] ?? 0) + 1
      c.length = ilvl + 1
      counters.set(numId, c)
      const marker = bullet ? '- ' : `${c[ilvl]}. `
      const indent = '    '.repeat(ilvl)
      const md = escapeBlockStart(renderSegments(segs, `\\\n${indent}${' '.repeat(marker.length)}`).trim())
      return { md: `${indent}${marker}${md}`, list: true }
    }

    if (!segs.some((s) => s.raw) && segs.every((s) => s.br || s.code || !s.text.trim()))
      return { md: '', list: false, code: segs.map((s) => (s.br ? '\n' : s.text)).join('') }
    if (chain.some((s) => /quote/i.test(s.name)))
      return { md: `> ${renderSegments(segs, '\\\n> ').trim()}`, list: false }
    return { md: escapeBlockStart(renderSegments(segs, '\\\n').trim()), list: false }
  }

  function cellText(tc: XmlElement): string {
    const parts: string[] = []
    for (const p of findAll(tc, 'w:p')) {
      const segs = inline(p, { b: false, i: false, s: false, code: false })
      const text = plainOf(segs)
      if (text) plain.push(text)
      const md = renderSegments(segs, '<br>').trim()
      if (md) parts.push(md)
    }
    return parts.join('<br>')
  }

  function table(tbl: XmlElement): Block[] {
    const rows = kids(tbl, 'w:tr')
    const cells = rows.map((tr) => kids(tr, 'w:tc'))
    // A one-cell table is a layout box, not data: its paragraphs are ordinary text.
    if (rows.length === 1 && cells[0]!.length === 1) return blocks(cells[0]![0]!)
    const grid = cells.map((tcs) =>
      tcs.flatMap((tc) => {
        const tcPr = child(tc, 'w:tcPr')
        const vMerge = child(tcPr, 'w:vMerge')
        const text = vMerge && vMerge.attrs[W_VAL] !== 'restart' ? '' : cellText(tc)
        const span = Number(child(tcPr, 'w:gridSpan')?.attrs[W_VAL] ?? 1)
        return [text, ...Array<string>(Math.max(0, span - 1)).fill('')]
      }),
    )
    // Cell text is already escaped Markdown (pipes included).
    const md = tableToMarkdown(grid, (s) => s)
    return md ? [{ md, list: false }] : []
  }

  function blocks(container: XmlElement): Block[] {
    const out: Block[] = []
    for (const c of kids(container)) {
      if (c.name === 'w:p') {
        const b = paragraph(c)
        if (b) out.push(b)
      } else if (c.name === 'w:tbl') out.push(...table(c))
      else if (c.name === 'w:sdt') out.push(...blocks(child(c, 'w:sdtContent') ?? c))
      else if (c.name === 'w:customXml' || c.name === 'w:ins' || c.name === 'w:moveTo') out.push(...blocks(c))
    }
    // Consecutive code paragraphs (a command listing) become one fenced block.
    const merged: Block[] = []
    for (const b of out) {
      const prev = merged[merged.length - 1]
      if (b.code !== undefined && prev?.code !== undefined) prev.code += `\n${b.code}`
      else merged.push({ ...b })
    }
    return merged.map((b) =>
      b.code !== undefined ? { md: codeToMarkdown(b.code, '').trimEnd(), list: false } : b,
    )
  }

  const body = find(parseXml(parts.document), 'w:body')
  const result = blocks(body ?? parseXml(''))

  // Footnotes and endnotes, numbered in the order the text refers to them.
  const noteBodies = {
    footnote: parts.footnotes ? findAll(parseXml(parts.footnotes), 'w:footnote') : [],
    endnote: parts.endnotes ? findAll(parseXml(parts.endnotes), 'w:endnote') : [],
  }
  const noteLines: string[] = []
  // Footnote text can itself refer to notes; only the ones found so far are listed.
  const referenced = notes.length
  for (let n = 0; n < referenced; n++) {
    const { kind, id } = notes[n]!
    const el = noteBodies[kind].find((f) => f.attrs['w:id'] === id)
    const text = el
      ? findAll(el, 'w:p')
          .map((p) =>
            renderSegments(
              inline(p, { b: false, i: false, s: false, code: false }).filter((s) => !s.raw),
              ' ',
            ).trim(),
          )
          .filter(Boolean)
          .join(' ')
      : ''
    noteLines.push(`[^${n + 1}]: ${text || '(empty note)'}`)
  }
  if (noteLines.length) result.push({ md: noteLines.join('\n'), list: false })

  return { markdown: joinBlocks(result), text: plain.join('\n'), images }
}
