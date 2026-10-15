import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hermes's WhatsApp onboarding routes (hermes_cli/web_routers/messaging.py, 0.22), as fakes.
class HermesError extends Error {
  status: number
  constructor(status: number, message = '') {
    super(message)
    this.status = status
  }
}
const calls: string[] = []
const routes: Record<string, (body?: unknown) => unknown> = {}
const call = (method: string) => async (path: string, body?: unknown) => {
  const route = `${method} ${path.split('?')[0]}`
  calls.push(route)
  const handler = routes[route]
  if (!handler) throw new HermesError(404, 'not found')
  return handler(body)
}
const rpc = vi.fn((..._: unknown[]) => Promise.resolve())
vi.mock('@/hermes/rest', () => ({
  HermesError,
  within: () => ({}),
  api: { get: call('GET'), post: call('POST'), put: call('PUT'), delete: call('DELETE') },
}))
vi.mock('@/hermes/gateway', () => ({ rpc: (...args: unknown[]) => rpc(...args) }))
vi.mock('@/hermes/compat', () => ({ listProfiles: vi.fn() }))

const { cancelLink, startLink, useLinks } = await import('./whatsapp')

const ONBOARDING = '/api/messaging/whatsapp/onboarding'
const link = (agent: string) => useLinks.getState().byAgent[agent]
/** One poll of Hermes, and whatever it sets going. */
const poll = () => vi.advanceTimersByTimeAsync(1600)

beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  rpc.mockClear()
  for (const key of Object.keys(routes)) delete routes[key]
})
afterEach(() => {
  for (const agent of Object.keys(useLinks.getState().byAgent)) cancelLink(agent)
  vi.useRealTimers()
})

describe('linking WhatsApp', () => {
  it('gets ready, shows the code, and once scanned saves the link and remembers who it is', async () => {
    let status: Record<string, unknown> = { pairing_id: 'p1', status: 'installing' }
    routes[`POST ${ONBOARDING}/start`] = () => status
    routes[`GET ${ONBOARDING}/p1`] = () => status
    routes[`POST ${ONBOARDING}/p1/apply`] = () => ({ restart_started: true })

    await startLink('atlas', 'self-chat')
    expect(link('atlas')).toMatchObject({ phase: 'installing', id: 'p1', mode: 'self-chat' })

    status = { pairing_id: 'p1', status: 'waiting', qr_payload: 'qr-1' }
    await poll()
    expect(link('atlas')).toMatchObject({ phase: 'waiting', qr: 'qr-1' })

    status = { pairing_id: 'p1', status: 'connected', account_name: 'Sam', account_phone: '15551234567' }
    await poll()
    expect(link('atlas')).toMatchObject({ phase: 'done', account: { name: 'Sam', phone: '15551234567' } })
    expect(calls).toContain(`POST ${ONBOARDING}/p1/apply`)
    expect(calls).not.toContain('POST /api/gateway/restart')
    expect(rpc).toHaveBeenCalledWith('profiles.configure', {
      name: 'atlas',
      ui_meta: { 'murmur-whatsapp': expect.objectContaining({ name: 'Sam', phone: '15551234567', mode: 'self-chat' }) },
    })
  })

  it('restarts messaging itself when Hermes’s own restart didn’t start', async () => {
    routes[`POST ${ONBOARDING}/start`] = () => ({ pairing_id: 'p2', status: 'connected' })
    routes[`POST ${ONBOARDING}/p2/apply`] = () => ({ needs_restart: true, restart_started: false })
    routes['POST /api/gateway/restart'] = () => ({ ok: true })
    await startLink('ada', 'bot')
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toContain('POST /api/gateway/restart')
    expect(link('ada').phase).toBe('done')
  })

  it('starts again when Hermes forgets the setup, and a phone that already scanned comes back linked', async () => {
    let starts = 0
    routes[`POST ${ONBOARDING}/start`] = () =>
      ++starts === 1
        ? { pairing_id: 'p3', status: 'waiting', qr_payload: 'qr' }
        : { pairing_id: 'p4', status: 'connected' }
    routes[`POST ${ONBOARDING}/p4/apply`] = () => ({ restart_started: true })
    await startLink('scout', 'bot')
    await poll() // GET …/p3 is a 404: Hermes restarted.
    expect(starts).toBe(2)
    expect(link('scout')).toMatchObject({ phase: 'done', id: 'p4' })
  })

  it('says the code ran out when Hermes says it’s gone', async () => {
    routes[`POST ${ONBOARDING}/start`] = () => ({ pairing_id: 'p5', status: 'waiting', qr_payload: 'qr' })
    routes[`GET ${ONBOARDING}/p5`] = () => {
      throw new HermesError(410, 'expired')
    }
    await startLink('juniper', 'self-chat')
    await poll()
    expect(link('juniper').phase).toBe('expired')
  })

  it('goes back to the code when the scan isn’t ready to save yet', async () => {
    routes[`POST ${ONBOARDING}/start`] = () => ({ pairing_id: 'p6', status: 'connected' })
    routes[`POST ${ONBOARDING}/p6/apply`] = () => {
      throw new HermesError(409, 'not connected')
    }
    routes[`GET ${ONBOARDING}/p6`] = () => ({ pairing_id: 'p6', status: 'waiting', qr_payload: 'qr' })
    await startLink('basil', 'self-chat')
    await vi.advanceTimersByTimeAsync(0)
    expect(link('basil').phase).toBe('waiting')
  })

  it('says why it can’t start, in words a person can act on', async () => {
    await startLink('nobody', 'self-chat')
    expect(link('nobody')).toMatchObject({ phase: 'failed', message: expect.stringMatching(/Try again/) })
  })

  it('stops Hermes’s bridge when it’s put away mid-link', async () => {
    routes[`POST ${ONBOARDING}/start`] = () => ({ pairing_id: 'p7', status: 'waiting', qr_payload: 'qr' })
    routes[`DELETE ${ONBOARDING}/p7`] = () => ({ ok: true })
    await startLink('atlas', 'self-chat')
    cancelLink('atlas')
    await poll()
    expect(link('atlas')).toBeUndefined()
    expect(calls).toContain(`DELETE ${ONBOARDING}/p7`)
    expect(calls).not.toContain(`GET ${ONBOARDING}/p7`)
  })

  it('lets go of a bridge Hermes starts after the sheet was closed', async () => {
    let answer!: (v: unknown) => void
    routes[`POST ${ONBOARDING}/start`] = () => new Promise((r) => (answer = r))
    routes[`DELETE ${ONBOARDING}/p8`] = () => ({ ok: true })
    const started = startLink('atlas', 'self-chat')
    cancelLink('atlas')
    answer({ pairing_id: 'p8', status: 'waiting', qr_payload: 'qr' })
    await started
    expect(link('atlas')).toBeUndefined()
    expect(calls).toContain(`DELETE ${ONBOARDING}/p8`)
  })
})
