import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toLines, toParagraphs, type Paragraph, type TextRun } from '@core/pdf/paragraphs'
import { buildDocx } from '@core/docx/docx'
import { crc32 } from '@core/docx/zip'

const run = (str: string, x: number, y: number, h = 11): TextRun => ({ str, x, y, h, w: str.length * h * 0.5 })

describe('toLines', () => {
  it('groups runs by baseline and orders them left to right, adding word gaps', () => {
    const lines = toLines([run('world', 60, 700), run('Hello', 10, 700.5), run('Next line', 10, 686)])
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Next line'])
  })
})

describe('toParagraphs', () => {
  const lines = toLines([
    run('Quarterly Report', 10, 760, 24),
    run('The first paragraph wraps onto', 10, 720),
    run('a second line with a hyphen-', 10, 706),
    run('ated word.', 10, 692),
    run('A new paragraph after a gap.', 10, 660),
    run('Section two', 10, 630, 15),
    run('Body again.', 10, 610),
  ])
  const paras = toParagraphs(lines)

  it('splits on large gaps and size changes, re-joins hyphenation', () => {
    expect(paras.map((p) => p.text)).toEqual([
      'Quarterly Report',
      'The first paragraph wraps onto a second line with a hyphenated word.',
      'A new paragraph after a gap.',
      'Section two',
      'Body again.',
    ])
  })

  it('detects headings by size relative to body text', () => {
    expect(paras.map((p) => p.heading)).toEqual([1, 0, 0, 2, 0])
  })
})

describe('zip / docx', () => {
  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  const docx = buildDocx(
    [
      {
        width: 612,
        height: 792,
        paragraphs: [
          { text: 'Quarterly Report', heading: 1 },
          { text: 'Profits & losses <2026> "quoted"', heading: 0 },
        ],
      },
      { width: 612, height: 792, paragraphs: [{ text: 'Page two text', heading: 0 }] },
    ],
    'Report',
  )
  const dir = join(process.cwd(), 'tests', '.tmp', 'docx')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'report.docx')
  writeFileSync(path, docx)

  it.runIf(process.platform === 'win32')('is a valid ZIP for an independent reader (.NET System.IO.Compression)', () => {
    const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem
      $z = [IO.Compression.ZipFile]::OpenRead('${path}')
      $e = $z.GetEntry('word/document.xml')
      $r = New-Object IO.StreamReader($e.Open()); $t = $r.ReadToEnd(); $r.Close()
      ($z.Entries | ForEach-Object FullName) -join ','; $t.Length; $z.Dispose()`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    expect(out).toContain('[Content_Types].xml')
    expect(out).toContain('word/document.xml')
  })

  const hasWord = (() => {
    if (process.platform !== 'win32') return false
    try {
      return execFileSync('powershell.exe', ['-NoProfile', '-Command', 'try { $w = New-Object -ComObject Word.Application; $w.Quit(); "yes" } catch { "no" }'], { encoding: 'utf8' }).trim() === 'yes'
    } catch {
      return false
    }
  })()

  it.runIf(hasWord)('opens in Microsoft Word with the right text, styles and page break', () => {
    const ps = `$w = New-Object -ComObject Word.Application; $w.Visible = $false
      try {
        $d = $w.Documents.Open('${path}', $false, $true)
        $lines = foreach ($p in $d.Paragraphs) { $p.Style.NameLocal + '|' + $p.Range.Text.Trim() }
        $lines -join "\`n"
        'PAGES=' + $d.ComputeStatistics(2)
        $d.Close($false)
      } finally { $w.Quit() }`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 60_000 })
    expect(out).toMatch(/Heading 1\|Quarterly Report/)
    expect(out).toContain('Profits & losses <2026> "quoted"')
    expect(out).toContain('Page two text')
    expect(out).toContain('PAGES=2')
  }, 90_000)
})

describe('placeImages', () => {
  const paras: Paragraph[] = [
    { text: 'Above', heading: 0, y: 700 },
    { text: 'Below', heading: 0, y: 500 },
  ]
  const img = (top: number) => ({ data: new Uint8Array([1]), x: 10, top, width: 100, height: 80 })

  it('puts a picture between the paragraphs it sits between', async () => {
    const { placeImages } = await import('@core/pdf/paragraphs')
    const out = placeImages(paras, [img(650)])
    expect(out.map((p) => (p.image ? '[img]' : p.text))).toEqual(['Above', '[img]', 'Below'])
  })

  it('keeps several pictures in top-to-bottom order and trailing ones last', async () => {
    const { placeImages } = await import('@core/pdf/paragraphs')
    const out = placeImages(paras, [img(300), img(650), img(600)])
    expect(out.map((p) => (p.image ? `[${p.y}]` : p.text))).toEqual(['Above', '[650]', '[600]', 'Below', '[300]'])
  })
})

describe('buildDocx with images', () => {
  it('embeds the picture as a relationship and media part', () => {
    const png = new Uint8Array([137, 80, 78, 71])
    const bytes = buildDocx([{ width: 595, height: 842, paragraphs: [{ text: 'x', heading: 0 }, { text: '', heading: 0, image: { data: png, width: 800, height: 400 } }] }])
    const text = Buffer.from(bytes).toString('latin1')
    expect(text).toContain('word/media/image1.png')
    expect(text).toContain('r:embed="rIdImg1"')
    expect(text).toContain('Target="media/image1.png"')
  })
})
