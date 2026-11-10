import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem } from '@/features/chat/types'

// Opening a chat: rows Hermes saved in odd shapes, and the ways Hermes can turn an open away.

class HermesError extends Error {
  status: number
  constructor(status: number) {
    super(String(status))
    this.status = status
  }
}
const refusal = (code: number, message: string) => Object.assign(new Error(message), { code })

const get = vi.fn()
const resume = vi.fn()
vi.mock('@/hermes/rest', () => ({ api: { get: (path: string) => get(path) }, HermesError }))
vi.mock('@/hermes/gateway', () => ({
  gateway: { onEvent: () => {}, onRequest: () => {}, onState: () => {} },
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

const { getChat, leaveChat, openChat, readUnread, wireChats } = await import('./chats')

const said = (items: ChatItem[]) =>
  items.flatMap((i) => (i.kind === 'user' || i.kind === 'assistant' ? [`${i.kind}: ${i.text}`] : [i.kind]))
/** The chat's messages answer `messages` (or the error); its own row is never there. */
const history = (messages: unknown[] | Error) =>
  get.mockImplementation(async (path: string) => {
    if (!path.includes('/messages')) throw new HermesError(404)
    if (messages instanceof Error) throw messages
    return { messages }
  })
const LIVE = { session_id: 'rt' }

beforeAll(() => wireChats())
beforeEach(() => {
  vi.useFakeTimers()
  get.mockReset()
  resume.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('rows Hermes saved in parts', () => {
  it('reads the words of a message kept as text beside a picture', async () => {
    history([
      {
        id: 1,
        role: 'user',
        timestamp: 1,
        content: [
          { type: 'text', text: 'What is in this picture?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      },
      { id: 2, role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'A single ' }, 'pixel.'] },
    ])
    resume.mockResolvedValue(LIVE)
    await openChat('parts', 'default')
    expect(said(getChat('parts')!.items)).toEqual(['user: What is in this picture?', 'assistant: A single pixel.'])
  })

  it('shows the picture kept beside your words, the very one Hermes sent', async () => {
    const picture = { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${'A'.repeat(64)}` } }
    const text = 'Where do you think this is?\n\n[Image attached at: /opt/data/images/upload_gq2qyo8l.jpg]'
    history([
      { id: 1, role: 'user', timestamp: 1, content: [{ type: 'text', text }, picture] },
      // Only what you sent: a picture in a step's result isn't yours.
      { id: 2, role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'The dunes.' }, picture] },
    ])
    resume.mockResolvedValue(LIVE)
    await openChat('photo', 'default')
    const [yours, reply] = getChat('photo')!.items
    expect(yours).toMatchObject({
      kind: 'user',
      text: 'Where do you think this is?',
      attachments: [{ kind: 'image', name: 'upload_gq2qyo8l.jpg', path: '/opt/data/images/upload_gq2qyo8l.jpg' }],
    })
    const shown = yours.kind === 'user' && yours.attachments?.[0].kind === 'image' ? yours.attachments[0].url : ''
    expect(shown).toBe(picture.image_url.url)
    expect(reply).toMatchObject({ kind: 'assistant', text: 'The dunes.' })
    expect(reply).not.toHaveProperty('attachments')
  })

  it('skips what it can’t show, and keeps the rest of the chat', async () => {
    history([
      { id: 1, role: 'user', timestamp: 1, content: 'Hello' },
      // No words at all, a lone object, thinking and steps that aren't what they should be.
      { id: 2, role: 'user', timestamp: 2, content: null },
      { id: 3, role: 'assistant', timestamp: 3, content: { type: 'image_url', image_url: { url: 'x' } } },
      { id: 4, role: 'assistant', timestamp: 4, content: 'Hi', reasoning: [{ summary: 'thought' }], tool_calls: 'none' },
      { id: 5, role: 'tool', timestamp: 5, tool_call_id: 'gone', content: [{ type: 'text', text: 'done' }] },
      { id: 6, role: 'assistant', timestamp: 6, content: 7 },
    ])
    resume.mockResolvedValue(LIVE)
    await openChat('odd', 'default')
    expect(said(getChat('odd')!.items)).toEqual(['user: Hello', 'assistant: Hi'])
    expect(getChat('odd')!.ready).toBe(true)
  })
})

describe('a chat Hermes turns away', () => {
  it('is gone only when Hermes has no history for it and says it isn’t there', async () => {
    history(new HermesError(404))
    resume.mockRejectedValue(refusal(4007, 'session not found'))
    await expect(openChat('deleted', 'default')).rejects.toThrow('session not found')
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('opens after a moment when Hermes was only letting it go', async () => {
    history([{ id: 1, role: 'user', timestamp: 1, content: 'Hello' }])
    resume
      .mockRejectedValueOnce(refusal(4007, 'session no longer live; retry resume'))
      .mockRejectedValueOnce(refusal(4009, 'session disconnect interrupt settling'))
      .mockResolvedValue(LIVE)
    const opened = openChat('handoff', 'default')
    await vi.advanceTimersByTimeAsync(3000)
    await opened
    expect(resume).toHaveBeenCalledTimes(3)
    expect(getChat('handoff')).toMatchObject({ runtimeId: 'rt', stalled: undefined })
  })

  it.each([
    [4007, 'session no longer live; retry resume'],
    [4009, 'session disconnect interrupt settling'],
    [5000, 'resume failed'],
    [4130, 'This session is too long to reload safely'],
    [4132, 'kanban worker transcript'],
    [4001, 'invalid_params'],
    [undefined, 'request timed out'],
  ])('says it can’t be opened, and keeps trying, on %s %s', async (code, message) => {
    const id = `shut-${code}-${message.length}`
    history([{ id: 1, role: 'user', timestamp: 1, content: 'Hello' }])
    resume.mockRejectedValue(refusal(code as number, message))
    let settled = false
    const opened = openChat(id, 'default').then(
      () => (settled = true),
      () => (settled = true),
    )
    // Quiet for the first few seconds.
    await vi.advanceTimersByTimeAsync(2500)
    expect(getChat(id)!.stalled).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1000)
    expect(getChat(id)).toMatchObject({ ready: true, stalled: true })
    expect(said(getChat(id)!.items)).toEqual(['user: Hello'])
    expect(settled).toBe(false)
    // Asked to try again, it opens as soon as Hermes lets it.
    resume.mockResolvedValue(LIVE)
    readUnread()
    await opened
    expect(getChat(id)).toMatchObject({ runtimeId: 'rt', stalled: undefined })
  })

  it('isn’t called gone while Hermes still has its messages', async () => {
    history([{ id: 1, role: 'user', timestamp: 1, content: 'Hello' }])
    resume.mockRejectedValue(refusal(4007, 'session not found'))
    const opened = openChat('half', 'default')
    await vi.advanceTimersByTimeAsync(3500)
    expect(getChat('half')!.stalled).toBe(true)
    leaveChat('half')
    await opened
  })

  it('isn’t called gone when Hermes has no history for it but refuses for another reason', async () => {
    history(new HermesError(404))
    resume.mockRejectedValue(refusal(5000, 'resume failed'))
    const opened = openChat('empty', 'default')
    await vi.advanceTimersByTimeAsync(3500)
    expect(getChat('empty')).toMatchObject({ ready: true, stalled: true, items: [] })
    leaveChat('empty')
    await opened
  })

  it('stops trying once the chat is left', async () => {
    history([{ id: 1, role: 'user', timestamp: 1, content: 'Hello' }])
    resume.mockRejectedValue(refusal(5000, 'resume failed'))
    const opened = openChat('left', 'default')
    await vi.advanceTimersByTimeAsync(500)
    leaveChat('left')
    await opened
    const tries = resume.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(resume).toHaveBeenCalledTimes(tries)
  })
})
