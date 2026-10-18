import type { Paragraph } from '../pdf/paragraphs'
import { zip } from './zip'

export interface DocxPage {
  /** Page size in PDF points, used for the Word page size. */
  width: number
  height: number
  paragraphs: Paragraph[]
}

// XML 1.0 forbids most control characters; PDFs sometimes contain them.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g
const esc = (s: string) => s.replace(INVALID_XML, '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function paragraphXml(p: Paragraph, breakBefore: boolean): string {
  const style = p.heading === 1 ? 'Heading1' : p.heading === 2 ? 'Heading2' : null
  const props = (style ? `<w:pStyle w:val="${style}"/>` : '') + (breakBefore ? '<w:pageBreakBefore/>' : '')
  const pPr = props ? `<w:pPr>${props}</w:pPr>` : ''
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`
}

/** Build a minimal, valid .docx (OOXML) with one section and a page break per source page. */
export function buildDocx(pages: DocxPage[], title = 'Document'): Uint8Array {
  const first = pages[0] ?? { width: 612, height: 792 }
  const twips = (pt: number) => Math.round(pt * 20)
  // Each source page after the first starts on a new Word page (pageBreakBefore on its first
  // paragraph, so no empty break paragraphs). Pages without text are skipped.
  let isFirst = true
  const body = pages
    .filter((page) => page.paragraphs.length > 0)
    .map((page) =>
      page.paragraphs
        .map((p, j) => {
          const xml = paragraphXml(p, j === 0 && !isFirst)
          isFirst = false
          return xml
        })
        .join(''),
    )
    .join('')
  // Margins: 2 cm, but never more than 10 % of the page (tiny or unusual PDF page sizes).
  const marginX = Math.min(1134, twips(first.width * 0.1))
  const marginY = Math.min(1134, twips(first.height * 0.1))
  const orient = first.width > first.height ? ' w:orient="landscape"' : ''
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="${twips(first.width)}" w:h="${twips(first.height)}"${orient}/><w:pgMar w:top="${marginY}" w:right="${marginX}" w:bottom="${marginY}" w:left="${marginX}" w:header="${Math.round(marginY / 2)}" w:footer="${Math.round(marginY / 2)}" w:gutter="0"/></w:sectPr></w:body></w:document>`

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>Twirly</dc:creator></cp:coreProperties>`

  const enc = new TextEncoder()
  return zip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'word/document.xml', data: enc.encode(document) },
    { name: 'word/styles.xml', data: enc.encode(styles) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
    { name: 'docProps/core.xml', data: enc.encode(core) },
  ])
}
