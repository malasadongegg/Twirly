/**
 * Minimal, forgiving XML reader for OOXML parts (document.xml, numbering.xml…). No DTDs, no
 * namespace resolution: names keep their prefix ("w:p"), which is how Office writes them.
 */

export interface XmlElement {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}
export type XmlNode = XmlElement | string

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e] ?? m
  })
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g

export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: {}, children: [] }
  const stack: XmlElement[] = [root]
  let i = 0
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    const textEnd = lt === -1 ? xml.length : lt
    if (textEnd > i) {
      const text = xml.slice(i, textEnd)
      if (stack.length > 1) stack[stack.length - 1]!.children.push(decodeEntities(text))
    }
    if (lt === -1) break
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      i = end === -1 ? xml.length : end + 3
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      stack[stack.length - 1]!.children.push(xml.slice(lt + 9, end === -1 ? xml.length : end))
      i = end === -1 ? xml.length : end + 3
    } else if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      const end = xml.indexOf('>', lt)
      i = end === -1 ? xml.length : end + 1
    } else if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt)
      const name = xml.slice(lt + 2, end === -1 ? xml.length : end).trim()
      // Pop to the matching element; a stray close tag is ignored.
      const at = stack.map((e) => e.name).lastIndexOf(name)
      if (at > 0) stack.length = at
      i = end === -1 ? xml.length : end + 1
    } else {
      // Find the tag's end, skipping '>' inside quoted attribute values.
      let j = lt + 1
      let quote = ''
      for (; j < xml.length; j++) {
        const c = xml[j]
        if (quote) {
          if (c === quote) quote = ''
        } else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
      }
      const inner = xml.slice(lt + 1, j)
      const selfClosing = inner.endsWith('/')
      const body = selfClosing ? inner.slice(0, -1) : inner
      const nameEnd = body.search(/[\s/]/)
      const name = nameEnd === -1 ? body : body.slice(0, nameEnd)
      const attrs: Record<string, string> = {}
      for (const m of body.slice(name.length).matchAll(ATTR))
        attrs[m[1]!] = decodeEntities(m[3] ?? m[4] ?? '')
      const el: XmlElement = { name, attrs, children: [] }
      stack[stack.length - 1]!.children.push(el)
      if (!selfClosing) stack.push(el)
      i = j + 1
    }
  }
  return root
}

export const isElement = (n: XmlNode | undefined): n is XmlElement => typeof n === 'object' && n !== null

/** Direct child elements, optionally by name. */
export function kids(el: XmlElement | undefined, name?: string): XmlElement[] {
  if (!el) return []
  return el.children.filter((c): c is XmlElement => isElement(c) && (!name || c.name === name))
}

export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el?.children.find((c): c is XmlElement => isElement(c) && c.name === name)
}

/** First descendant with this name (depth-first). */
export function find(el: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined
  for (const c of el.children) {
    if (!isElement(c)) continue
    if (c.name === name) return c
    const hit = find(c, name)
    if (hit) return hit
  }
  return undefined
}

export function findAll(el: XmlElement | undefined, name: string, out: XmlElement[] = []): XmlElement[] {
  if (!el) return out
  for (const c of el.children) {
    if (!isElement(c)) continue
    if (c.name === name) out.push(c)
    findAll(c, name, out)
  }
  return out
}

/** Concatenated text of an element and its descendants. */
export function textOf(el: XmlElement): string {
  return el.children.map((c) => (isElement(c) ? textOf(c) : c)).join('')
}
