/// <reference lib="dom" />
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import sharp from 'sharp'

// LIVE test: writes HKCU\Software\Classes\*\shell\Twirly and invokes it through the Windows shell.
// Opt-in only: TWIRLY_LIVE=1 npx playwright test tests/e2e/live-context-menu.spec.ts
test.skip(process.env.TWIRLY_LIVE !== '1', 'live system test (set TWIRLY_LIVE=1)')

const root = process.cwd()
const work = join(root, 'tests', '.tmp', 'context-menu')
const log = join(root, 'tests', '.tmp', 'context-menu.log')
const regQuery = () => spawnSync('reg.exe', ['query', 'HKCU\\Software\\Classes\\*\\shell\\Twirly\\command'], { encoding: 'utf8' })

test('"Open with Twirly" verb: install, invoke on two files via the shell, run an action, uninstall', async () => {
  test.setTimeout(90_000)
  await rm(work, { recursive: true, force: true })
  await rm(log, { force: true })
  await mkdir(work, { recursive: true })
  const a = join(work, 'one.png')
  const b = join(work, 'two.png')
  await sharp({ create: { width: 40, height: 30, channels: 3, background: '#ff0000' } }).png().toFile(a)
  await sharp({ create: { width: 50, height: 20, channels: 3, background: '#00ff00' } }).png().toFile(b)

  // No isolated user data: the shell-launched second instance must find this one's single-instance lock.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['ELECTRON_RUN_AS_NODE', 'TWIRLY_USER_DATA'].includes(k))) as Record<string, string>
  env.TWIRLY_SPIKE_LOG = log
  const app = await electron.launch({ args: [join(root, 'out', 'main', 'index.js')], env })
  try {
    const home = await (async () => {
      for (;;) {
        const w = app.windows().find((p) => p.url().endsWith('/index.html'))
        if (w) return w
        await app.waitForEvent('window')
      }
    })()
    await home.waitForSelector('[data-testid="drop-zone"]')

    // 1. Install through the same IPC the Settings "Add" button uses.
    expect(await home.evaluate(() => window.twirly.contextMenu('install'))).toEqual({ installed: true })
    const command = regQuery().stdout
    expect(command).toContain('--files "%1"')

    // 2. Invoke the verb on both files exactly like Explorer: Shell.Application → FolderItem.InvokeVerb.
    const ps = `
      Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
      $shell = New-Object -ComObject Shell.Application
      $folder = $shell.Namespace('${work.replace(/'/g, "''")}')
      foreach ($n in 'one.png','two.png') {
        $item = $folder.ParseName($n)
        $verb = $item.Verbs() | Where-Object { $_.Name -eq 'Open with Twirly' }
        if (-not $verb) { throw "verb not found on $n" }
        $verb.DoIt()
      }`
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env, stdio: 'pipe' })

    // 3. Both launches are batched into one wheel showing both files.
    const wheelWin = app.windows().find((p) => p.url().endsWith('/wheel.html'))!
    const wheel = wheelWin.getByTestId('radial-wheel')
    await expect(wheel).toHaveAttribute('data-hub', /^2 images · /, { timeout: 20_000 })
    const logText = await readFile(log, 'utf8')
    const shown = logText.split('\n').filter((l) => l.includes('wheel-shown-with-files'))
    expect(shown.at(-1)).toContain('one.png')
    expect(shown.at(-1)).toContain('two.png')
    await wheelWin.screenshot({ path: join(root, 'tests', '.tmp', 'screens', 'context-menu-wheel.png') })

    // 4. Run an action from the wheel; both outputs appear.
    await wheelWin.getByTestId('wheel-segment-image.convert.webp').click()
    await expect(wheelWin.getByTestId('job-toast')).toHaveAttribute('data-status', 'done', { timeout: 20_000 })
    expect((await sharp(join(work, 'one-converted.webp')).metadata()).width).toBe(40)
    expect((await sharp(join(work, 'two-converted.webp')).metadata()).width).toBe(50)

    // 5. Uninstall; the key is gone.
    expect(await home.evaluate(() => window.twirly.contextMenu('uninstall'))).toEqual({ installed: false })
    expect(regQuery().status).not.toBe(0)
  } finally {
    // Never leave the verb behind, even if an assertion failed.
    spawnSync('reg.exe', ['delete', 'HKCU\\Software\\Classes\\*\\shell\\Twirly', '/f'])
    await app.close()
  }
})
