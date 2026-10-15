import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {}, within: () => ({}) }))
vi.mock('@/hermes/gateway', () => ({ gateway: { onEvent: vi.fn() } }))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('./agents', () => ({ useAgents: vi.fn() }))

const { accessFrom, allowRequest, ignoreRequest, personName, removeAllowed, useJustAllowed, waiting } =
  await import('./access')
const { api } = (await import('@/hermes/rest')) as unknown as { api: Record<string, unknown> }

const NOW = 1_800_000_000_000

describe('who can message an agent', () => {
  it('tidies Hermes’s lists, leaving out requests it can’t approve by id', () => {
    const access = accessFrom(
      'atlas',
      {
        pending: [
          { platform: 'whatsapp', request_id: 'a1', user_id: '1555', user_name: 'Sam', age_minutes: 5 },
          { platform: 'telegram', request_id: '', user_id: '42', user_name: 'Old' },
        ],
        approved: [{ platform: 'telegram', user_id: '42', user_name: 'Maya', approved_at: 1_700_000_000 }],
      },
      NOW,
    )
    expect(access.pending).toEqual([
      {
        agentId: 'atlas',
        platform: 'whatsapp',
        requestId: 'a1',
        userId: '1555',
        userName: 'Sam',
        at: NOW - 5 * 60_000,
      },
    ])
    expect(access.allowed).toEqual([{ platform: 'telegram', userId: '42', userName: 'Maya', at: 1_700_000_000_000 }])
  })

  it('lists requests newest first, without the ones put aside, keeping a just-allowed one for its receipt', () => {
    const r = (requestId: string, at: number) =>
      ({ agentId: 'atlas', platform: 'whatsapp', requestId, userId: requestId, userName: '', at }) as const
    const all = [r('old', 1), r('new', 3), r('hidden', 2)]
    expect(waiting(all, new Set(['hidden'])).map((x) => x.requestId)).toEqual(['new', 'old'])
    expect(waiting(all, new Set(['hidden']), [r('allowed', 2), r('new', 3)]).map((x) => x.requestId)).toEqual([
      'new',
      'allowed',
      'old',
    ])
  })

  it('keeps requests in the same order from one read to the next', () => {
    const raw = { pending: [{ platform: 'whatsapp', request_id: 'b', user_id: '2', age_minutes: 0 }] }
    const first = accessFrom('atlas', raw, NOW + 1_000).pending[0]
    const later = accessFrom('atlas', raw, NOW + 9_000).pending[0]
    expect(later.at).toBe(first.at)
    const r = (requestId: string) => ({ ...first, requestId })
    expect(waiting([r('b'), r('a')], new Set()).map((x) => x.requestId)).toEqual(['a', 'b'])
  })

  it('names people without showing WhatsApp ids, which aren’t always phone numbers', () => {
    expect(personName({ platform: 'whatsapp', userName: ' Sam ', userId: '1555' })).toBe('Sam')
    expect(personName({ platform: 'whatsapp', userName: '', userId: '98765@lid' })).toBe('Someone on WhatsApp')
    expect(personName({ platform: 'telegram', userName: '', userId: '42' })).toBe('Telegram user 42')
  })
})

describe('letting people in', () => {
  const request = {
    agentId: 'atlas',
    platform: 'whatsapp',
    requestId: 'a1',
    userId: '1555',
    userName: 'Sam',
    at: NOW,
  } as const
  /** A query cache holding one agent's lists. */
  const cache = (access: { pending: (typeof request)[]; allowed: unknown[] }) => {
    let data: unknown = access
    return {
      get: () => data as typeof access,
      qc: {
        setQueryData: (_: unknown, fn: (old: unknown) => unknown) => void (data = fn(data)),
        invalidateQueries: vi.fn(),
      } as never,
    }
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('moves a request across at once, and keeps its receipt a moment', async () => {
    vi.useFakeTimers()
    const post = vi.fn(async (..._: unknown[]) => ({ ok: true }))
    api.post = post
    const { get, qc } = cache({ pending: [request], allowed: [] })
    await allowRequest(qc, request)
    expect(post).toHaveBeenCalledWith(
      '/api/pairing/approve',
      { platform: 'whatsapp', request_id: 'a1', profile: 'atlas' },
      {},
    )
    expect(get().pending).toEqual([])
    expect(get().allowed).toMatchObject([{ platform: 'whatsapp', userId: '1555', userName: 'Sam' }])
    expect(useJustAllowed.getState().byId.a1).toBe(request)
    vi.advanceTimersByTime(2000)
    expect(useJustAllowed.getState().byId.a1).toBeUndefined()
  })

  it('takes someone off the list on that platform only', async () => {
    api.post = vi.fn(async () => ({ ok: true }))
    const sam = { platform: 'whatsapp', userId: '1555', userName: 'Sam' }
    const samOnTelegram = { ...sam, platform: 'telegram' }
    const { get, qc } = cache({ pending: [], allowed: [sam, samOnTelegram] })
    await removeAllowed(qc, 'atlas', sam)
    expect(get().allowed).toEqual([samOnTelegram])
  })

  it('remembers what was put aside for an hour, as long as Hermes keeps a request', () => {
    const store = new Map<string, string>([
      ['murmur:access-ignored', JSON.stringify({ stale: Date.now() - 2 * 60 * 60_000, recent: Date.now() - 60_000 })],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    ignoreRequest(request)
    expect(Object.keys(JSON.parse(store.get('murmur:access-ignored')!)).sort()).toEqual(['a1', 'recent'])
  })
})
