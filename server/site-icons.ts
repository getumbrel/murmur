// A saved login's site, the way Passwords shows it: the site's own icon, asked
// of the site itself by Murmur's server, never of a favicon service, so no
// third party hears which sites an agent signs in to. A site Murmur draws
// itself is never asked (src/features/vault/site-icon.tsx).
//
//   GET /murmur/site-icon?host=github.com → the icon (PNG, JPEG, GIF, WebP or
//                                           ICO); 404 when the site has none
//
// Which icon: the one the site's home page names for a phone's Home Screen
// (apple-touch-icon), else a favicon it names of 64px or more, else
// /apple-touch-icon.png (where a phone looks when a page names none), else the
// largest favicon it names, else /favicon.ico. What's found is kept in
// DATA_DIR/site-icons and asked for again after a month; a site with none is
// asked again after a day, and one that ran out of time when next looked at.
//
// The site hears no more than a browser's visit tells it. Every address a name
// resolves to, on every redirect, must be on the public internet, so a saved
// login can't point Murmur's server at this Umbrel, its network or its
// containers. Only raster images are kept, checked by their bytes: an SVG
// could run script if opened at Murmur's own address.

import type http from 'node:http'
import https from 'node:https'
import { lookup, type LookupAddress, type LookupOptions } from 'node:dns'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { BlockList, isIP } from 'node:net'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { dataDir } from './config.ts'
import { sendJson } from './http.ts'

const KEEP_MS = 30 * 24 * 60 * 60 * 1000
const RETRY_MS = 24 * 60 * 60 * 1000
/** For everything one site is asked, redirects included. */
const ASK_MS = 10_000
const PAGE_BYTES = 512 * 1024
const ICON_BYTES = 512 * 1024
const HOPS = 4
// Sites give a browser their real page, icons and all; some turn anything else away.
const AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

// ── Public sites only ───────────────────────────────────────────────────────

const NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const LOCAL = /\.(?:local|localhost|internal|lan|home|arpa|test|example|invalid|onion)$/

/** A site's name as a saved login has it ("github.com"), or null for anything that isn't a public site's: an address, a port, a name on this network. */
export function siteName(raw: string | null) {
  const host = (raw ?? '').trim().toLowerCase().replace(/\.$/, '')
  return NAME.test(host) && !LOCAL.test(host) ? host : null
}

// Everything that isn't the public internet: this machine, private and shared
// networks (Tailscale's among them), link-local, documentation, multicast, and
// the IPv6 forms that can carry an IPv4 address inside.
const PRIVATE = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  PRIVATE.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const)
  PRIVATE.addSubnet(net, prefix, 'ipv6')

/** Whether an address is on the public internet. IPv6 must be global unicast (2000::/3). */
export function isPublic(address: string) {
  const family = isIP(address)
  if (family === 4) return !PRIVATE.check(address, 'ipv4')
  return family === 6 && /^[23][0-9a-f]{0,3}:/i.test(address) && !PRIVATE.check(address, 'ipv6')
}

/** Resolves a name for a request, refusing it unless every address the name has is public. */
function publicOnly(
  hostname: string,
  options: LookupOptions,
  done: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return done(error, '')
    if (!addresses.length || !addresses.every((a) => isPublic(a.address))) {
      return done(Object.assign(new Error(`${hostname} isn’t on the public internet`), { code: 'ENOTPUBLIC' }), '')
    }
    if (options.all) done(null, addresses)
    else done(null, addresses[0].address, addresses[0].family)
  })
}

// ── Asking the site ─────────────────────────────────────────────────────────

type Got = { url: URL; body: Buffer }
type Wanted = { accept: string; limit: number; signal: AbortSignal; /** Read as far as its head. */ page?: boolean }

/**
 * A GET of a public site's https address, following its redirects; null when
 * nothing's there. A page is read as far as its head (or `limit`); anything
 * else longer than `limit` is nothing.
 */
function get(url: URL, wanted: Wanted, hops = HOPS): Promise<Got | null> {
  const { accept, limit, signal, page } = wanted
  if (url.protocol !== 'https:' || url.port || url.username || isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
    return Promise.resolve(null)
  }
  return new Promise((done) => {
    let settled = false
    const settle = (got: Got | null) => {
      if (settled) return
      settled = true
      done(got)
    }
    const headers = { 'user-agent': AGENT, accept, 'accept-encoding': 'gzip, br' }
    const req = https.get(url, { lookup: publicOnly, signal, headers }, (res) => {
      const status = res.statusCode ?? 0
      const to = res.headers.location
      if (status >= 300 && status < 400 && to && hops > 0 && URL.canParse(to, url)) {
        res.resume()
        return void get(new URL(to, url), wanted, hops - 1).then(settle)
      }
      if (status !== 200) {
        res.resume()
        return settle(null)
      }
      const encoding = res.headers['content-encoding']
      const body: Readable =
        encoding === 'gzip'
          ? res.pipe(createGunzip())
          : encoding === 'br'
            ? res.pipe(createBrotliDecompress())
            : encoding === 'deflate'
              ? res.pipe(createInflate())
              : res
      const chunks: Buffer[] = []
      let size = 0
      const end = () => {
        res.destroy()
        settle(page || size <= limit ? { url, body: Buffer.concat(chunks) } : null)
      }
      body.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        size += chunk.length
        if (size > limit || (page && chunk.includes('</head'))) end()
      })
      body.on('end', end)
      body.on('error', () => (page && size ? end() : settle(null)))
      // Cut off before the end: a page's head may still be whole, an image isn't.
      res.on('close', () => !res.complete && (page && size ? end() : settle(null)))
    })
    req.on('error', () => settle(null))
  })
}

const entity = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&amp;/g, '&')
const ATTR = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g

