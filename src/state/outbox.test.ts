import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
})

const { held, hold, release } = await import('./outbox')

describe('the outbox', () => {
  it('keeps what’s waiting by chat, in the order it was sent', () => {
    hold('a', { id: 'u1', text: 'first', after: 4 })
    hold('a', { id: 'u2', text: 'second', files: ['notes.txt'], after: 4 })
    hold('b', { id: 'u3', text: 'elsewhere' })
    expect(held('a').map((m) => m.text)).toEqual(['first', 'second'])
    expect(held('b').map((m) => m.text)).toEqual(['elsewhere'])
  })

  it('keeps a message once, however often it’s held', () => {
    hold('a', { id: 'u1', text: 'first', after: 4 })
    expect(held('a').filter((m) => m.id === 'u1')).toHaveLength(1)
  })

  it('lets a message go once Hermes has it, and forgets a chat with nothing left', () => {
    release('a', ['u1', 'u2'])
    expect(held('a')).toEqual([])
    expect(store.has('murmur:outbox:a')).toBe(false)
    expect(held('b')).toHaveLength(1)
  })

  it('reads nothing from storage it can’t parse', () => {
    store.set('murmur:outbox:c', '{oops')
    expect(held('c')).toEqual([])
  })
})
