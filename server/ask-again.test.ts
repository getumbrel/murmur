import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAskAgain,
  MARGIN_MS,
  questionIn,
  REACH_TRIES,
  RETRY_MS,
  TOO_LATE_MS,
  type AskHermes,
} from './ask-again.ts'
import type { HermesEvent } from './socket.ts'

// A Hermes as ask-again.ts meets it: a chat's saved rows over REST, and a socket that
// resumes the chat, takes the question, and says when the reply is over.

const HOUR = 60 * 60_000
const asked = { id: 1, role: 'user', content: 'What should I cook this week?', timestamp: 1 }
const stopped = {
  id: 2,
  role: 'assistant',
  content: 'Your request was not processed.',
  display_kind: 'failed_turn',
  timestamp: 2,
}

function fakeHermes() {
  const state = {
    rows: [asked, stopped] as Record<string, unknown>[],
    up: true,
    running: false,
    calls: [] as { method: string; params: Record<string, unknown> }[],
    sockets: 0,
    closed: 0,
    /** How the reply to the next question ends. */
    ends: { status: 'complete' } as Record<string, unknown>,
  }
  const hermes: AskHermes = {
    read: async <T>() => (state.up ? ({ messages: [...state.rows].reverse() } as T) : null),
    open: (handlers) => {
      state.sockets++
      const emit = (event: HermesEvent) => handlers.onEvent(event)
      queueMicrotask(() => handlers.onOpen())
      return {
        call: async <T>(method: string, params: Record<string, unknown> = {}) => {
          state.calls.push({ method, params })
          if (method === 'session.resume') return { session_id: 'rt', running: state.running } as T
          if (method === 'prompt.submit')
            setTimeout(() => emit({ type: 'message.complete', session_id: 'rt', payload: state.ends }), 5000)
          return {} as T
        },
        close: () => void state.closed++,
      }
    },
  }
  return { state, hermes }
}

let dir: string
let fake: ReturnType<typeof fakeHermes>
const file = () => join(dir, 'ask-again.json')
const make = (there = true) => createAskAgain({ hermes: () => (there ? fake.hermes : null), file })
const kept = () =>
  (JSON.parse(readFileSync(file(), 'utf8')) as { held: { chat: string; at: number; tries: number }[] }).held
const submits = () => fake.state.calls.filter((c) => c.method === 'prompt.submit')

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-13T12:00:00Z') })
  dir = mkdtempSync(join(tmpdir(), 'murmur-ask-'))
  fake = fakeHermes()
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('the question to ask again', () => {
  it('is the chat’s last message, when the reply to it is what stopped', () => {
    expect(questionIn([asked, stopped])).toEqual({ row: 1, text: 'What should I cook this week?' })
  })
  it('is nothing once the chat has moved on, or the message was more than words', () => {
    expect(questionIn([asked, stopped, { id: 3, role: 'user', content: 'Never mind' }])).toBeUndefined()
    expect(questionIn([asked, { id: 2, role: 'assistant', content: 'Pasta.' }])).toBeUndefined()
    expect(
      questionIn([asked, { id: 2, role: 'assistant', content: '', tool_calls: [{}] } as never, { ...stopped, id: 3 }]),
    ).toBeUndefined()
    expect(questionIn([{ ...asked, pictures: ['a.png'] }, stopped])).toBeUndefined()
    expect(questionIn([])).toBeUndefined()
  })
})

