import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem } from '@/features/chat/types'
import type { GatewayEvent } from '@/hermes/gateway'

// Hermes letting a chat's live connection go (every page on it dropped off for
// a while), and a page getting back on a new one: at once, and without losing
// the start of a reply that began meanwhile.

class HermesError extends Error {}

const get = vi.fn()
const resume = vi.fn()
const events: ((ev: GatewayEvent) => void)[] = []
const states: ((state: string) => void)[] = []
vi.mock('@/hermes/rest', () => ({ api: { get: (path: string) => get(path) }, HermesError }))
vi.mock('@/hermes/gateway', () => ({
  gateway: {
    onEvent: (fn: (ev: GatewayEvent) => void) => events.push(fn),
    onRequest: () => {},
    onState: (fn: (state: string) => void) => states.push(fn),
  },
  rpc: vi.fn(async (method: string) => (method === 'session.resume' ? resume() : {})),
  useConnection: Object.assign(() => undefined, { getState: () => ({ state: 'open' }) }),
  whenOpen: async () => {},
}))
vi.stubGlobal('document', { cookie: '', addEventListener: () => {}, visibilityState: 'visible' })
vi.stubGlobal('window', {
  addEventListener: () => {},
  setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
  clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
})

const { getChat, leaveChat, openChat, wireChats } = await import('./chats')

const said = (items: ChatItem[]) =>
  items.flatMap((i) => (i.kind === 'user' || i.kind === 'assistant' ? [`${i.kind}: ${i.text}`] : [i.kind]))
const history = (messages: unknown[]) =>
  get.mockImplementation(async (path: string) => {
    if (!path.includes('/messages')) throw new HermesError('404')
    return { messages }
  })
const emit = (type: string, session_id: string, payload: Record<string, unknown> = {}) =>
  events.forEach((fn) => fn({ type, session_id, payload } as unknown as GatewayEvent))
/** Hermes's notice goes to every page, and names the connection in its payload. */
const reclaim = (runtime: string) => emit('session.reclaimed', '', { session_id: runtime, reason: 'ws_orphan_reap' })
const reconnect = () => states.forEach((fn) => fn('open'))
const settle = () => vi.advanceTimersByTimeAsync(0)

const FIRST = [
  { id: 1, role: 'user', timestamp: 1, content: 'How do kettles work?' },
  { id: 2, role: 'assistant', timestamp: 2, content: 'They boil water.' },
]
const SECOND = [...FIRST, { id: 3, role: 'user', timestamp: 3, content: 'And teapots?' }]

const onScreen: string[] = []

/** A chat on screen, on its first live connection. */
async function opened(id: string) {
  onScreen.push(id)
  history(FIRST)
  resume.mockResolvedValue({ session_id: `${id}-1` })
  await openChat(id, 'default')
  expect(getChat(id)!.runtimeId).toBe(`${id}-1`)
  resume.mockClear()
}

beforeAll(() => wireChats())
beforeEach(() => {
  vi.useFakeTimers()
  get.mockReset()
  resume.mockReset()
})
afterEach(async () => {
  // Done, off screen and let go, so the next test's reconnect is about its own chat.
  for (const id of onScreen.splice(0)) {
    emit('message.complete', getChat(id)!.runtimeId ?? '', { status: 'complete' })
    leaveChat(id)
  }
  reconnect()
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
})

describe('Hermes lets a chat’s live connection go', () => {
  it('gets the chat on screen back on at once', async () => {
    await opened('seen')
    resume.mockResolvedValue({ session_id: 'seen-2' })
    reclaim('seen-1')
    await settle()
    expect(resume).toHaveBeenCalledTimes(1)
    expect(getChat('seen')!.runtimeId).toBe('seen-2')
  })

  it('leaves a chat that’s off screen until it’s used', async () => {
    await opened('left')
    leaveChat('left')
    reclaim('left-1')
    await settle()
    expect(resume).not.toHaveBeenCalled()
    expect(getChat('left')!.runtimeId).toBeUndefined()
  })

  it('keeps the new connection when told late about the old one', async () => {
    await opened('late')
    resume.mockResolvedValue({ session_id: 'late-2' })
    reconnect()
    await settle()
    expect(getChat('late')!.runtimeId).toBe('late-2')
    resume.mockClear()
    reclaim('late-1')
    await settle()
    expect(getChat('late')!.runtimeId).toBe('late-2')
    expect(resume).not.toHaveBeenCalled()
  })
})

describe('getting back on while a reply is under way', () => {
  it('shows what was asked, and the reply as its own', async () => {
    await opened('joined')
    // Asked from another page, on the connection that replaced the one Hermes let go.
    history(SECOND)
    resume.mockResolvedValue({ session_id: 'joined-2', running: true })
    reclaim('joined-1')
    await settle()
    emit('message.delta', 'joined-2', { text: 'They steep it.' })
    expect(said(getChat('joined')!.items)).toEqual([
      'user: How do kettles work?',
      'assistant: They boil water.',
      'user: And teapots?',
      'assistant: They steep it.',
    ])
  })

  it('brings in what was asked at the reply’s end, when it wasn’t saved yet', async () => {
    await opened('unsaved')
    resume.mockResolvedValue({ session_id: 'unsaved-2', running: true })
    reconnect()
    await settle()
    history([...SECOND, { id: 4, role: 'assistant', timestamp: 4, content: 'They steep it.' }])
    emit('message.complete', 'unsaved-2', {
      text: 'They steep it.',
      status: 'complete',
      persisted_turn: { user_row_id: 3 },
    })
    await settle()
    expect(said(getChat('unsaved')!.items)).toEqual([
      'user: How do kettles work?',
      'assistant: They boil water.',
      'user: And teapots?',
      'assistant: They steep it.',
    ])
  })

  it('shows what was asked on the connection it had, too', async () => {
    await opened('blip')
    // The page dropped off for a moment, as a reply began from another one.
    history(SECOND)
    resume.mockResolvedValue({ session_id: 'blip-1', running: true })
    reconnect()
    await settle()
    emit('message.delta', 'blip-1', { text: 'They steep it.' })
    expect(said(getChat('blip')!.items)).toEqual([
      'user: How do kettles work?',
      'assistant: They boil water.',
      'user: And teapots?',
      'assistant: They steep it.',
    ])
  })

  it('leaves a reply it was already in to Hermes’s replay', async () => {
    await opened('same')
    emit('message.delta', 'same-1', { text: 'They' })
    resume.mockResolvedValue({ session_id: 'same-1', running: true })
    get.mockClear()
    reconnect()
    await settle()
    expect(get).not.toHaveBeenCalled()
    expect(said(getChat('same')!.items).at(-1)).toBe('assistant: They')
  })
})
