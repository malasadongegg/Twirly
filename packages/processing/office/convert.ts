import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { CancelledError, UserFacingError } from '../errors'

const run = promisify(execFile)

/**
 * PowerShell that drives an installed Office app to "Save as PDF". Paths arrive through
 * environment variables, so nothing is ever spliced into the script text. Word and Excel get
 * their own instance; PowerPoint is single-instance, so it is only quit if it wasn't already
 * running (never closing the user's open presentations). A dummy password makes protected files
 * fail fast instead of waiting on an invisible password prompt.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$in = $env:TWIRLY_IN; $out = $env:TWIRLY_OUT
switch ($env:TWIRLY_APP) {
  'word' {
    $app = New-Object -ComObject Word.Application; $app.Visible = $false; $app.DisplayAlerts = 0
    try { $d = $app.Documents.Open($in, $false, $true, $false, 'twirly-no-password'); try { $d.ExportAsFixedFormat($out, 17) } finally { $d.Close(0) } }
    finally { $app.Quit() }
  }
  'excel' {
    $app = New-Object -ComObject Excel.Application; $app.Visible = $false; $app.DisplayAlerts = $false
    try { $wb = $app.Workbooks.Open($in, 0, $true, 5, 'twirly-no-password'); try { $wb.ExportAsFixedFormat(0, $out) } finally { $wb.Close($false) } }
    finally { $app.Quit() }
  }
  'powerpoint' {
    $wasRunning = [bool](Get-Process POWERPNT -ErrorAction SilentlyContinue)
    $app = New-Object -ComObject PowerPoint.Application
    try { $p = $app.Presentations.Open($in + '::twirly-no-password', -1, 0, 0); try { $p.SaveAs($out, 32) } finally { $p.Close() } }
    finally { if (-not $wasRunning -and $app.Presentations.Count -eq 0) { $app.Quit() } }
  }
}
`

export type OfficeEngine = 'word' | 'excel' | 'powerpoint' | 'libreoffice'

function explain(err: unknown): UserFacingError {
  const msg = (err as Error & { stderr?: string }).stderr || (err as Error).message
  if (/password/i.test(msg)) return new UserFacingError('This document is password-protected.', msg)
  if (/ETIMEDOUT|timed out|SIGTERM/i.test(msg)) return new UserFacingError('Converting took too long and was stopped.', msg)
  return new UserFacingError('The document could not be converted to PDF.', msg)
}

/** Convert `input` to a PDF at `output` with the chosen engine. */
export async function officeToPdf(engine: OfficeEngine, input: string, output: string, opts: { libreOfficePath?: string; signal?: AbortSignal } = {}): Promise<void> {
  if (opts.signal?.aborted) throw new CancelledError()
  if (engine === 'libreoffice') {
    const dir = await mkdtemp(join(tmpdir(), 'twirly-lo-'))
    try {
      await run(opts.libreOfficePath ?? 'soffice', ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, input], { timeout: 180_000, windowsHide: true, signal: opts.signal })
      const pdf = (await readdir(dir)).find((f) => f.toLowerCase().endsWith('.pdf'))
      if (!pdf) throw new Error(`LibreOffice produced no PDF for ${basename(input)}`)
      await rename(join(dir, pdf), output)
    } catch (err) {
      if (opts.signal?.aborted) throw new CancelledError()
      throw explain(err)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
    return
  }
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: { ...process.env, TWIRLY_APP: engine, TWIRLY_IN: input, TWIRLY_OUT: output },
      timeout: 180_000,
      windowsHide: true,
      signal: opts.signal,
    })
  } catch (err) {
    if (opts.signal?.aborted) throw new CancelledError()
    throw explain(err)
  }
}
