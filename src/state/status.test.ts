import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/gateway', () => ({ gateway: { onEvent: vi.fn(), onState: vi.fn() }, rpc: vi.fn() }))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('@/hermes/compat', () => ({ listProfiles: vi.fn() }))
vi.mock('@/state/chats', () => ({ useChats: Object.assign(vi.fn(), { getState: () => ({ chats: {} }), subscribe: vi.fn() }) }))

const { localActivities, mergeActivities, settledAt } = await import('./status')

describe('chats mid-turn', () => {
  it('reads the chats on this page: working, waiting on you, or at rest once attached', () => {
    expect(
      localActivities({
        a: { id: 'a', status: 'thinking' },
        b: { id: 'b', status: 'working', runtimeId: 'r2' },
        c: { id: 'c', status: 'waiting', runtimeId: 'r3' },
        d: { id: 'd', status: 'idle', runtimeId: 'r4' },
        e: { id: 'e', status: 'idle' },
        f: { id: 'f', status: 'error', runtimeId: 'r6' },
      }),
    ).toEqual({ a: 'working', b: 'working', c: 'waiting', d: 'idle', f: 'idle' })
  })

  it('takes a chat attached here at its word over Hermes’s polled list', () => {
    // d finished here a moment ago; Hermes's list hasn't caught up. x is busy in another app.
    expect(mergeActivities({ a: 'working', d: 'idle' }, { d: 'working', x: 'working', y: 'waiting' })).toEqual({
      a: 'working',
      x: 'working',
      y: 'waiting',
    })
  })
})

describe('holding a list still', () => {
  it('keeps a chat where it was until its turn ends, then lets it move', () => {
    expect(settledAt('chat-1', 1_000, false)).toBe(1_000)
    // Its message, then each tool call, stamps it newer: it stays put.
    expect(settledAt('chat-1', 2_000, true)).toBe(1_000)
    expect(settledAt('chat-1', 3_000, true)).toBe(1_000)
    // The reply lands.
    expect(settledAt('chat-1', 4_000, false)).toBe(4_000)
    expect(settledAt('chat-1', 5_000, true)).toBe(4_000)
  })

  it('holds a chat first seen mid-turn where it was first seen', () => {
    expect(settledAt('chat-new', 7_000, true)).toBe(7_000)
    expect(settledAt('chat-new', 8_000, true)).toBe(7_000)
    expect(settledAt('chat-new', 9_000, false)).toBe(9_000)
  })
})
