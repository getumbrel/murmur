import { EventEmitter } from 'node:events'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useEnv } from './config.ts'
import { handleSiteIcon, iconsIn, imageType, isPublic, siteName } from './site-icons.ts'

/** A PNG's first bytes, as wide as asked. */
const png = (width: number) => {
  const head = Buffer.alloc(33)
  Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(head)
  head.writeUInt32BE(13, 8)
  head.write('IHDR', 12, 'latin1')
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(width, 20)
  return head
}

describe('which sites Murmur asks for an icon', () => {
  it('is a public site’s name, never an address, a port or a name on this network', () => {
    expect(siteName('github.com')).toBe('github.com')
    expect(siteName(' App.Notion.so. ')).toBe('app.notion.so')
    expect(siteName('xn--80ak6aa92e.com')).toBe('xn--80ak6aa92e.com')
    for (const host of ['', 'umbrel', 'localhost', 'umbrel.local', 'hermes.internal', 'router.lan', 'example.test']) {
      expect(siteName(host)).toBeNull()
    }
    for (const host of [
      '192.168.1.1',
      '10.0.0.1',
      '[::1]',
      'github.com:8443',
      'a..b.com',
      '-a.com',
      'a.com/x',
      'a b.com',
    ]) {
      expect(siteName(host)).toBeNull()
    }
  })

  it('reaches only addresses on the public internet', () => {
    for (const address of ['8.8.8.8', '140.82.112.3', '2606:4700::1111', '2a00:1450:4001:80b::200e']) {
      expect(isPublic(address)).toBe(true)
    }
    for (const address of [
      '127.0.0.1',
      '10.21.0.4',
      '172.17.0.1',
      '192.168.1.10',
      '100.101.102.103', // Tailscale
      '169.254.169.254',
      '0.0.0.0',
      '224.0.0.251',
      '255.255.255.255',
      '::1',
      '::',
      'fd7a:115c:a1e0::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
      '2002:a00:1::',
      '2001:db8::1',
      'not an address',
    ]) {
      expect(isPublic(address)).toBe(false)
    }
  })
})

describe('where a site’s icon is', () => {
  const page = new URL('https://www.example.com/en/')

  it('is the one for a phone’s Home Screen first, then the largest, and never an SVG', () => {
    const html = `<html><head>
      <link rel="icon" href="/favicon-32.png" sizes="32x32">
      <link rel="icon" type="image/svg+xml" href="/icon.svg">
      <link rel="mask-icon" href="/pinned.svg" color="#000">
      <link rel='icon' href='https://cdn.example.com/icon-192.png?v=2&amp;s=1' sizes='192x192'>
      <link href="touch.png" rel="apple-touch-icon">
      <link rel="stylesheet" href="/app.css">
    </head></html>`
    expect(iconsIn(html, page).map(String)).toEqual([
      'https://www.example.com/en/touch.png',
      'https://cdn.example.com/icon-192.png?v=2&s=1',
      'https://www.example.com/apple-touch-icon.png',
      'https://www.example.com/favicon-32.png',
      'https://www.example.com/favicon.ico',
    ])
  })

  it('is where a phone looks when a page names none for it, ahead of a favicon too small for a tile', () => {
    const small = `<link rel="alternate icon" type="image/png" href="https://cdn.example.com/favicon.png">`
    expect(iconsIn(small, page).map(String)).toEqual([
      'https://www.example.com/apple-touch-icon.png',
      'https://cdn.example.com/favicon.png',
      'https://www.example.com/favicon.ico',
    ])
    const big = `<link href="/favicon/64x64.png" rel="icon shortcut" sizes="64x64" />`
    expect(iconsIn(big, page).map((u) => u.pathname)).toEqual([
      '/favicon/64x64.png',
      '/apple-touch-icon.png',
      '/favicon.ico',
    ])
    expect(iconsIn('', page).map((u) => u.pathname)).toEqual(['/apple-touch-icon.png', '/favicon.ico'])
  })

  it('trusts a size a page states over one it leaves out', () => {
    const html = `<link rel="apple-touch-icon" href="/touch.png">
      <link rel="apple-touch-icon" sizes="180x180" href="/touch-180.png">
      <link rel="icon" href="/favicon.png">
      <link rel="icon" sizes="32x32" href="/favicon-32.png">`
    expect(iconsIn(html, page).map((u) => u.pathname)).toEqual([
      '/touch-180.png',
      '/touch.png',
      '/apple-touch-icon.png',
      '/favicon-32.png',
      '/favicon.png',
      '/favicon.ico',
    ])
  })

  it('puts an icon meant for dark tabs last', () => {
    const html = `<link rel="icon" href="/dark.png" media="(prefers-color-scheme: dark)" sizes="64x64">
      <link rel="alternate icon" href="/light.png">`
    expect(iconsIn(html, page).map((u) => u.pathname)).toEqual([
      '/apple-touch-icon.png',
      '/light.png',
      '/favicon.ico',
      '/dark.png',
    ])
  })
})

