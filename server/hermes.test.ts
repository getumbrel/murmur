import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHermes, waysIn } from './hermes.ts'

// A Hermes started with just `hermes dashboard`: until its gateway first runs
// there's no session store, and browsing sessions answers 503 saying so
// (hermes_cli/web_server_sessions.py in 0.22).

const NO_STORE = "Session store is not initialized. Start this profile's gateway to initialize it."

/**
 * `exit`: how Hermes's own `hermes gateway start` ends (0 also when Docker turns it away).
 * `image`: it runs in one of Hermes's containers, and says so.
 */
function dashboardOnly({ starts, exit = 0, image = false }: { starts: boolean; exit?: number; image?: boolean }) {
  const state = { store: false, starts: 0 }
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/status') return json(200, { version: '0.22.5', auth_required: false, can_update_hermes: !image })
    if ((init.headers as Record<string, string>)['x-hermes-session-token'] !== 'secret') return json(401, { detail: 'Unauthorized' })
    if (url.pathname === '/api/gateway/start' && init.method === 'POST') {
      state.starts++
      // Hermes answers at once and the gateway opens the store a moment later, if it can start at all.
      if (starts) setTimeout(() => (state.store = true), 3000)
      return json(200, { ok: true, pid: 42, name: 'gateway-start' })
    }
    if (url.pathname === '/api/actions/gateway-start/status')
      return json(200, { name: 'gateway-start', running: false, exit_code: state.starts ? exit : null })
    if (url.pathname === '/api/sessions') return state.store ? json(200, { sessions: [] }) : json(503, { detail: NO_STORE })
    return json(404, { detail: 'Not Found' })
  })
  return { state, fetch }
}

let n = 0
const target = () => ({ id: 'mac', name: 'Mac', url: `http://studio${++n}.local:9119`, source: 'saved' as const, token: 'secret' })

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a Hermes running without its gateway', () => {
  it('has its gateway started, then connects', async () => {
    const fake = dashboardOnly({ starts: true })
    vi.stubGlobal('fetch', fake.fetch)
    const checking = createHermes(target()).check()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await checking).toMatchObject({ status: 'connected', hermesVersion: '0.22.5' })
    expect(fake.state.starts).toBe(1)
  })

  it('says how to start it when it won’t, and doesn’t ask again on every check', async () => {
    const fake = dashboardOnly({ starts: false })
    vi.stubGlobal('fetch', fake.fetch)
    const mac = target()
    const checking = createHermes(mac).check()
    await vi.advanceTimersByTimeAsync(25_000)
    expect(await checking).toMatchObject({ status: 'unreachable', error: expect.stringContaining('hermes gateway start') })

    // Checked again, even by a connection test with a Hermes of its own: told at once.
    expect(await createHermes(mac).check()).toMatchObject({ status: 'unreachable', error: expect.stringContaining('hermes gateway start') })
    expect(fake.state.starts).toBe(1)
  })

  it('gives up as soon as Hermes can’t start it either', async () => {
    const fake = dashboardOnly({ starts: false, exit: 1 })
    vi.stubGlobal('fetch', fake.fetch)
    const checking = createHermes(target()).check()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await checking).toMatchObject({ status: 'unreachable', error: expect.stringContaining('on that computer with “hermes gateway start”') })
  })

  it('says to start it in the container when Hermes runs in one', async () => {
    // Hermes 0.22.5's images: every action their dashboard spawns stops at `hermes pm repair`.
    const fake = dashboardOnly({ starts: false, exit: 1, image: true })
    vi.stubGlobal('fetch', fake.fetch)
    const checking = createHermes(target()).check()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await checking).toMatchObject({ status: 'unreachable', fromImage: true, error: expect.stringContaining('in Hermes’s container with “hermes gateway start”') })
  })
})

