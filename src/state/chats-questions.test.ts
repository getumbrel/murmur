import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayEvent, ServerRequest } from '@/hermes/gateway'
import type { ChatItem } from '@/features/chat/types'

// A question the agent asks you: when it stops waiting for the answer, and when you write a message instead.

const listeners: ((ev: GatewayEvent) => void)[] = []
const handlers: ((req: ServerRequest) => boolean)[] = []
const calls: string[] = []
const rpc = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
  calls.push(method === 'prompt.submit' ? `${method} ${params.text}` : method)
  return method === 'session.resume' ? { session_id: 'rt', running: true } : {}
})
vi.mock('@/hermes/rest', () => ({
  api: { get: async (path: string) => (path.includes('/messages') ? { messages: [] } : {}) },
  HermesError: class extends Error {},
}))
vi.mock('@/hermes/gateway', () => ({
  gateway: {
    onEvent: (fn: (ev: GatewayEvent) => void) => listeners.push(fn),
    onRequest: (fn: (req: ServerRequest) => boolean) => handlers.push(fn),
    onState: () => {},
  },
  rpc: (method: string, params?: Record<string, unknown>) => rpc(method, params),
  useConnection: Object.assign(() => undefined, { getState: () => ({ state: 'open' }) }),
  whenOpen: async () => {},
}))
vi.stubGlobal('document', { cookie: '', addEventListener: () => {}, visibilityState: 'visible' })
vi.stubGlobal('window', { addEventListener: () => {}, setTimeout, clearTimeout })

const { getChat, openChat, send, wireChats } = await import('./chats')

const emit = (type: string, payload: Record<string, unknown> = {}) =>
  listeners.forEach((fn) => fn({ type, session_id: 'rt', payload } as GatewayEvent))
const question = (id: string) =>
  handlers.some((fn) =>
    fn({
      id,
      method: 'clarify',
      params: { session_id: 'rt', questions: [{ qid: 'q0', question: 'Which colour?', choices: ['Oat', 'Slate'] }] },
      respond: vi.fn(),
      fail: vi.fn(),
    } as unknown as ServerRequest),
  )
/** What was sent for a message: an interrupt, a steer, or the message itself. */
const sent = () => calls.filter((c) => /^(session\.(interrupt|steer)|prompt\.submit)/.test(c))
const shown = (items: ChatItem[]) =>
  items.flatMap((i) =>
    i.kind === 'clarify'
      ? [`clarify ${i.status}`]
      : i.kind === 'user'
        ? [`you: ${i.text}`]
        : i.kind === 'notice'
          ? [i.text]
          : [],
  )

let n = 0
async function asked() {
  const id = `q${++n}`
  await openChat(id, 'default')
  question(`srq-${n}`)
  return { id, request: `srq-${n}` }
}

beforeAll(() => wireChats())
beforeEach(() => {
  calls.length = 0
})

describe('a question the agent stops waiting on', () => {
  it('stays in the chat, saying it went unanswered', async () => {
    const { id, request } = await asked()
    expect(shown(getChat(id)!.items)).toEqual(['clarify pending'])
    emit('request.cancel', { id: request, method: 'clarify', reason: 'timeout' })
    const item = getChat(id)!.items.find((i) => i.kind === 'clarify')
    expect(item).toMatchObject({ status: 'missed', questions: [{ question: 'Which colour?' }] })
  })

  it('goes when it was withdrawn some other way (the reply stopped)', async () => {
    const { id, request } = await asked()
    emit('request.cancel', { id: request, method: 'clarify', reason: 'interrupted' })
    expect(shown(getChat(id)!.items)).toEqual([])
  })
})

describe('a message written instead of answering', () => {
  it('ends the wait and goes in as a message, rather than waiting behind the question', async () => {
    const { id } = await asked()
    const sending = send(id, 'Slate, please')
    await vi.waitFor(() => expect(calls).toContain('session.interrupt'))
    // Not steered into the reply: Hermes would hold that until the question's wait ran out.
    expect(calls).not.toContain('session.steer')
    expect(calls.some((c) => c.startsWith('prompt.submit'))).toBe(false)
    // The reply stops; the message goes once it has.
    emit('message.complete', { status: 'interrupted', text: '' })
    await sending
    expect(sent()).toEqual(['session.interrupt', 'prompt.submit Slate, please'])
    // The question shows as answered, with the message under it, and no "Stopped": you didn't stop it.
    expect(shown(getChat(id)!.items)).toEqual(['clarify answered', 'you: Slate, please'])
  })

  it('still steers a reply that isn’t waiting on a question', async () => {
    const id = 'steered'
    await openChat(id, 'default')
    await send(id, 'And make it quick')
    expect(sent()).toEqual(['session.steer'])
  })
})
