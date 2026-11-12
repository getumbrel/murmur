import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Two Hermes, "main" first, then "k3f9", each with its own socket.
type Link = { state: string; everOpened: boolean; away: boolean }
const links: Record<string, Link> = {}
let overall: 'open' | 'down' | 'idle' = 'idle'
const heard: (() => void)[] = []
let ids = ['main', 'k3f9']

vi.mock('@/hermes/gateway', () => ({
  gateway: { onState: (fn: () => void) => void heard.push(fn) },
  stateOfAll: () => overall,
  useAway: vi.fn(),
  useConnection: { getState: (hermes?: string | null) => links[hermes ?? ids[0]] ?? { state: 'idle', everOpened: false, away: false } },
}))
vi.mock('@/hermes/instance', () => ({ hermesIds: () => ids, onHermesIds: (fn: () => void) => void heard.push(fn) }))
vi.mock('@/lib/keep-app', () => ({ openedKept: false }))

let onLine = true
let answers: () => Promise<Response> = () => Promise.resolve(new Response('{}'))
vi.stubGlobal('navigator', {
  get onLine() {
    return onLine
  },
})
vi.stubGlobal('window', { addEventListener: vi.fn() })
vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() })
vi.stubGlobal('fetch', () => answers())

const { awayOn, useReach, wireReach } = await import('./reach')

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
}
const change = (next: typeof overall) => {
  overall = next
  for (const fn of heard) fn()
}

beforeEach(() => {
  vi.useFakeTimers()
  ids = ['main', 'k3f9']
  links.main = { state: 'open', everOpened: true, away: false }
  links.k3f9 = { state: 'open', everOpened: true, away: false }
  onLine = true
  answers = () => Promise.resolve(new Response('{}'))
  wireReach()
  change('open')
})
afterEach(() => {
  vi.useRealTimers()
})

describe('what’s out of reach, with several Hermes', () => {
  it('leaves one Hermes that’s away on its own to its own agents', async () => {
    links.k3f9 = { state: 'closed', everOpened: true, away: true }
    // The other is still open, so nothing is away for everyone.
    change('open')
    await settle(20_000)
    expect(useReach.getState().away).toBeUndefined()
    expect(awayOn('k3f9')).toBe('hermes')
    expect(awayOn('main')).toBeUndefined()
  })

  it('says Murmur can’t be reached once every socket is down and its server doesn’t answer', async () => {
    answers = () => Promise.reject(new TypeError('Failed to fetch'))
    change('down')
    await settle(1000)
    // A blip isn't worth a word.
    expect(useReach.getState().away).toBeUndefined()
    await settle(1000)
    expect(useReach.getState().away).toBe('murmur')
    expect(awayOn('main')).toBe('murmur')
    expect(awayOn('k3f9')).toBe('murmur')
    change('open')
    expect(useReach.getState().away).toBeUndefined()
  })

  it('says Hermes isn’t answering only after a restart’s worth of waiting, when Murmur is there', async () => {
    change('down')
    await settle(6000)
    expect(useReach.getState().away).toBeUndefined()
    await settle(7000)
    expect(useReach.getState().away).toBe('hermes')
    change('open')
  })

  it('says this device is offline at once', async () => {
    onLine = false
    change('down')
    await settle(0)
    expect(useReach.getState().away).toBe('offline')
    onLine = true
    change('open')
  })
})

describe('with one Hermes', () => {
  it('leaves its socket’s own ups and downs to the app as a whole, as it always did', () => {
    ids = ['main']
    links.main = { state: 'closed', everOpened: true, away: true }
    expect(awayOn('main')).toBeUndefined()
  })
})
