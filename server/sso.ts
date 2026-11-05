// Signing in to a Hermes with single sign-on: an OIDC provider such as
// Authentik or Keycloak in front of its dashboard. Murmur's server does what
// Hermes Desktop does, with Hermes's native-app sign-in (RFC 8252 + PKCE):
//
//   POST /murmur/sign-in        {url} or {found: id} → {id, address, returns}
//                               Opens a sign-in. The browser shows `address`
//                               (Hermes, which sends it on to the provider).
//   GET  /murmur/sign-in/return ?code&state, public: where Hermes sends the
//                               browser back, when it's on this computer.
//   POST /murmur/sign-in/:id    {address}: the address the sign-in ended on,
//                               pasted, when the browser is somewhere else.
//   GET  /murmur/sign-in/:id    → {status: 'waiting' | 'ready' | 'failed', error?}
//                               ('failed' is final: start again)
//
// Then the usual connection calls take `{url, signIn: id}` in place of a
// username and password (connection.ts), so a sign-in adds, updates or
// re-signs-in a Hermes the way a password does.
//
// The browser opens the sign-in at Hermes's public address, which may not be
// the one Murmur uses (a container's name, or localhost for 127.0.0.1): Hermes
// keeps the sign-in's state in a cookie for the address its provider sends the
// browser back to, so the sign-in has to start there too.
//
// Hermes only ever sends a sign-in back to a loopback address (127.0.0.1), on
// the computer the browser runs on. When that's Murmur's computer (the desktop
// app, or Murmur at localhost) it comes straight back here (`returns: 'here'`).
// Anywhere else the browser lands on a page that can't load, and the person
// pastes its address into Murmur (`returns: 'paste'`). Either way the code in
// it is useless without the PKCE verifier, which never leaves this server, and
// Hermes takes it once, for two minutes.

import type http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { normalizeUrl, UrlError, type Sso } from './config.ts'
import { candidateById } from './discovery.ts'
import { readJson, sendJson } from './http.ts'
import { sendReturnPage } from './oauth-return.ts'

export const SIGN_IN_RETURN = '/murmur/sign-in/return'

/** A sign-in that worked: what a connection call takes in place of a password. */
export type Grant = Sso & { url: string; access: string; expiresAt: number }

type Pending = {
  id: string
  /** Rides through the browser and the provider; never the id the page holds. */
  state: string
  url: string
  verifier: string
  createdAt: number
  grant?: Grant
  error?: string
  /** Being redeemed: a second return of the same code waits for the first. */
  redeeming?: Promise<void>
}

/** As long as Hermes keeps a sign-in open, then as long as a finished one waits to be used. */
const OPEN_MS = 10 * 60_000
const MAX_OPEN = 32

const pending = new Map<string, Pending>()

const COPY = {
  notSso: 'This Hermes doesn’t sign in with single sign-on.',
  unreachable: 'Couldn’t reach that address. Check that Hermes is running and the address is right.',
  expired: 'That sign-in took too long. Start again.',
  stale: 'That sign-in timed out. Start again, then paste the address within two minutes.',
  otherSignIn: 'That address is from a different sign-in. Paste the one this sign-in ended on.',
  noCode: 'Paste the whole address the sign-in ended on. It starts with http://127.0.0.1.',
  noRefresh:
    'Hermes signed you in, but only for a few minutes. Add offline_access to its OIDC scopes (HERMES_DASHBOARD_OIDC_SCOPES) so it can keep you signed in, then try again.',
  busy: 'Too many sign-ins are open. Try again in a few minutes.',
  gone: 'That Hermes isn’t answering anymore.',
  /** On the sign-in tab, when Murmur's own tab says what went wrong. */
  seeWhy: 'Head back to Murmur to see why.',
}

const base64url = (bytes: Buffer) => bytes.toString('base64url')
const sweep = () => {
  for (const [id, p] of pending) if (Date.now() - p.createdAt > OPEN_MS) pending.delete(id)
}

class SignInError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) })
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null
  } catch {
    throw new SignInError(422, COPY.unreachable)
  }
}

/**
 * `provider`: the one to go straight to, or '' for Hermes's own choice among
 * several. `any`: one of them, to ask Hermes where it lives.
 */
