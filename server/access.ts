// Murmur's own front door, for standalone installs. With MURMUR_PASSWORD set,
// Hermes (/hermes/*, the socket) and Murmur's settings API need a signed,
// HttpOnly session cookie. The web app itself stays public: it is static code
// with no secrets, and it has to load to show the sign-in screen.
//
// On umbrelOS MURMUR_PASSWORD is unset; umbrelOS's app proxy signs people in.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type http from 'node:http'
import { sessionSecret } from './config.ts'
import { appendCookie, readCookie, readJson, secure, sendJson } from './http.ts'

const COOKIE = 'murmur_session'
const MAX_AGE_S = 30 * 24 * 60 * 60
const WINDOW_MS = 10 * 60_000
const MAX_ATTEMPTS = 10

const password = process.env.MURMUR_PASSWORD || null
// Changing MURMUR_PASSWORD signs everyone out: the key depends on it.
const key = password ? createHmac('sha256', sessionSecret()).update(`murmur-session\0${password}`).digest() : null
const attempts = new Map<string, number[]>()
const signedOut = new Set<(session: string) => void>()

export const accessRequired = Boolean(password)

const sha = (value: string) => createHash('sha256').update(value).digest()
const sign = (payload: string) => createHmac('sha256', key!).update(payload).digest('base64url')

/** Called with the sign-in being ended, so sockets it opened can be closed. */
export const onSignOut = (fn: (session: string) => void) => signedOut.add(fn)

/** This request's sign-in (its cookie), or null without one. */
export const cookieValue = (req: http.IncomingMessage) => readCookie(req, COOKIE)

/** True when the request may reach Hermes. */
export function isSignedIn(req: http.IncomingMessage) {
  if (!key) return true
  const [expires, mac] = (cookieValue(req) ?? '').split('.')
  if (!expires || !mac || Number(expires) < Date.now()) return false
  const expected = Buffer.from(sign(expires))
  const given = Buffer.from(mac)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

function setCookie(req: http.IncomingMessage, value: string, maxAge: number) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure(req) ? '; Secure' : ''}`
}

function rateLimited(ip: string) {
  const now = Date.now()
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  attempts.set(ip, recent)
  if (recent.length >= MAX_ATTEMPTS) return Math.ceil((recent[0] + WINDOW_MS - now) / 1000)
  recent.push(now)
  return 0
}

/** Handles /murmur/session, /murmur/login and /murmur/logout. Returns false for other paths. */
export async function handleAccess(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
  if (path === '/murmur/session' && req.method === 'GET') {
    sendJson(res, 200, { required: accessRequired, signedIn: isSignedIn(req) })
    return true
  }
  if (path === '/murmur/logout' && req.method === 'POST') {
    appendCookie(res, setCookie(req, '', 0))
    const session = cookieValue(req)
    if (session) for (const fn of signedOut) fn(session)
    sendJson(res, 200, { ok: true })
    return true
  }
  if (path !== '/murmur/login' || req.method !== 'POST') return false

  if (!password || !key) {
    sendJson(res, 200, { ok: true })
    return true
  }
  const ip = req.socket.remoteAddress ?? ''
  const wait = rateLimited(ip)
  if (wait) {
    res.setHeader('retry-after', String(wait))
    sendJson(res, 429, { error: 'Too many tries. Wait a few minutes, then try again.' })
    return true
  }
  const body = (await readJson(req).catch(() => null)) as { password?: unknown } | null
  const given = typeof body?.password === 'string' ? body.password : ''
  // Compare digests so neither the length nor the content leaks through timing.
  if (!timingSafeEqual(sha(given), sha(password))) {
    await new Promise((r) => setTimeout(r, 400))
    sendJson(res, 401, { error: 'That password didn’t work.' })
    return true
  }
  attempts.delete(ip)
  const expires = String(Date.now() + MAX_AGE_S * 1000)
  appendCookie(res, setCookie(req, `${expires}.${sign(expires)}`, MAX_AGE_S))
  sendJson(res, 200, { ok: true })
  return true
}
