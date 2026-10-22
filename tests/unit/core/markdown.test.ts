import { describe, expect, it } from 'vitest'
import {
  codeToMarkdown,
  csvToMarkdown,
  describeStats,
  escapeInline,
  paragraphsToMarkdown,
  parseCsv,
  textStats,
  textToMarkdown,
} from '@core/markdown/markdown'
import { docxToMarkdown } from '@core/markdown/docx-markdown'
import { parseXml, textOf } from '@core/xml/parse'

describe('parseXml', () => {
  it('reads elements, attributes, entities and skips declarations and comments', () => {
    const root = parseXml('<?xml version="1.0"?><!-- hi --><a x="1 &amp; 2"><b>T &lt;3 &#x41;</b><c/></a>')
    const a = root.children[0] as { name: string; attrs: Record<string, string> }
    expect(a.name).toBe('a')
    expect(a.attrs.x).toBe('1 & 2')
    expect(textOf(root)).toBe('T <3 A')
  })
  it('keeps ">" inside quoted attributes', () => {
    const root = parseXml('<a t="x > y">ok</a>')
    expect(textOf(root)).toBe('ok')
  })
})

describe('plain text → Markdown', () => {
  it('keeps line breaks inside paragraphs and paragraph gaps', () => {
    expect(textToMarkdown('Line one\nLine two\n\n\nNext para\n')).toBe('Line one  \nLine two\n\nNext para\n')
  })
  it('turns bullet glyphs into list items and neutralises HTML', () => {
    expect(textToMarkdown('• apples\n• <b>pears</b>')).toBe('- apples  \n- &lt;b>pears&lt;/b>\n')
  })
  it('wraps data files in a fence longer than any backticks inside', () => {
    expect(codeToMarkdown('{"a": "```"}', 'json')).toBe('````json\n{"a": "```"}\n````\n')
  })
})

describe('CSV → Markdown table', () => {
  it('handles quotes, embedded delimiters and newlines, and detects ;', () => {
    expect(parseCsv('a;b\n"x;1";"say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x;1', 'say "hi"'],
    ])
    expect(csvToMarkdown('name,note\nAna,"two\nlines"\nBo')).toBe(
      '| name | note |\n| --- | --- |\n| Ana | two<br>lines |\n| Bo |  |\n',
    )
  })
  it('escapes pipes in cells', () => {
    expect(csvToMarkdown('h\na|b')).toContain('a\\|b')
  })
})

describe('PDF paragraphs → Markdown', () => {
  it('maps headings and bullet glyphs, escapes the rest', () => {
    const md = paragraphsToMarkdown([
      [
        { text: 'Report', heading: 1 },
        { text: 'Costs rose 5*3 [est]', heading: 0 },
        { text: '• first', heading: 0 },
        { text: '• second', heading: 0 },
      ],
      [{ text: '# not a heading', heading: 0 }],
    ])
    expect(md).toBe('# Report\n\nCosts rose 5\\*3 \\[est\\]\n\n- first\n- second\n\n\\# not a heading\n')
  })
  it('escapes every inline marker', () => {
    expect(escapeInline('a_b*c`d<e>|')).toBe('a\\_b\\*c\\`d\\<e\\>\\|')
  })
})

describe('textStats', () => {
  it('counts words, characters and reading time', () => {
    const s = textStats("Hello, world! It's 2026.\n\nSecond para.")
    expect(s.words).toBe(6)
    expect(s.paragraphs).toBe(2)
    expect(s.lines).toBe(3)
    expect(s.readingMinutes).toBe(1)
    expect(describeStats(textStats(''))).toBe('0 words · 0 characters · 0 min read')
  })
})

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const doc = (body: string) =>
  `<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`