async function ssoProviders(url: string): Promise<{ provider: string; any: string }> {
  const status = await getJson(`${url}/api/status`)
  const flows = status?.auth_flows
  if (!status?.auth_required || !Array.isArray(flows) || !flows.includes('native_pkce'))
    throw new SignInError(422, COPY.notSso)
  const body = await getJson(`${url}/api/auth/providers`)
  const providers = Array.isArray(body?.providers)
    ? (body.providers as { name?: unknown; supports_password?: unknown }[])
    : []
  const sso = providers.filter((p) => !p.supports_password && typeof p.name === 'string')
  if (!sso.length) throw new SignInError(422, COPY.notSso)
  const any = sso[0].name as string
  return { provider: sso.length === 1 ? any : '', any }
}

const CALLBACK = '/auth/callback'
/** Hermes's public address, by the address Murmur uses, for as long as a sign-in stays open. */
const publicBases = new Map<string, { base: string; at: number }>()

/**
 * Where a browser opens Hermes's sign-in. Hermes sends its provider a return
 * to its own /auth/callback at its public address (HERMES_DASHBOARD_PUBLIC_URL),
 * so a sign-in Murmur's server starts and never finishes says where that is.
 * Without one it's the address Murmur used, as it is when Hermes can't say.
 */
async function publicBase(url: string, provider: string): Promise<string> {
  const kept = publicBases.get(url)
  if (kept && Date.now() - kept.at < OPEN_MS) return kept.base
  let base = url
  try {
    const ask = authorizeUrl(
      url,
      provider,
      base64url(randomBytes(32)),
      base64url(randomBytes(24)),
      returnAddress(undefined).address,
    )
    const res = await fetch(ask, { redirect: 'manual', signal: AbortSignal.timeout(8000) })
    const next = res.headers.get('location')
    const back = next && URL.canParse(next, url) ? new URL(next, url).searchParams.get('redirect_uri') : null
    if (back && /^https?:\/\/[^/]/.test(back) && URL.canParse(back) && new URL(back).pathname.endsWith(CALLBACK))
      base = normalizeUrl(back.slice(0, back.lastIndexOf(CALLBACK)))
  } catch {
    // Hermes's sign-in then opens where Murmur reaches it.
  }
  publicBases.set(url, { base, at: Date.now() })
  return base
}

function authorizeUrl(base: string, provider: string, challenge: string, state: string, redirect: string) {
  const authorize = new URL(`${base}/auth/native/authorize`)
  if (provider) authorize.searchParams.set('provider', provider)
  authorize.searchParams.set('code_challenge', challenge)
  authorize.searchParams.set('code_challenge_method', 'S256')
  authorize.searchParams.set('redirect_uri', redirect)
  authorize.searchParams.set('state', state)
  return authorize
}

/**
 * Where Hermes sends the browser back. The page's own origin says where the
 * browser is: on this computer (a loopback origin), Murmur's server at that
 * port; anywhere else, nowhere it can load, for the address to be pasted.
 */
export function returnAddress(origin: string | undefined): { address: string; here: boolean } {
  const page = origin && URL.canParse(origin) ? new URL(origin) : null
  const host = page?.hostname ?? ''
  const here = page?.protocol === 'http:' && (host === 'localhost' || /^127\./.test(host) || host === '[::1]')
  if (!here) return { address: `http://127.0.0.1${SIGN_IN_RETURN}`, here: false }
  // Hermes takes only IP literals, never "localhost" (RFC 8252 §8.3).
  return {
    address: `http://${host === '[::1]' ? '[::1]' : '127.0.0.1'}${page.port ? `:${page.port}` : ''}${SIGN_IN_RETURN}`,
    here: true,
  }
}

/** The Hermes a sign-in is for: an address, or one Murmur found (by id, so it's always the server's address). */
function hermesUrl(body: { url?: unknown; found?: unknown }) {
  if (body.found === undefined) return normalizeUrl(body.url)
  const found = candidateById(body.found)
  if (!found) throw new SignInError(404, COPY.gone)
  return normalizeUrl(found.url)
}

async function start(req: http.IncomingMessage, body: { url?: unknown; found?: unknown }) {
  const url = hermesUrl(body)
  const { provider, any } = await ssoProviders(url)
  const base = await publicBase(url, any)
  sweep()
  if (pending.size >= MAX_OPEN) throw new SignInError(429, COPY.busy)
  const verifier = base64url(randomBytes(32))
  const open: Pending = {
    id: base64url(randomBytes(18)),
    state: base64url(randomBytes(24)),
    url,
    verifier,
    createdAt: Date.now(),
  }
  pending.set(open.id, open)
  const { address: redirect, here } = returnAddress(req.headers.origin)
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const authorize = authorizeUrl(base, provider, challenge, open.state, redirect)
  return { id: open.id, address: authorize.toString(), returns: here ? 'here' : 'paste' }
}