/**
 * Where a page's icon is, best first: the one its <link>s name for a phone's
 * Home Screen, then a favicon it says is big enough to fill a tile (64px), then
 * where a phone looks when a page names none, then the largest other favicon,
 * then /favicon.ico. SVGs are left out, and an icon for dark tabs comes last,
 * since the app shows icons on white.
 */
export function iconsIn(html: string, page: URL): URL[] {
  const found = [
    { url: new URL('/apple-touch-icon.png', page), rank: 63 },
    { url: new URL('/favicon.ico', page), rank: 0 },
  ]
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = new Map<string, string>()
    for (const m of tag.slice(5).matchAll(ATTR)) attrs.set(m[1].toLowerCase(), entity(m[2] ?? m[3] ?? m[4] ?? ''))
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/)
    const href = attrs.get('href')
    const touch = rel.some((r) => r.startsWith('apple-touch-icon'))
    if (!href || !(touch || rel.includes('icon')) || !URL.canParse(href, page)) continue
    if ((attrs.get('type') ?? '').includes('svg') || /\.svg(?:$|[?#])/i.test(href)) continue
    const size = Math.max(0, ...(attrs.get('sizes') ?? '').split(/\s+/).map((s) => parseInt(s, 10) || 0))
    const dark = /dark/i.test(attrs.get('media') ?? '')
    found.push({
      url: new URL(href, page),
      // Unsized, a touch icon is likely 180 and a favicon 32, but one that says so wins.
      rank: (touch ? 1000 : 0) + (size || (touch ? 179 : 31)) - (dark ? 2000 : 0),
    })
  }
  return found.sort((a, b) => b.rank - a.rank).map((f) => f.url)
}

/** What an image is, by its first bytes: one this serves, else null (an SVG, an error page, a 1×1 pixel). */
export function imageType(body: Buffer) {
  const head = body.subarray(0, 12).toString('latin1')
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return body.length > 24 && body.readUInt32BE(16) >= 16 ? 'image/png' : null
  if (head.startsWith('\xff\xd8\xff')) return 'image/jpeg'
  if (head.startsWith('GIF8')) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  if (head.startsWith('\0\0\x01\0')) return 'image/x-icon'
  return null
}

/** The site's icon: the best its home page names, else one at the usual addresses; `late` when it ran out of time. */
async function find(host: string) {
  const signal = AbortSignal.timeout(ASK_MS)
  const home = new URL(`https://${host}/`)
  const page = await get(home, { accept: 'text/html,application/xhtml+xml', limit: PAGE_BYTES, signal, page: true })
  const tries = [...new Set(iconsIn(page?.body.toString('utf8') ?? '', page?.url ?? home).map(String))].slice(0, 6)
  for (const url of tries) {
    const icon = await get(new URL(url), { accept: 'image/png,image/webp,image/*;q=0.8', limit: ICON_BYTES, signal })
    if (icon && imageType(icon.body)) return { icon: icon.body, late: false }
  }
  return { icon: null, late: signal.aborted }
}

// ── Kept on this Murmur ─────────────────────────────────────────────────────

const iconFile = (host: string) => join(dataDir(), 'site-icons', `${host}.icon`)
const noneFile = (host: string) => join(dataDir(), 'site-icons', `${host}.none`)

const age = (file: string) => {
  try {
    return Date.now() - statSync(file).mtimeMs
  } catch {
    return Infinity
  }
}

function keep(host: string, icon: Buffer | null) {
  mkdirSync(join(dataDir(), 'site-icons'), { recursive: true, mode: 0o700 })
  const file = iconFile(host)
  if (icon) {
    writeFileSync(`${file}.tmp`, icon, { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
    rmSync(noneFile(host), { force: true })
  } else if (existsSync(file)) {
    // The one it had stays, rather than a site that's down today losing its icon.
    const now = new Date()
    utimesSync(file, now, now)
  } else {
    writeFileSync(noneFile(host), '', { mode: 0o600 })
  }
}

const asking = new Map<string, Promise<void>>()

/** Asks the site for its icon and keeps what it says; one ask per site at a time. */
function ask(host: string) {
  let pending = asking.get(host)
  if (!pending) {
    pending = find(host)
      .then(({ icon, late }) => {
        // Out of time, it keeps nothing at all, so the next look asks again.
        if (!late) keep(host, icon)
      })
      .catch((error) => console.warn(`Murmur: ${host}’s icon: ${(error as Error).message}`))
      .finally(() => asking.delete(host))
    asking.set(host, pending)
  }
  return pending
}

function read(file: string) {
  try {
    return readFileSync(file)
  } catch {
    return null
  }
}

export async function handleSiteIcon(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (url.pathname !== '/murmur/site-icon') return false
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return true
  }
  const host = siteName(url.searchParams.get('host'))
  /** None, which the browser remembers for a day too, unless it's only that the site ran out of time. */
  const none = (forADay = true) => {
    const cache = forADay ? 'private, max-age=86400' : 'no-store'
    res.writeHead(404, { 'cache-control': cache, 'x-content-type-options': 'nosniff' }).end()
    return true
  }
  if (!host) return none()
  const had = age(iconFile(host))
  if (had > KEEP_MS && age(noneFile(host)) > RETRY_MS) {
    // A first ask waits for the site; a month-old icon shows while it's asked again.
    const asked = ask(host)
    if (had === Infinity) await asked
  }
  const icon = read(iconFile(host))
  const type = icon && imageType(icon)
  if (!icon || !type) return none(existsSync(noneFile(host)))
  res.writeHead(200, {
    'content-type': type,
    'content-length': icon.length,
    'cache-control': 'private, max-age=604800',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  })
  res.end(req.method === 'HEAD' ? undefined : icon)
  return true
}
