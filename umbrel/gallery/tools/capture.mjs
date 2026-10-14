// Takes the store screenshots from a Murmur running on the seeded demo Hermes:
// 1440×900, drawn at 2x and scaled down for crisp type, saved as JPEG into
// umbrel/gallery/murmur/ in the order umbrel-app.yml lists them.
//
//   MURMUR_URL=http://localhost:3217 GROUP=<id from seed.mjs> \
//   node umbrel/gallery/tools/capture.mjs [1-5]

import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const BASE = process.env.MURMUR_URL ?? 'http://localhost:3000'
const { GROUP } = process.env
const OUT = new URL('../murmur/', import.meta.url)
const only = process.argv[2]
const W = 1440
const H = 900

const browser = await chromium.launch()

async function open(path, { scheme = 'light', welcomed = true } = {}) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: scheme })
  if (welcomed) await context.addInitScript(() => localStorage.setItem('murmur:welcomed', '1'))
  const page = await context.newPage()
  page.on('pageerror', (e) => console.error('page error:', e.message))
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  return page
}

/** Pointer out of the way and animations at rest, then a 2x capture scaled to 1440×900. */
async function save(page, n, wait = 2000) {
  await page.mouse.move(W - 1, H - 1)
  await page.waitForTimeout(wait)
  const png = await page.screenshot()
  const scaler = await browser.newPage({ viewport: { width: W, height: H } })
  const jpeg = await scaler.evaluate(
    async ({ src, w, h }) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h })
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, w, h)
      return canvas.toDataURL('image/jpeg', 0.9)
    },
    { src: `data:image/png;base64,${png.toString('base64')}`, w: W, h: H },
  )
  await scaler.close()
  writeFileSync(new URL(`${n}.jpg`, OUT), Buffer.from(jpeg.split(',')[1], 'base64'))
  console.log(`${n}.jpg`, page.url())
}

const done = (page) => page.context().close()

const want = (n) => !only || only === String(n)

// 2 comes first: its chat is sent live (approvals only exist live), then
// allowed, so the other shots show a settled Hermes.
if (want(2)) {
  const page = await open('/chat/default')
  const box = page.getByPlaceholder(/Message Hermes/)
  await box.click()
  await box.pressSequentially('My Umbrel is nearly full. Can you clear out the old phone backups in Downloads?', { delay: 4 })
  await page.keyboard.press('Enter')
  await page.getByText(/check with you first/).waitFor({ timeout: 60_000 })
  await page.getByText(/^Searched files and ran a command/).first().click()
  // Hermes names the chat a moment later; the sidebar reads better with it.
  await page.getByText('Clear out old phone backups').first().waitFor({ timeout: 20_000 }).catch(() => {})
  await save(page, 2, 2400)
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
  await page.getByText(/41 GB free again/).waitFor({ timeout: 60_000 })
  await page.waitForTimeout(3000)
  await done(page)
}

// 1: home, every agent at a glance beside the sidebar.
if (want(1)) {
  const page = await open('/agents')
  await save(page, 1, 2500)
  await done(page)
}

// 3: a group, in dark.
if (want(3)) {
  if (!GROUP) throw new Error('Set GROUP to the id seed.mjs printed.')
  const page = await open(`/group/${GROUP}`, { scheme: 'dark' })
  await save(page, 3, 2500)
  await done(page)
}

// 4: the agent templates, from New agent.
if (want(4)) {
  const page = await open('/agents')
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /New agent/ }).first().click()
  await save(page, 4, 1500)
  await done(page)
}

// 5: the welcome, once its murmuration has settled into the mark.
if (want(5)) {
  const page = await open('/welcome', { scheme: 'dark', welcomed: false })
  await save(page, 5, 6000)
  await done(page)
}

await browser.close()
