import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toLines, toParagraphs, type TextRun } from '@core/pdf/paragraphs'
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
