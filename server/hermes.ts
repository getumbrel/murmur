// One Hermes backend and how to get in. Two ways, detected from the public
// /api/status (the same probe Hermes Desktop uses for remote gateways):
//
//   token     The dashboard puts its session token in its page (loopback
//             binds, and the Umbrel image behind umbrelOS's own auth). REST
//             sends it as X-Hermes-Session-Token; the socket as ?token=.
//             Or it is given explicitly as HERMES_TOKEN.
//   password  The dashboard is gated (auth_required). Sign in at
//             /auth/password-login, keep the access token in memory, rotate it
//             at /auth/native/refresh, send it as a Bearer token, and mint a
//             single-use ?ticket= at /api/auth/ws-ticket for every socket.
//
// Nothing here ever reaches the browser.

import type { Target } from './config.ts'

export type Mode = 'token' | 'password' | 'unknown'
export type Status = 'connected' | 'unreachable' | 'needs-login' | 'bad-login'

export type ConnectionInfo = {
  url: string
  managed: boolean
  source: Target['source']
  mode: Mode
  status: Status
  hermesVersion?: string
  /** Older than MIN_HERMES_VERSION: reachable, but missing what Murmur needs. */
  outdated?: boolean
  /** The version it needs to reach, when outdated. */
  minVersion?: string
  /** The saved username, so a form can show who Murmur signs in as. */
  username?: string
  error?: string
}

/**
 * The oldest Hermes with every API Murmur uses (0.21.4, tag v2026.9.21): the
 * first with client.capabilities, without which agents can't ask before risky
 * commands. Older ones also lack profiles.*, groups.* and session replay.
 */
export const MIN_HERMES_VERSION = '0.21.4'

/** a < b for dotted versions; anything after the numbers ("+canary…") is ignored. */
export function olderThan(a: string, b: string) {
  const parts = (v: string) => v.split(/[^0-9.]/)[0].split('.').map((n) => Number(n) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0)
  }
  return false
}

export class ConnectError extends Error {
  status: Status
  constructor(status: Status, message: string) {
    super(message)
    this.status = status
  }
}

const COPY = {
  unreachable: 'Couldn’t reach that address. Check that Hermes is running and the address is right.',
  notHermes: 'That doesn’t look like a Hermes dashboard.',
  needsLogin: 'This Hermes needs a username and password.',
  badLogin: 'That username or password didn’t work.',
  rateLimited: 'Too many sign-in attempts. Wait a minute, then try again.',
  unsupported: 'This Hermes signs in a way Murmur doesn’t support yet. Turn on its username and password sign-in.',
  badToken: 'Hermes didn’t accept Murmur’s access key.',
  noToken: 'Hermes didn’t let Murmur in. If it runs on another computer, give it a username and password and sign in here.',
}

const REFRESH_MARGIN_MS = 60_000
const FRESH_MS = 10_000

type Session = { access: string; refresh: string | null; expiresAt: number }

export type Hermes = ReturnType<typeof createHermes>

