// node desktop/scripts/smoke.ts <executable> [screenshot.png]
//
// Launches a packaged Murmur on fresh, throwaway data, waits for its first
// screen ("Connect to Hermes"), checks the page sees the desktop app, and saves
// a screenshot. It connects to nothing. CI runs it on Linux under xvfb-run; it
// works on any desktop with a display.
//
// Playwright's _electron can't drive a release build (its fuses turn off the
// Node inspector), so this attaches over Chromium's DevTools protocol instead.

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [executable, screenshot] = process.argv.slice(2)
if (!executable) {
  console.error('Usage: node desktop/scripts/smoke.ts <executable> [screenshot.png]')
  process.exit(2)
}

const userData = mkdtempSync(join(tmpdir(), 'murmur-smoke-'))
const env: NodeJS.ProcessEnv = { ...process.env, MURMUR_USER_DATA: userData }
delete env.MURMUR_SMOKE
// Port 0: Chromium picks one and writes it to DevToolsActivePort in the profile.
const args = ['--remote-debugging-port=0', '--use-mock-keychain', '--password-store=basic']
const child = spawn(resolve(executable), args, { env, stdio: ['ignore', 'inherit', 'inherit'] })
let exited = false
child.once('exit', (code) => {
  exited = true
  if (code) console.error(`Murmur exited with ${code}`)
})

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

async function devtoolsPort() {
  const file = join(userData, 'DevToolsActivePort')
  for (let i = 0; i < 300 && !exited; i++) {
    if (existsSync(file)) {
      const port = Number(readFileSync(file, 'utf8').split('\n')[0])
      if (port) return port
    }
    await wait(200)
  }
  throw new Error('Murmur never opened a window')
}

let failed = false
try {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${await devtoolsPort()}`, { timeout: 60_000 })
  const context = browser.contexts()[0]
  const ours = () => context.pages().find((page) => page.url().startsWith('http://127.0.0.1:'))
  for (let i = 0; i < 300 && !ours(); i++) await wait(200)
  const page = ours()
  if (!page) throw new Error('Murmur never loaded its page')
  page.on('pageerror', (error) => {
    failed = true
    console.error('Page error:', error.message)
  })
  await page.getByLabel('Hermes address').waitFor({ timeout: 60_000 })
  const desktop = await page.evaluate(() => {
    const bridge = (window as { murmurDesktop?: { version?: string } }).murmurDesktop
    return { marked: document.documentElement.dataset.desktop, frozen: Boolean(bridge && Object.isFrozen(bridge)), version: bridge?.version }
  })
  if (!desktop.marked || !desktop.frozen) throw new Error(`The page doesn't see the desktop app: ${JSON.stringify(desktop)}`)
  // Let the entrance animation settle before the picture.
  await page.waitForTimeout(1500)
  if (screenshot) await page.screenshot({ path: resolve(screenshot) })
  await browser.close()
  if (!failed) console.log(`murmur-smoke-ok ${desktop.version} ${process.platform}-${process.arch}`)
} catch (error) {
  failed = true
  console.error('murmur-smoke-failed:', (error as Error).message)
} finally {
  if (!exited) {
    child.kill()
    await Promise.race([new Promise((done) => child.once('exit', done)), wait(10_000)])
  }
  rmSync(userData, { recursive: true, force: true, maxRetries: 5 })
}
process.exit(failed ? 1 : 0)
