import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { GatewayEvent } from '@/hermes/gateway'
import { RESTING, WAITING_ON_LIMIT } from '@/features/chat/errors'

// A reply that runs into a limit: Hermes waits and tries again by itself, then
// gives up and says when the limit lifts. The events are Hermes 0.23.1's own.

const listeners: ((ev: GatewayEvent) => void)[] = []
const rpc = vi.fn(async (method: string) => (method === 'session.resume' ? { session_id: 'rt', running: false } : {}))
vi.mock('@/hermes/rest', () => ({
  api: { get: async (path: string) => (path.includes('/messages') ? { messages: [] } : {}) },
  HermesError: class extends Error {},
}))
vi.mock('@/hermes/gateway', () => ({
  gateway: { onEvent: (fn: (ev: GatewayEvent) => void) => listeners.push(fn), onRequest: () => {}, onState: () => {} },
  rpc: (method: string) => rpc(method),
  useConnection: Object.assign(() => undefined, { getState: () => ({ state: 'open' }) }),
  whenOpen: async () => {},
}))
vi.stubGlobal('document', { cookie: '', addEventListener: () => {}, visibilityState: 'visible' })
vi.stubGlobal('window', { addEventListener: () => {}, setTimeout, clearTimeout })

const { getChat, openChat, send, wireChats } = await import('./chats')
const emit = (type: string, payload: Record<string, unknown> = {}) =>
  listeners.forEach((fn) => fn({ type, session_id: 'rt', payload } as GatewayEvent))
const steps = (id: string) =>
  getChat(id)!.items.flatMap((i) => (i.kind === 'tool' ? [`${i.label} [${i.status}]${i.detail ? ` ${i.detail}` : ''}`] : []))

const WAIT = '⏳ rate limited — resets in ~1h 4m, retrying in 600s (attempt 1/3)'
const surface = (inSeconds: number) => ({ layer: 'provider', code: 'rate_limit', retryable: true, resets_at: Date.now() / 1000 + inSeconds })

let n = 0
async function asking() {
  const id = `limit${++n}`
  await openChat(id, 'default')
  await send(id, 'What should I cook this week?')
  emit('message.start')
  return id
}

beforeAll(() => wireChats())

describe('a reply that runs into a limit', () => {
  it('says it’s waiting, and until when, while Hermes holds the reply to try again', async () => {
    const id = await asking()
    emit('thinking.delta', { text: WAIT })
    expect(steps(id)).toEqual([expect.stringMatching(new RegExp(`^${WAITING_ON_LIMIT} \\[running\\] until \\d`))])
    // The next try's wait is the same step, not another.
    emit('thinking.delta', { text: WAIT.replace('1/3', '2/3') })
    expect(steps(id)).toHaveLength(1)
    expect(getChat(id)!.status).not.toBe('error')
  })

  it('is over the moment the reply moves again', async () => {
    const id = await asking()
    emit('thinking.delta', { text: WAIT })
    emit('message.delta', { text: 'Here’s a plan.' })
    expect(steps(id)).toEqual([`${WAITING_ON_LIMIT} [done]`])
  })

  it('leaves Hermes’s spinner and short waits alone', async () => {
    const id = await asking()
    emit('thinking.delta', { text: '(¬_¬) mulling...' })
    emit('thinking.delta', { text: '⏳ rate limited — retrying in 8s (attempt 1/3)' })
    expect(steps(id)).toEqual([])
  })

  it('says when the limit lifts once Hermes gives up, instead of an alert', async () => {
    const id = await asking()
    emit('thinking.delta', { text: WAIT })
    emit('message.complete', { status: 'error', text: 'custom rate-limited every one of 3 attempts', error: 'HTTP 429: Usage limit reached for this plan.', recoverable: true, error_surface: surface(3900) })
    const note = getChat(id)!.items.at(-1)
    expect(note).toMatchObject({ kind: 'error', message: RESTING, retryable: true })
    expect(note?.kind === 'error' && note.restingUntil! - Date.now()).toBeGreaterThan(3_890_000)
    expect(steps(id)).toEqual([`${WAITING_ON_LIMIT} [done]`])
  })

  it('keeps the usual words when no time was named, or it’s moments away', async () => {
    for (const s of [{ layer: 'provider', code: 'rate_limit', retryable: true }, surface(6)]) {
      const id = await asking()
      emit('message.complete', { status: 'error', text: '', error: 'HTTP 429: Rate limit reached', recoverable: true, error_surface: s })
      const note = getChat(id)!.items.at(-1)
      expect(note).toMatchObject({ kind: 'error', message: expect.stringContaining('Try again in a moment') })
      expect(note?.kind === 'error' && note.restingUntil).toBeFalsy()
    }
  })
})