/** Trade the code Hermes sent back for the sign-in's tokens. */
function redeem(open: Pending, code: string) {
  if (open.grant) return Promise.resolve()
  open.redeeming ??= (async () => {
    let res: Response
    try {
      res = await fetch(`${open.url}/auth/native/token`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: open.verifier }),
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      open.error = COPY.unreachable
      return
    }
    const body = (await res.json().catch(() => null)) as {
      access_token?: string
      refresh_token?: string
      expires_at?: number
      provider?: string
    } | null
    if (!res.ok || !body?.access_token || !body.provider) {
      // Hermes keeps a code two minutes, and takes it once.
      open.error = res.status === 400 ? COPY.stale : `Hermes couldn’t finish the sign-in (${res.status}). Try again.`
      return
    }
    if (!body.refresh_token) {
      open.error = COPY.noRefresh
      return
    }
    open.error = undefined
    open.grant = {
      url: open.url,
      provider: body.provider,
      refresh: body.refresh_token,
      access: body.access_token,
      expiresAt: (body.expires_at ?? 0) * 1000,
    }
  })().finally(() => (open.redeeming = undefined))
  return open.redeeming
}

/** The code and state in what was pasted: the whole address, or just its query. */
export function readReturn(text: string): { code: string; state: string } | null {
  const trimmed = text.trim()
  const query = trimmed.includes('?') ? trimmed.slice(trimmed.indexOf('?') + 1) : trimmed
  const params = new URLSearchParams(query.split('#')[0])
  const code = params.get('code')
  const state = params.get('state')
  return code && state ? { code, state } : null
}

const describe = (open: Pending) =>
  open.grant ? { status: 'ready' } : open.error ? { status: 'failed', error: open.error } : { status: 'waiting' }

/** The finished sign-in an id names, once: a connection call takes it in place of a password. */
export function takeGrant(id: unknown, url: string): Grant | null {
  if (typeof id !== 'string') return null
  sweep()
  const open = pending.get(id)
  if (!open?.grant || open.grant.url !== url) return null
  pending.delete(id)
  return open.grant
}

/** Hermes sending the browser back to this computer. Public: the one-time state is what proves it. */
export async function signInReturn(res: http.ServerResponse, url: URL) {
  sweep()
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const open = state ? [...pending.values()].find((p) => p.state === state) : undefined
  if (!open || !code) return sendReturnPage(res, false)
  await redeem(open, code)
  // Murmur's tab says what went wrong.
  sendReturnPage(res, !!open.grant, COPY.seeWhy)
}

export const isSignInReturn = (req: http.IncomingMessage, path: string) =>
  req.method === 'GET' && path === SIGN_IN_RETURN

const ONE = /^\/murmur\/sign-in\/([A-Za-z0-9_-]{16,64})$/

/** The sign-in API (not the return, which app.ts lets through first). */
export async function handleSignIn(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
  if (path === '/murmur/sign-in') {
    if (req.method !== 'POST') return false
    const body = (await readJson(req).catch(() => ({}))) as { url?: unknown; found?: unknown }
    try {
      sendJson(res, 200, await start(req, body))
    } catch (error) {
      if (error instanceof UrlError) sendJson(res, 422, { error: error.message })
      else if (error instanceof SignInError) sendJson(res, error.status, { error: error.message })
      else throw error
    }
    return true
  }
  const one = ONE.exec(path)
  if (!one) return false
  sweep()
  const open = pending.get(one[1])
  if (!open) {
    sendJson(res, 404, { status: 'failed', error: COPY.expired })
    return true
  }
  if (req.method === 'GET') {
    sendJson(res, 200, describe(open))
    return true
  }
  if (req.method !== 'POST') return false
  const body = (await readJson(req).catch(() => ({}))) as { address?: unknown }
  const pasted = typeof body.address === 'string' ? readReturn(body.address) : null
  // Not this sign-in's end: it's still open, for the right address.
  if (!pasted || pasted.state !== open.state) {
    sendJson(res, 422, { status: 'waiting', error: pasted ? COPY.otherSignIn : COPY.noCode })
    return true
  }
  await redeem(open, pasted.code)
  sendJson(res, open.grant ? 200 : 422, describe(open))
  return true
}

/** Tests only. */
export const resetSignIns = () => {
  pending.clear()
  publicBases.clear()
}