export function createHermes(target: Target) {
  const base = new URL(target.url)
  const prefix = base.pathname.replace(/\/+$/, '')
  const endpoint = (path: string) => `${base.origin}${prefix}${path}`

  let mode: Mode = 'unknown'
  let version: string | undefined
  let token: string | null = target.token ?? null
  let session: Session | null = null
  let provider = 'basic'

  // Concurrent callers share one probe / sign-in / refresh. Hermes rotates
  // refresh tokens, so two parallel refreshes would be one too many.
  const flights = new Map<string, Promise<unknown>>()
  function once<T>(key: string, run: () => Promise<T>): Promise<T> {
    let flight = flights.get(key) as Promise<T> | undefined
    if (!flight) {
      flight = run().finally(() => flights.delete(key))
      flights.set(key, flight)
    }
    return flight
  }

  async function call(path: string, init: RequestInit = {}, timeout = 8000) {
    try {
      return await fetch(endpoint(path), { redirect: 'manual', ...init, signal: AbortSignal.timeout(timeout) })
    } catch {
      throw new ConnectError('unreachable', COPY.unreachable)
    }
  }

  const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

  // ── Detection ─────────────────────────────────────────────────────────────

  function detect(): Promise<Mode> {
    return once('detect', async () => {
      const res = await call('/api/status', {}, 5000)
      const body = (await res.json().catch(() => null)) as { version?: unknown; auth_required?: unknown } | null
      if (!res.ok || !body || typeof body.version !== 'string' || !('auth_required' in body)) {
        throw new ConnectError('unreachable', COPY.notHermes)
      }
      version = body.version
      mode = target.token ? 'token' : body.auth_required ? 'password' : 'token'
      return mode
    })
  }

  const ensureMode = async () => (mode === 'unknown' ? detect() : mode)

  // ── Token mode ────────────────────────────────────────────────────────────

  function scrape(): Promise<string> {
    return once('scrape', async () => {
      const res = await call('/')
      const html = await res.text().catch(() => '')
      const found = html.match(/__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/)?.[1]
      if (!found) {
        // The dashboard went gated since we last looked.
        if (/__HERMES_AUTH_REQUIRED__\s*=\s*true/.test(html) || res.status === 302) mode = 'unknown'
        throw new ConnectError('needs-login', COPY.noToken)
      }
      token = found
      return found
    })
  }

  // ── Password mode ─────────────────────────────────────────────────────────

  async function pickProvider() {
    const res = await call('/api/auth/providers')
    const body = (await res.json().catch(() => null)) as { providers?: { name: string; supports_password?: boolean }[] } | null
    const providers = body?.providers ?? []
    const password = providers.find((p) => p.supports_password)
    if (providers.length && !password) throw new ConnectError('needs-login', COPY.unsupported)
    return password?.name ?? 'basic'
  }

  function signIn(): Promise<void> {
    return once('auth', async () => {
      if (!target.credentials) throw new ConnectError('needs-login', COPY.needsLogin)
      provider = await pickProvider()
      const res = await postJson('/auth/password-login', { provider, ...target.credentials })
      if (res.status === 401) throw new ConnectError('bad-login', COPY.badLogin)
      if (res.status === 429) throw new ConnectError('bad-login', COPY.rateLimited)
      if (res.status === 404) throw new ConnectError('needs-login', COPY.unsupported)
      if (!res.ok) throw new ConnectError('unreachable', `Hermes couldn’t sign in right now (${res.status}). Try again in a moment.`)
      // The tokens arrive as cookies (named with a __Host-/__Secure- prefix over HTTPS).
      const cookies = readCookies(res.headers.getSetCookie())
      const access = cookies.get('hermes_session_at')
      if (!access) throw new ConnectError('unreachable', COPY.notHermes)
      session = {
        access: access.value,
        refresh: cookies.get('hermes_session_rt')?.value ?? null,
        expiresAt: Date.now() + (access.maxAge ?? 900) * 1000,
      }
    })
  }

  function refresh(): Promise<void> {
    return once('auth', async () => {
      const rt = session?.refresh
      if (rt) {
        const res = await postJson('/auth/native/refresh', { refresh_token: rt, provider })
        if (res.ok) {
          const body = (await res.json()) as { access_token: string; refresh_token?: string | null; expires_at: number }
          session = { access: body.access_token, refresh: body.refresh_token || rt, expiresAt: body.expires_at * 1000 }
          return
        }
        if (res.status !== 400 && res.status !== 401) {
          throw new ConnectError('unreachable', `Hermes couldn’t sign in right now (${res.status}). Try again in a moment.`)
        }
      }
      session = null
    }).then(() => (session ? undefined : signIn()))
  }

  async function bearer(): Promise<string> {
    if (session && session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return session.access
    await (session ? refresh() : signIn())
    return session!.access
  }

  // ── What the proxy uses ───────────────────────────────────────────────────

  /** Headers that authenticate a REST call, plus the credential they carry (for `reject`). */
  async function restAuth(): Promise<{ headers: Record<string, string>; credential: string }> {
    if ((await ensureMode()) === 'password') {
      const access = await bearer()
      return { headers: { authorization: `Bearer ${access}` }, credential: access }
    }
    const value = token ?? (await scrape())
    return { headers: { 'x-hermes-session-token': value }, credential: value }
  }

  /** The query parameter that admits one WebSocket upgrade. */
  async function socketAuth(): Promise<{ param: [string, string]; credential: string }> {
    if ((await ensureMode()) === 'password') {
      for (let attempt = 0; ; attempt++) {
        const access = await bearer()
        const res = await postJson('/api/auth/ws-ticket', {}, { authorization: `Bearer ${access}` })
        if (res.ok) {
          const { ticket } = (await res.json()) as { ticket: string }
          return { param: ['ticket', ticket], credential: access }
        }
        if (attempt || (res.status !== 401 && res.status !== 403)) {
          throw new ConnectError('unreachable', `Hermes refused a connection (${res.status}).`)
        }
        reject(access)
      }
    }
    const value = token ?? (await scrape())
    return { param: ['token', value], credential: value }
  }

  /** The socket's address, with what admits one upgrade on it (a single-use ticket, or the session token). */
  async function socketUrl(): Promise<URL> {
    const auth = await socketAuth()
    const url = new URL(endpoint('/api/ws'))
    url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set(...auth.param)
    return url
  }

  /** Hermes turned this credential away: forget it so the next call gets a fresh one. */
  function reject(credential: string) {
    if (session?.access === credential) session.expiresAt = 0
    if (token === credential && !target.token) {
      token = null
      mode = 'unknown' // re-detect: the dashboard may have restarted gated
    }
  }

  // ── Health ────────────────────────────────────────────────────────────────

  let checked: { info: ConnectionInfo; at: number } | null = null

  async function check(): Promise<ConnectionInfo> {
    const info: ConnectionInfo = {
      url: target.url,
      managed: target.source === 'env' || target.source === 'builtin',
      source: target.source,
      mode,
      status: 'connected',
      username: target.credentials?.username,
    }
    try {
      await detect()
      info.mode = mode
      info.hermesVersion = version
      if (version && olderThan(version, MIN_HERMES_VERSION)) Object.assign(info, { outdated: true, minVersion: MIN_HERMES_VERSION })
      for (let attempt = 0; ; attempt++) {
        const { headers, credential } = await restAuth()
        const res = await call('/api/sessions?limit=1', { headers })
        if (res.ok) break
        if (attempt || (res.status !== 401 && res.status !== 403)) {
          if (res.status === 401 || res.status === 403) {
            throw new ConnectError('bad-login', mode === 'password' ? COPY.badLogin : target.token ? COPY.badToken : COPY.noToken)
          }
          throw new ConnectError('unreachable', `Hermes isn’t answering properly (${res.status}). Try again in a moment.`)
        }
        reject(credential)
        if (mode === 'unknown') await detect()
      }
    } catch (error) {
      info.mode = mode
      info.status = error instanceof ConnectError ? error.status : 'unreachable'
      info.error = error instanceof ConnectError ? error.message : COPY.unreachable
    }
    checked = { info, at: Date.now() }
    return info
  }

  /** The last check if it's recent, else a new one: lists of several Hermes stay quick. */
  const status = (): Promise<ConnectionInfo> =>
    checked && Date.now() - checked.at < FRESH_MS ? Promise.resolve(checked.info) : once('check', check)

  // ── A quick look ──────────────────────────────────────────────────────────

  /** A signed-in REST read, or null when it didn't answer with JSON (setup.ts). */
  async function read<T>(path: string, timeout = 3000): Promise<T | null> {
    try {
      const { headers } = await restAuth()
      const res = await call(path, { headers }, timeout)
      return res.ok ? ((await res.json()) as T) : null
    } catch {
      return null
    }
  }

  /** A signed-in JSON write: whether Hermes took it. */
  async function write(method: string, path: string, body: unknown, timeout = 8000): Promise<boolean> {
    try {
      const { headers } = await restAuth()
      const res = await call(path, { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }, timeout)
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * A signed-in JSON call that keeps Hermes's answer: its status and body
   * (null when it wasn't JSON). A stale credential is swapped once. Throws a
   * ConnectError when Hermes couldn't be reached or signed in to (telegram.ts).
   */
  async function send<T>(method: string, path: string, body?: unknown, timeout = 15_000): Promise<{ status: number; body: T | null }> {
    for (let attempt = 0; ; attempt++) {
      const { headers, credential } = await restAuth()
      const init: RequestInit =
        body === undefined
          ? { method, headers }
          : { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }
      const res = await call(path, init, timeout)
      if ((res.status === 401 || res.status === 403) && !attempt) {
        await res.body?.cancel().catch(() => {})
        reject(credential)
        continue
      }
      const text = await res.text().catch(() => '')
      let data: T | null = null
      try {
        data = text ? (JSON.parse(text) as T) : null
      } catch {
        // Not JSON: the status says enough.
      }
      return { status: res.status, body: data }
    }
  }

  /**
   * A few JSON-RPC calls over one short-lived socket, then it closes: what
   * only the socket tells (agents' colours, whether a model is set up). Each
   * answer is its result, or null when it failed or time ran out.
   */
  async function peek(calls: [method: string, params?: Record<string, unknown>][], timeout = 3000): Promise<unknown[]> {
    const results: unknown[] = calls.map(() => null)
    const deadline = Date.now() + timeout
    let url: URL
    try {
      url = await Promise.race([socketUrl(), new Promise<never>((_, fail) => setTimeout(fail, timeout))])
    } catch {
      return results
    }
    return new Promise((done) => {
      const answered = new Set<number>()
      let socket: WebSocket | undefined
      const finish = () => {
        clearTimeout(timer)
        try {
          socket?.close()
        } catch {
          // Already gone.
        }
        done(results)
      }
      const timer = setTimeout(finish, Math.max(0, deadline - Date.now()))
      try {
        socket = new WebSocket(url)
      } catch {
        return finish()
      }
      socket.addEventListener('open', () => {
        calls.forEach(([method, params = {}], i) => socket?.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method, params })))
      })
      socket.addEventListener('message', (event) => {
        let data: { id?: unknown; method?: unknown; result?: unknown } | null
        try {
          data = JSON.parse(String(event.data)) as typeof data
        } catch {
          return
        }
        // Answers only: Hermes's own requests and events carry a method.
        const i = typeof data?.id === 'number' && data.method === undefined ? data.id - 1 : -1
        if (!data || i < 0 || i >= calls.length || answered.has(i)) return
        answered.add(i)
        if ('result' in data) results[i] = data.result
        if (answered.size === calls.length) finish()
      })
      socket.addEventListener('error', finish)
      socket.addEventListener('close', finish)
    })
  }

  return { url: base, prefix, target, check: () => once('check', check), status, restAuth, socketAuth, socketUrl, reject, read, write, send, peek }
}

/** Set-Cookie lines by name, without any __Host-/__Secure- prefix or quotes. */
export function readCookies(lines: string[]) {
  const out = new Map<string, { value: string; maxAge?: number }>()
  for (const line of lines) {
    const [pair, ...attrs] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    const name = pair.slice(0, eq).trim().replace(/^__(Host|Secure)-/, '')
    const value = pair.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1')
    const maxAge = attrs.map((a) => a.trim().match(/^max-age=(\d+)$/i)?.[1]).find(Boolean)
    out.set(name, { value, maxAge: maxAge ? Number(maxAge) : undefined })
  }
  return out
}