const p = (inner: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`
const r = (text: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`

describe('DOCX → Markdown', () => {
  it('headings from styles (also localized ids, via the style name), bold/italic/strike runs', () => {
    const styles = `<w:styles ${W}><w:style w:type="paragraph" w:styleId="berschrift2"><w:name w:val="heading 2"/></w:style></w:styles>`
    const { markdown } = docxToMarkdown({
      document: doc(
        p(r('Title'), '<w:pStyle w:val="Title"/>') +
          p(r('Section'), '<w:pStyle w:val="berschrift2"/>') +
          p(
            r('Bold ', '<w:b/>') +
              r('and ', '<w:b/>') +
              r('italic', '<w:i/>') +
              r(' gone', '<w:strike/>') +
              r(' plain') +
              r(' not bold', '<w:b w:val="0"/>'),
          ),
      ),
      styles,
    })
    expect(markdown).toBe('# Title\n\n## Section\n\n**Bold and** *italic* ~~gone~~ plain not bold\n')
  })

  it('bulleted and numbered lists with levels, from numbering.xml', () => {
    const numbering = `<w:numbering ${W}>
      <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`
    const li = (t: string, lvl: number) =>
      p(r(t), `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="1"/></w:numPr>`)
    const { markdown } = docxToMarkdown({
      document: doc(
        p(r('Intro')) + li('a', 0) + li('one', 1) + li('two', 1) + li('b', 0) + li('one again', 1),
      ),
      numbering,
    })
    expect(markdown).toBe('Intro\n\n- a\n    1. one\n    2. two\n- b\n    1. one again\n')
  })

  it('hyperlinks (relationship and HYPERLINK field), line breaks, tabs, tracked deletions', () => {
    const rels = `<Relationships><Relationship Id="rId5" Type="hyperlink" Target="https://example.com/a b" TargetMode="External"/></Relationships>`
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://x.org" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      r('site') +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    const { markdown } = docxToMarkdown({
      document: doc(
        p(
          `<w:hyperlink r:id="rId5">${r('Example', '<w:b/>')}</w:hyperlink>` +
            r(' and ') +
            field +
            '<w:r><w:br/><w:t>next</w:t><w:tab/><w:t>col</w:t></w:r>' +
            `<w:del>${r('removed')}</w:del>`,
        ),
      ),
      rels,
    })
    expect(markdown).toBe('[**Example**](https://example.com/a%20b) and [site](https://x.org)\\\nnext col\n')
  })

  it('tables become pipe tables; one-cell tables are plain text; merged cells stay aligned', () => {
    const tc = (t: string, tcPr = '') => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${p(r(t))}</w:tc>`
    const tbl = `<w:tbl><w:tr>${tc('Name')}${tc('Score')}${tc('Note')}</w:tr><w:tr>${tc('Ana | B', '<w:gridSpan w:val="2"/>')}${tc('ok')}</w:tr></w:tbl>`
    const box = `<w:tbl><w:tr>${tc('Inside a box')}</w:tr></w:tbl>`
    const { markdown } = docxToMarkdown({ document: doc(tbl + box) })
    expect(markdown).toBe(
      '| Name | Score | Note |\n| --- | --- | --- |\n| Ana \\| B |  | ok |\n\nInside a box\n',
    )
  })

  it('images link to the extracted file with their alt text; footnotes become [^n]', () => {
    const rels = `<Relationships><Relationship Id="rId9" Type="image" Target="media/image1.png"/></Relationships>`
    const drawing =
      '<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="A cat"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    const footnotes = `<w:footnotes ${W}><w:footnote w:id="2">${p(r('See page 4.'))}</w:footnote></w:footnotes>`
    const res = docxToMarkdown(
      {
        document: doc(p(drawing) + p(r('Claim') + '<w:r><w:footnoteReference w:id="2"/></w:r>')),
        rels,
        footnotes,
      },
      { imageLink: (t) => `report images/${t.split('/').pop()}` },
    )
    expect(res.markdown).toBe('![A cat](report%20images/image1.png)\n\nClaim[^1]\n\n[^1]: See page 4.\n')
    expect(res.images).toEqual(['media/image1.png'])
    expect(res.text).toBe('Claim')
  })

  it('escapes Markdown characters in the text and paragraph starts', () => {
    const { markdown } = docxToMarkdown({
      document: doc(p(r('# 1. *not* emphasis_')) + p(r('2. not a list'))),
    })
    expect(markdown).toBe('\\# 1. \\*not\\* emphasis\\_\n\n2\\. not a list\n')
  })

  it('monospace runs become inline code', () => {
    const { markdown } = docxToMarkdown({
      document: doc(p(r('Run ') + r('npm *test*', '<w:rFonts w:ascii="Consolas"/>'))),
    })
    expect(markdown).toBe('Run `npm *test*`\n')
  })

  it('whole monospace paragraphs join into one fenced code block', () => {
    const mono = '<w:rFonts w:ascii="Consolas"/>'
    const code = (t: string) => p(r(t, mono))
    const { markdown } = docxToMarkdown({
      document: doc(
        p(r('Run:')) + code('cd backend') + code('pip install -r *.txt') + p(r('Done &lt; 1 min.')),
      ),
    })
    expect(markdown).toBe('Run:\n\n```\ncd backend\npip install -r *.txt\n```\n\nDone < 1 min.\n')
  })
})