describe('a question kept for when the model is back', () => {
  it('is asked a minute after the limit lifts, in its own place, and then forgotten', async () => {
    const store = make()
    await store.hold('h', 'default', 'chat1', Date.now() + HOUR)
    expect(store.list('h')).toEqual([{ profile: 'default', chat: 'chat1', at: Date.now() + HOUR, row: 1 }])
    await vi.advanceTimersByTimeAsync(HOUR + MARGIN_MS - 1000)
    expect(fake.state.sockets).toBe(0)
    await vi.advanceTimersByTimeAsync(2000)
    expect(submits()).toEqual([
      {
        method: 'prompt.submit',
        params: expect.objectContaining({
          session_id: 'rt',
          text: 'What should I cook this week?',
          profile: 'default',
          truncate_before_row_id: 1,
          confirm_truncate: true,
        }),
      },
    ])
    // It stays on the chat until the reply is over, then lets go of everything.
    expect(fake.state.closed).toBe(0)
    await vi.advanceTimersByTimeAsync(6000)
    expect(fake.state.closed).toBe(1)
    expect(store.list('h')).toEqual([])
    expect(kept()).toEqual([])
  })

  it('is let go, unasked, when the person wrote since', async () => {
    const store = make()
    await store.hold('h', 'default', 'chat1', Date.now() + HOUR)
    fake.state.rows.push({ id: 3, role: 'user', content: 'Never mind', timestamp: 3 })
    await vi.advanceTimersByTimeAsync(HOUR + MARGIN_MS + 1000)
    expect(fake.state.sockets).toBe(0)
    expect(store.list('h')).toEqual([])
  })

  it('is let go when a later message stopped the same way: that one wasn’t asked for', async () => {
    const store = make()
    await store.hold('h', 'default', 'chat1', Date.now() + HOUR)
    fake.state.rows = [
      { ...asked, id: 5, content: 'Something else', timestamp: 5 },
      { ...stopped, id: 6, timestamp: 6 },
    ]
    await vi.advanceTimersByTimeAsync(HOUR + MARGIN_MS + 1000)
    expect(fake.state.sockets).toBe(0)
    expect(store.list('h')).toEqual([])
  })

  it('isn’t kept when the chat doesn’t end on a question that can be asked again', async () => {
    const store = make()
    fake.state.rows = [asked, { id: 2, role: 'assistant', content: 'Pasta.', timestamp: 2 }]
    expect(await store.hold('h', 'default', 'chat1', Date.now() + HOUR)).toBe(false)
    fake.state.rows = [asked, stopped]
    fake.state.up = false
    expect(await store.hold('h', 'default', 'chat1', Date.now() + HOUR)).toBe(false)
    expect(store.list('h')).toEqual([])
  })

  it('isn’t asked when it was cancelled', async () => {
    const store = make()
    await store.hold('h', 'default', 'chat1', Date.now() + HOUR)
    store.cancel('h', 'chat1')
    await vi.advanceTimersByTimeAsync(2 * HOUR)
    expect(fake.state.sockets).toBe(0)
    expect(kept()).toEqual([])
  })

  it('leaves a chat that’s already replying alone', async () => {
    const store = make()
    fake.state.running = true
    await store.hold('h', 'default', 'chat1', Date.now() + HOUR)
    await vi.advanceTimersByTimeAsync(HOUR + MARGIN_MS + 1000)
    expect(submits()).toEqual([])
    expect(store.list('h')).toEqual([])
  })

  it('waits once more when the limit is still there, then lets go', async () => {
    const store = make()
    const first = Date.now() + HOUR
    await store.hold('h', 'default', 'chat1', first)
    const second = first + 2 * HOUR
    fake.state.ends = { status: 'error', error_surface: { code: 'rate_limit', resets_at: second / 1000 } }
    await vi.advanceTimersByTimeAsync(HOUR + MARGIN_MS + 6000)
    expect(submits()).toHaveLength(1)
    expect(kept()).toEqual([expect.objectContaining({ chat: 'chat1', at: second, tries: 1 })])
    // (Hermes saved the new stopped reply in the old one's place.)
    await vi.advanceTimersByTimeAsync(2 * HOUR + 6000)
    expect(submits()).toHaveLength(2)
    expect(store.list('h')).toEqual([])
  })

  it('looks again when Hermes is out of reach, and gives up after a few tries', async () => {
    const store = make()
    await store.hold('h', 'default', 'chat1', Date.now() + HOUR)
    fake.state.up = false
    await vi.advanceTimersByTimeAsync(HOUR + MARGIN_MS + 1000)
    expect(store.list('h')).toHaveLength(1)
    fake.state.up = true
    await vi.advanceTimersByTimeAsync(RETRY_MS + 1000)
    expect(submits()).toHaveLength(1)

    fake = fakeHermes()
    fake.state.up = false
    const other = make()
    await other.hold('h', 'default', 'chat2', Date.now() + HOUR)
    await vi.advanceTimersByTimeAsync(HOUR + MARGIN_MS + REACH_TRIES * RETRY_MS + 1000)
    expect(other.list('h')).toEqual([])
    expect(fake.state.sockets).toBe(0)
  })

  it('carries on after a restart, and drops what’s long past its time', async () => {
    const before = make()
    await before.hold('h', 'default', 'chat1', Date.now() + HOUR)
    before.stop()
    const again = make()
    again.resume()
    expect(again.list('h')).toEqual([expect.objectContaining({ chat: 'chat1' })])
    await vi.advanceTimersByTimeAsync(HOUR + MARGIN_MS + 6000)
    expect(submits()).toHaveLength(1)

    await again.hold('h', 'default', 'chat3', Date.now() + HOUR)
    again.stop()
    vi.setSystemTime(Date.now() + HOUR + TOO_LATE_MS + 2 * MARGIN_MS)
    const late = make()
    late.resume()
    await vi.advanceTimersByTimeAsync(1000)
    expect(late.list('h')).toEqual([])
    expect(submits()).toHaveLength(1)
  })

  it('is let go when its Hermes was removed from Murmur', async () => {
    const store = make(false)
    await store.hold('h', 'default', 'chat1', Date.now() + HOUR)
    await vi.advanceTimersByTimeAsync(HOUR + MARGIN_MS + 1000)
    expect(store.list('h')).toEqual([])
  })
})
