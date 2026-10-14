// Draws the desktop app icons from design/icon/*.svg into desktop/resources/:
//
//   icon.icns        macOS: the tile on Apple's icon grid (824 of 1024, soft shadow)
//   icon.ico         Windows: 16–256, the glyph at the smallest sizes
//   icon.png         1024, for anything that wants one big picture
//   icons/NxN.png    Linux: the hicolor sizes electron-builder installs
//
// The results are committed, so packaging never needs a browser. Run again
// after the mark changes: node desktop/scripts/icons.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const root = new URL('../../', import.meta.url)
const out = new URL('desktop/resources/', root)
const svg = (name: string) => `data:image/svg+xml;base64,${readFileSync(new URL(`design/icon/${name}`, root)).toString('base64')}`

const TILE = svg('murmur-icon.svg')
const GLYPH = svg('favicon.svg')

type Shape = {
  /** The tile's share of the canvas. */
  scale: number
  /** Corner radius, as a share of the tile. */
  radius: number
  shadow: string
  /** The glyph alone, no tile: for sizes too small to read the tile. */
  glyph?: boolean
}

// Apple's macOS grid: an 824 tile on a 1024 canvas, corners about 22.5%.
const MAC: Shape = { scale: 824 / 1024, radius: 0.225, shadow: 'drop-shadow(0 1.2% 1.6% rgb(0 0 0 / 0.28))' }
// Windows and Linux icons sit closer to the edge, with a lighter shadow.
const FLAT: Shape = { scale: 0.9, radius: 0.2, shadow: 'drop-shadow(0 0.8% 1% rgb(0 0 0 / 0.2))' }
const SMALL: Shape = { scale: 0.94, radius: 0, shadow: 'none', glyph: true }

async function draw(page: Page, size: number, shape: Shape) {
  const tile = Math.round(size * shape.scale)
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<!doctype html>
    <style>
      html, body { margin: 0; background: transparent }
      body { width: ${size}px; height: ${size}px; display: grid; place-items: center }
      .tile { width: ${tile}px; height: ${tile}px; filter: ${shape.shadow} }
      img { display: block; width: 100%; height: 100%; border-radius: ${shape.radius * 100}% }
    </style>
    <div class="tile"><img src="${shape.glyph ? GLYPH : TILE}"></div>`)
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0))
  return page.screenshot({ omitBackground: true, type: 'png' })
}

/** An .icns of PNG entries: type, length (header included), data. */
function icns(entries: [type: string, png: Buffer][]) {
  const chunks = entries.map(([type, png]) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4)
  return Buffer.concat([head, ...chunks])
}

/** An .ico of PNG entries (Windows Vista and later read PNG directly). */
function ico(entries: [size: number, png: Buffer][]) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2) // type: icon
  head.writeUInt16LE(entries.length, 4)
  let offset = 6 + 16 * entries.length
  const dir = entries.map(([size, png]) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([head, ...dir, ...entries.map(([, png]) => png)])
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  mkdirSync(new URL('icons/', out), { recursive: true })

  const mac = new Map<number, Buffer>()
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) mac.set(size, await draw(page, size, MAC))
  writeFileSync(
    new URL('icon.icns', out),
    icns([
      ['icp4', mac.get(16)!],
      ['icp5', mac.get(32)!],
      ['ic11', mac.get(32)!],
      ['ic12', mac.get(64)!],
      ['ic07', mac.get(128)!],
      ['ic08', mac.get(256)!],
      ['ic13', mac.get(256)!],
      ['ic09', mac.get(512)!],
      ['ic14', mac.get(512)!],
      ['ic10', mac.get(1024)!],
    ]),
  )

  const flat = new Map<number, Buffer>()
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) flat.set(size, await draw(page, size, size <= 32 ? SMALL : FLAT))
  writeFileSync(new URL('icon.ico', out), ico([16, 24, 32, 48, 64, 128, 256].map((size) => [size, flat.get(size)!])))
  writeFileSync(new URL('icon.png', out), flat.get(1024)!)
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) writeFileSync(new URL(`icons/${size}x${size}.png`, out), flat.get(size)!)
  console.log(`Icons written to ${out.pathname}`)
} finally {
  await browser.close()
}
