/// <reference lib="dom" />
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import yazl from 'yazl'

// A PC with neither Microsoft Office nor LibreOffice (simulated): Convert to PDF is still offered
// and asks to install LibreOffice. Declining leaves nothing behind. Nothing is actually installed.
const root = process.cwd()
const work = join(root, 'tests', '.tmp', 'no-office')

let app: ElectronApplication
let home: Page

function minimalDocx(): Promise<Buffer> {
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'), '[Content_Types].xml')
  zip.addBuffer(Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'), 'word/document.xml')
  zip.end()
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    zip.outputStream.on('data', (d: Buffer) => parts.push(d))
    zip.outputStream.on('end', () => resolve(Buffer.concat(parts)))
    zip.outputStream.on('error', reject)
  })
}

test.beforeAll(async () => {
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  await writeFile(join(work, 'report.docx'), await minimalDocx())
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE' && k !== 'ELECTRON_RENDERER_URL')) as Record<string, string>
  env.TWIRLY_USER_DATA = join(work, 'user-data')
  env.TWIRLY_TEST_NO_OFFICE = '1'
  app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], env })
  home = await (async () => {
    for (;;) {
      const w = app.windows().find((p) => p.url().endsWith('/index.html'))
      if (w) return w
      await app.waitForEvent('window')
    }
  })()
  await home.waitForSelector('[data-testid="drop-zone"]')
})

test.afterAll(async () => {
  await app?.close()
})

test('without Office, Convert to PDF offers to install LibreOffice; declining cancels cleanly', async () => {
  const caps = await home.evaluate(() => window.twirly.capabilities())
  expect(caps.office.word || caps.libreoffice.available).toBe(false)

  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
    const g = globalThis as unknown as { __asked?: string[] }
    g.__asked = []
    // Record the question and answer "Cancel".
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const opts = args.find((a) => a && typeof a === 'object' && 'message' in a) as { message: string; buttons: string[] }
      g.__asked!.push(`${opts.message} | ${opts.buttons.join(', ')}`)
      return { response: 1, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, join(work, 'report.docx'))

  await home.getByRole('button', { name: /Browse files/ }).click()
  await home.getByTestId('wheel-segment-document.to-pdf').click()
  await expect(home.getByTestId('job-toast')).toHaveAttribute('data-status', 'cancelled', { timeout: 10_000 })

  const asked = await app.evaluate(() => (globalThis as unknown as { __asked: string[] }).__asked)
  expect(asked).toEqual(['Converting documents to PDF needs LibreOffice | Install LibreOffice, Cancel'])
  expect(existsSync(join(work, 'report.pdf'))).toBe(false)
  expect((await readdir(work)).filter((n) => n.endsWith('.pdf') || n.endsWith('.tmp'))).toEqual([])
})

test('Settings → Diagnostics shows an Install LibreOffice button', async () => {
  await expect(home.getByTestId('job-toast')).toBeHidden({ timeout: 5000 })
  await home.getByRole('button', { name: 'Settings' }).click()
  await expect(home.getByTestId('install-libreoffice')).toHaveText('Install LibreOffice (free)')
})
