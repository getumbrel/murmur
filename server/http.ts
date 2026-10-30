// Small HTTP helpers shared by the server modules.

import type http from 'node:http'
import { isIP } from 'node:net'
import { memo, setting } from './config.ts'

export function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

export async function readJson(req: http.IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new Error('too large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/** The encodings an Accept-Encoding header allows (a q of 0 refuses one; `*` allows any not named). */
export function accepted(header: string | string[] | undefined) {
  const allowed = new Set<string>()
  const refused = new Set<string>()
  for (const part of String(header ?? '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';')
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    if (q && Number(q.slice(2)) === 0) refused.add(name.trim())
    else allowed.add(name.trim())
  }
  return (encoding: string) => !refused.has(encoding) && (allowed.has(encoding) || allowed.has('*'))
}

/** One cookie from the request, or null. */
export function readCookie(req: http.IncomingMessage, name: string) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

/** Adds a Set-Cookie line, keeping any already set on this response. */
export function appendCookie(res: http.ServerResponse, line: string) {
  const set = res.getHeader('set-cookie')
  res.setHeader('set-cookie', [...(Array.isArray(set) ? set : set ? [String(set)] : []), line])
}

/** Whether the browser reached Murmur over HTTPS (directly, or through a proxy that says so). */
export const secure = (req: http.IncomingMessage) =>
  Boolean((req.socket as { encrypted?: boolean }).encrypted) || req.headers['x-forwarded-proto'] === 'https'

/** The request target, parsed once. Null when it is malformed (bad escapes, a broken absolute URL). */
export function requestUrl(req: http.IncomingMessage) {
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    decodeURIComponent(url.pathname)
    return url
  } catch {
    return null
  }
}

const list = (value = '') =>
  value
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean)

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
const allowedOrigins = memo(() => new Set(list(setting('MURMUR_ALLOWED_ORIGINS'))))
const allowedHosts = memo(() => [
  ...list(setting('MURMUR_ALLOWED_HOSTS')),
  ...[...allowedOrigins()].flatMap((origin) => (URL.canParse(origin) ? [new URL(origin).hostname] : [])),
])

const hostname = (host: string) => (URL.canParse(`http://${host}`) ? new URL(`http://${host}`).hostname.replace(/\.$/, '') : null)

/**
 * DNS-rebinding guard, the same model as Vite's `server.allowedHosts`. A page
 * on attacker.example can point its own name at this machine and then talk to
 * Murmur "same-origin", so the name the browser used must be one the attacker
 * can't control: an IP, localhost, a single-label LAN name, *.local, a
 * Tailscale *.ts.net name, or one listed in MURMUR_ALLOWED_HOSTS (a leading dot
 * allows subdomains; `*` turns the check off) or MURMUR_ALLOWED_ORIGINS.
 */
export function hostAllowed(req: http.IncomingMessage) {
  const allowed = allowedHosts()
  if (!req.headers.host || allowed.includes('*')) return true
  const name = hostname(req.headers.host)
  if (!name) return false
  if (isIP(name.replace(/^\[|\]$/g, '')) || !name.includes('.') || /\.(localhost|local|ts\.net)$/.test(name)) return true
  return allowed.some((h) => h === name || (h.startsWith('.') && (name.endsWith(h) || name === h.slice(1))))
}

/**
 * Cross-site request guard. Murmur holds Hermes's credentials, so a page on
 * another site must not be able to open its socket (WebSockets ignore CORS) or
 * post to it. Browsers always send Origin on those requests; it must match the
 * host the browser reached (umbrelOS's app proxy keeps Host and adds
 * X-Forwarded-Host). Both sides on loopback is fine (the Vite dev proxy).
 */
export function originAllowed(req: http.IncomingMessage) {
  const origin = req.headers.origin
  if (!origin) return true
  const allowed = allowedOrigins()
  if (allowed.has('*') || allowed.has(origin.toLowerCase())) return true
  if (!URL.canParse(origin)) return false
  const url = new URL(origin)
  const hosts = [req.headers.host, ...String(req.headers['x-forwarded-host'] ?? '').split(',')].map((h) => h?.trim())
  if (hosts.includes(url.host)) return true
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  return LOOPBACK.has(url.hostname) && LOOPBACK.has(host)
}