describe('a Hermes behind single sign-on', () => {
  /** `ways`: the providers it offers. `rotates`: each refresh hands out a new refresh token. */
  function gated({ ways = ['sso'], rotates = true }: { ways?: ('password' | 'sso')[]; rotates?: boolean } = {}) {
    const state = { refresh: new Set(['rt-1']), access: new Set<string>(), refreshes: 0, n: 1 }
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/status')
        return json(200, { version: '0.22.5', auth_required: true, auth_flows: ['cookie', 'native_pkce'] })
      if (url.pathname === '/api/auth/providers')
        return json(200, {
          providers: [
            ...(ways.includes('password') ? [{ name: 'basic', supports_password: true }] : []),
            ...(ways.includes('sso') ? [{ name: 'self-hosted', supports_password: false }] : []),
          ],
        })
      if (url.pathname === '/auth/native/refresh') {
        const { refresh_token, provider } = JSON.parse(String(init.body))
        if (provider !== 'self-hosted' || !state.refresh.has(refresh_token)) return json(401, { error: 'session_expired' })
        state.refreshes++
        const access = `at-${++state.n}`
        state.access.add(access)
        if (!rotates) return json(200, { access_token: access, refresh_token, expires_at: Date.now() / 1000 + 300 })
        state.refresh.delete(refresh_token)
        const next = `rt-${state.n}`
        state.refresh.add(next)
        return json(200, { access_token: access, refresh_token: next, expires_at: Date.now() / 1000 + 300 })
      }
      const bearer = String((init.headers as Record<string, string>)?.authorization ?? '').replace(/^Bearer /, '')
      if (!state.access.has(bearer)) return json(401, { detail: 'Unauthorized' })
      if (url.pathname === '/api/sessions') return json(200, { sessions: [] })
      return json(404, { detail: 'Not Found' })
    })
    return { state, fetch }
  }
  const sso = (refresh = 'rt-1') => ({ ...target(), token: undefined, sso: { provider: 'self-hosted', refresh } })

  it('renews its sign-in, and keeps each new refresh token', async () => {
    const fake = gated()
    vi.stubGlobal('fetch', fake.fetch)
    const hermes = createHermes(sso())
    const kept: unknown[] = []
    hermes.keepSignIn((s) => kept.push(s))
    expect(await hermes.check()).toMatchObject({ status: 'connected', mode: 'sso', signIns: ['sso'] })
    expect(kept).toEqual([{ provider: 'self-hosted', refresh: 'rt-2' }])
    expect(hermes.sso()).toEqual({ provider: 'self-hosted', refresh: 'rt-2' })

    // Signed in for five minutes: past that, renewed again.
    await vi.advanceTimersByTimeAsync(300_000)
    expect((await hermes.restAuth()).headers.authorization).toBe('Bearer at-3')
    expect(kept).toEqual([
      { provider: 'self-hosted', refresh: 'rt-2' },
      { provider: 'self-hosted', refresh: 'rt-3' },
    ])
  })

  it('writes nothing down when the refresh token stays the same', async () => {
    const fake = gated({ rotates: false })
    vi.stubGlobal('fetch', fake.fetch)
    const hermes = createHermes(sso())
    const kept: unknown[] = []
    hermes.keepSignIn((s) => kept.push(s))
    expect(await hermes.check()).toMatchObject({ status: 'connected' })
    expect(kept).toEqual([])
  })

  it('starts from a fresh sign-in’s access token, without renewing it', async () => {
    const fake = gated()
    fake.state.access.add('fresh')
    vi.stubGlobal('fetch', fake.fetch)
    const hermes = createHermes({ ...sso(), sso: { provider: 'self-hosted', refresh: 'rt-1', access: 'fresh', expiresAt: Date.now() + 300_000 } })
    expect(await hermes.check()).toMatchObject({ status: 'connected', mode: 'sso' })
    expect(fake.state.refreshes).toBe(0)
  })

  it('asks for a new sign-in once its sign-in has ended', async () => {
    const fake = gated()
    vi.stubGlobal('fetch', fake.fetch)
    expect(await createHermes(sso('revoked')).check()).toMatchObject({
      status: 'needs-login',
      mode: 'sso',
      error: 'Your sign-in to this Hermes has ended. Sign in again.',
    })
  })

  it('says it signs in with single sign-on, to a Hermes that only does', async () => {
    vi.stubGlobal('fetch', gated().fetch)
    const { token: _, ...plain } = target()
    expect(await createHermes(plain).check()).toMatchObject({
      status: 'needs-login',
      mode: 'sso',
      signIns: ['sso'],
      error: 'This Hermes signs in with single sign-on.',
    })
  })

  it('offers both, password first, when Hermes takes either', async () => {
    vi.stubGlobal('fetch', gated({ ways: ['password', 'sso'] }).fetch)
    const { token: _, ...plain } = target()
    expect(await createHermes(plain).check()).toMatchObject({
      status: 'needs-login',
      mode: 'password',
      signIns: ['password', 'sso'],
    })
  })
})

describe('the ways into a Hermes behind a sign-in', () => {
  const basic = { name: 'basic', supports_password: true }
  const oidc = { name: 'self-hosted', supports_password: false }
  it('read from its providers', () => {
    expect(waysIn({ providers: [basic] }, true)).toEqual(['password'])
    expect(waysIn({ providers: [oidc] }, true)).toEqual(['sso'])
    expect(waysIn({ providers: [basic, oidc] }, true)).toEqual(['password', 'sso'])
  })

  it('leave out single sign-on it can’t hand to an app, and fall back to a password when it can’t say', () => {
    expect(waysIn({ providers: [oidc] }, false)).toEqual([])
    expect(waysIn(null, true)).toEqual(['password'])
    expect(waysIn({ detail: 'Not Found' }, true)).toEqual(['password'])
  })
})
