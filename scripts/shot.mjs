// usage: node shot.mjs <url> <out.png> [width] [height] [scheme] [scale]
import { chromium } from '@playwright/test'
const [url, out, w = '390', h = '844', scheme = 'dark', scale = '2'] = process.argv.slice(2)
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +scale, colorScheme: scheme })
await p.goto(url, { waitUntil: 'networkidle' }).catch(() => {})
await p.waitForTimeout(+(process.env.WAIT ?? 600))
await p.screenshot({ path: out })
await b.close()
