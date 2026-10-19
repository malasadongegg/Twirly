import { execFile, spawn } from 'node:child_process'
import { dialog, shell } from 'electron'
import { CancelledError, UserFacingError } from '@processing/errors'
import { getCapabilities } from './capabilities'

const DOWNLOAD_PAGE = 'https://www.libreoffice.org/download/download-libreoffice/'
const WINGET_ID = 'TheDocumentFoundation.LibreOffice'

const hasWinget = () =>
  new Promise<boolean>((resolve) => execFile('winget', ['--version'], { timeout: 10_000, windowsHide: true }, (err) => resolve(!err)))

let installing: Promise<void> | null = null

/**
 * Office → PDF needs Microsoft Office or LibreOffice. When neither is present, offer to install
 * LibreOffice (free) through Windows Package Manager. Resolves once LibreOffice is detected;
 * throws CancelledError if the user declines.
 */
export async function ensureLibreOffice(opts: { signal?: AbortSignal; onStatus?: (message: string) => void; ask?: boolean } = {}): Promise<void> {
  if ((await getCapabilities()).libreoffice.available) return
  if (opts.ask !== false) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'Twirly',
      message: 'Converting documents to PDF needs LibreOffice',
      detail:
        'Microsoft Office was not found on this PC. LibreOffice is free (about 350 MB) and Twirly can install it for you now. Windows may ask for permission.',
      buttons: ['Install LibreOffice', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response !== 0) throw new CancelledError()
  }
  // Several documents dropped at once share one install.
  installing ??= install(opts.onStatus).finally(() => (installing = null))
  await abortable(installing, opts.signal)
}

async function install(onStatus?: (message: string) => void): Promise<void> {
  if (!(await hasWinget())) {
    void shell.openExternal(DOWNLOAD_PAGE)
    throw new UserFacingError('Opened the LibreOffice download page. Install it, then try again.')
  }
  onStatus?.('Installing LibreOffice… this can take a few minutes')
  const args = ['install', '--id', WINGET_ID, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity']
  const { code, output } = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn('winget', args, { windowsHide: true })
    let output = ''
    child.stdout.on('data', (d: Buffer) => (output += d.toString()))
    child.stderr.on('data', (d: Buffer) => (output += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
  })
  const caps = await getCapabilities({ refresh: true })
  if (caps.libreoffice.available) return
  throw new UserFacingError(
    code === 0 ? 'LibreOffice was installed but Twirly cannot find it yet. Restart Twirly and try again.' : 'LibreOffice could not be installed. You can download it from libreoffice.org.',
    output.trim().split(/\r?\n/).slice(-15).join('\n'),
  )
}

/** Stop waiting when the job is cancelled. The installer itself keeps going in the background. */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(new CancelledError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new CancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}