describe('what counts as an icon', () => {
  it('is a raster image, told by its bytes', () => {
    expect(imageType(png(180))).toBe('image/png')
    expect(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe('image/jpeg')
    expect(imageType(Buffer.from('GIF89a\x01\x00', 'latin1'))).toBe('image/gif')
    expect(imageType(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe('image/webp')
    expect(imageType(Buffer.from([0, 0, 1, 0, 2, 0, 16, 16]))).toBe('image/x-icon')
  })

  it('is never an SVG, a page, or a pixel', () => {
    expect(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull()
    expect(imageType(Buffer.from('<!doctype html><title>Not found</title>'))).toBeNull()
    expect(imageType(png(1))).toBeNull()
    expect(imageType(Buffer.alloc(0))).toBeNull()
  })
})

describe('GET /murmur/site-icon', () => {
  let dir: string
  let server: http.Server
  let base: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'murmur-site-icons-'))
    useEnv({ DATA_DIR: dir })
    mkdirSync(join(dir, 'site-icons'))
    writeFileSync(join(dir, 'site-icons', 'github.com.icon'), png(180))
    writeFileSync(join(dir, 'site-icons', 'nothing.example.org.none'), '')
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      if (!(await handleSiteIcon(req, res, url))) res.writeHead(418).end()
    })
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(() => vi.restoreAllMocks())

  afterAll(async () => {
    await new Promise((done) => server.close(done))
    useEnv(process.env)
    rmSync(dir, { recursive: true, force: true })
  })

  it('serves an icon it has kept, as an image that can’t run anything', async () => {
    const res = await fetch(`${base}/murmur/site-icon?host=GitHub.com`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'")
    expect(Buffer.from(await res.arrayBuffer()).equals(png(180))).toBe(true)
  })

  it('says there’s none for a site it asked today, and for anything that isn’t a public site, without asking', async () => {
    for (const host of ['nothing.example.org', 'localhost', '192.168.1.1', 'umbrel.local', '']) {
      const started = Date.now()
      const res = await fetch(`${base}/murmur/site-icon?host=${encodeURIComponent(host)}`)
      expect(res.status).toBe(404)
      expect(Date.now() - started).toBeLessThan(500)
    }
  })

  it('remembers no icon for a site that ran out of time, so the next look asks again', async () => {
    // A site that never answers, its ten seconds up as soon as it's asked.
    const asked = vi.spyOn(https, 'get').mockImplementation(((_url: URL, { signal }: { signal: AbortSignal }) => {
      const req = new EventEmitter()
      const cut = () => req.emit('error', signal.reason)
      if (signal.aborted) queueMicrotask(cut)
      else signal.addEventListener('abort', cut, { once: true })
      return req
    }) as unknown as typeof https.get)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort())
    const homes = () => asked.mock.calls.filter(([url]) => String(url) === 'https://slow.example.org/').length
    for (const looks of [1, 2]) {
      const res = await fetch(`${base}/murmur/site-icon?host=slow.example.org`)
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(existsSync(join(dir, 'site-icons', 'slow.example.org.none'))).toBe(false)
      expect(homes()).toBe(looks)
    }
  })

  it('remembers a site that answered with no icon as having none, for a day', async () => {
    vi.spyOn(https, 'get').mockImplementation(((_url: URL, _options: object, answer: (res: object) => void) => {
      queueMicrotask(() => answer({ statusCode: 404, headers: {}, resume() {} }))
      return new EventEmitter()
    }) as unknown as typeof https.get)
    const res = await fetch(`${base}/murmur/site-icon?host=bare.example.org`)
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(existsSync(join(dir, 'site-icons', 'bare.example.org.none'))).toBe(true)
  })

  it('only answers GET', async () => {
    expect((await fetch(`${base}/murmur/site-icon?host=github.com`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/murmur/other`)).status).toBe(418)
  })
})
