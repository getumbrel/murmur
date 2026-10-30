import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHermes } from './hermes.ts'

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
