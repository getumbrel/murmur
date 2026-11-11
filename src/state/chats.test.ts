import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { GatewayEvent } from '@/hermes/gateway'
import type { ChatItem } from '@/features/chat/types'

// A chat Hermes has summarized, as this store reads it back and watches it happen.

const listeners: ((ev: GatewayEvent) => void)[] = []
const get = vi.fn()
vi.mock('@/hermes/rest', () => ({ api: { get: (path: string) => get(path) }, HermesError: class extends Error {} }))
vi.mock('@/hermes/gateway', () => ({
  gateway: { onEvent: (fn: (ev: GatewayEvent) => void) => listeners.push(fn), onRequest: () => {}, onState: () => {} },
  rpc: vi.fn(async (method: string) => (method === 'session.resume' ? { session_id: 'rt', running: true } : {})),
  useConnection: Object.assign(() => undefined, { getState: () => ({ state: 'open' }) }),
  whenOpen: async () => {},
}))
vi.stubGlobal('document', { cookie: '', addEventListener: () => {}, visibilityState: 'visible' })
vi.stubGlobal('window', { addEventListener: () => {}, setTimeout })

const { carried, getChat, openChat, wireChats } = await import('./chats')

const HANDOFF =
  '[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the summary below.\n\n## Goal\nA trip'
const FOLDED = '[END OF PRIOR CONTEXT — COMPACTION SUMMARY BELOW]'

const row = (id: number, role: string, content: string, more = {}) => ({ id, role, content, timestamp: id, ...more })
const said = (items: ChatItem[]) =>
  items.map((i) =>
    i.kind === 'user' || i.kind === 'assistant'
      ? `${i.kind}: ${i.text}`
      : `${i.kind}: ${'status' in i ? i.status : ''}`,
  )
const emit = (type: string, payload: Record<string, unknown> = {}) =>
  listeners.forEach((fn) => fn({ type, session_id: 'rt', payload } as GatewayEvent))

beforeAll(() => wireChats())

describe('a chat Hermes has summarized', () => {
  it('reads back every message, with a step where Hermes summarized them', async () => {
    get.mockResolvedValueOnce({ messages: [] }).mockResolvedValueOnce({
      messages: [
        // Copied forward when Hermes summarized: their place in the chat, a newer id.
        row(101, 'user', 'Find a place in Alfama'),
        row(102, 'assistant', 'Casa do Largo'),
        // Summarized for the model, still the person's.
        row(3, 'user', 'Book it'),
        row(4, 'assistant', 'Booked'),
        row(105, 'user', 'And dinner?'),
        row(106, 'assistant', 'Prado at 8'),
        row(104, 'user', HANDOFF, { display_kind: 'hidden' }),
        row(107, 'user', 'Make it an itinerary'),
        row(108, 'assistant', 'Here it is'),
      ],
    })
    await openChat('summarized', 'default')
    // Every message, including the ones Hermes has summarized for the model.
    expect(get.mock.calls.find(([path]) => path.includes('/summarized/messages'))?.[0]).toContain(
      'include_compacted=true',
    )
    expect(said(getChat('summarized')!.items)).toEqual([
      'user: Find a place in Alfama',
      'assistant: Casa do Largo',
      'user: Book it',
      'assistant: Booked',
      'user: And dinner?',
      'assistant: Prado at 8',
      'compaction: done',
      'user: Make it an itinerary',
      'assistant: Here it is',
    ])
  })

  it('shows a message the summary was folded into as the message, the step beside it', async () => {
    get.mockResolvedValueOnce({ messages: [] }).mockResolvedValueOnce({
      messages: [
        row(1, 'user', 'Find a place'),
        row(
          2,
          'assistant',
          `[PRIOR CONTEXT — for reference only; not a new message]\nCasa do Largo\n\n${FOLDED}\n\n${HANDOFF}`,
          {
            display_content: 'Casa do Largo',
          },
        ),
        row(3, 'user', `${HANDOFF}\n\n--- END OF CONTEXT SUMMARY ---\n\nBook it`, { display_content: 'Book it' }),
      ],
    })
    await openChat('folded', 'default')
    expect(said(getChat('folded')!.items)).toEqual([
      'user: Find a place',
      'compaction: done',
      'assistant: Casa do Largo',
      'user: Book it',
      'compaction: done',
    ])
  })
})

describe('Hermes summarizing a chat as you watch', () => {
  it('says so while it happens, then leaves the step in the reply', async () => {
    get.mockResolvedValue({ messages: [row(1, 'user', 'Make it an itinerary')] })
    await openChat('live', 'default')
    emit('status.update', { kind: 'compacting', text: '🗜️ Compacting context — summarizing earlier conversation…' })
    // Hermes says it again while it's still at it: still the one step.
    emit('status.update', { kind: 'compacting', text: '🗜️ Compacting context — still summarizing…' })
    const live = getChat('live')!.items.filter((i) => i.kind === 'compaction')
    expect(live).toEqual([expect.objectContaining({ status: 'running', startedAt: expect.any(Number) })])

    emit('status.update', { kind: 'compacted', text: '✓ Context compaction complete — continuing turn...' })
    emit('message.delta', { text: 'Here it is' })
    emit('message.complete', { text: 'Here it is', status: 'complete' })
    const items = getChat('live')!.items
    expect(said(items)).toEqual(['user: Make it an itinerary', 'compaction: done', 'assistant: Here it is'])
    expect(items[1]).toMatchObject({ endedAt: expect.any(Number) })
  })

  it('leaves no step when Hermes gives up on summarizing and carries on', async () => {
    get.mockResolvedValue({ messages: [row(1, 'user', 'Make it an itinerary')] })
    await openChat('refused', 'default')
    emit('status.update', { kind: 'compacting', text: '🗜️ Compacting context…' })
    emit('status.update', {
      kind: 'warn',
      text: '⚠️ Compression refused: the summary would have GROWN the conversation.',
    })
    emit('message.delta', { text: 'Here it is' })
    emit('message.complete', { text: 'Here it is', status: 'complete' })
    expect(said(getChat('refused')!.items)).toEqual(['user: Make it an itinerary', 'assistant: Here it is'])
    expect(getChat('refused')!.summarized).toBeFalsy()
  })

  it('knows a summary you asked for, which has its own card instead of a step', async () => {
    get.mockResolvedValue({ messages: [row(1, 'user', 'Hi')] })
    await openChat('tidied', 'default')
    emit('status.update', { kind: 'compacted', text: '✓ Context compaction complete — continuing turn...' })
    expect(getChat('tidied')!.items.some((i) => i.kind === 'compaction')).toBe(false)
    expect(getChat('tidied')!.summarized).toBe(true)
  })

  it('leaves no step when the reply ends before Hermes finished summarizing', async () => {
    get.mockResolvedValue({ messages: [row(1, 'user', 'Make it an itinerary')] })
    await openChat('failed', 'default')
    emit('status.update', { kind: 'compacting', text: '🗜️ Compacting context…' })
    emit('message.complete', { status: 'error', error: 'compression failed' })
    expect(getChat('failed')!.items.some((i) => i.kind === 'compaction')).toBe(false)
  })

  it('ignores other status lines', async () => {
    get.mockResolvedValue({ messages: [row(1, 'user', 'Hi')] })
    await openChat('other', 'default')
    emit('status.update', { kind: 'process', text: 'Resuming interrupted turn…' })
    expect(getChat('other')!.items.some((i) => i.kind === 'compaction')).toBe(false)
  })
})

describe('the rows a chat carried on from a reply keeps', () => {
  const kept = (rows: Parameters<typeof carried>[0], rowId: number) => carried(rows, rowId)?.map((r) => r.id)
  const r = (id: number, role: string, more = {}) => ({ id, role, active: 1, compacted: 0, ...more })

  it('is everything up to and including that reply, steps and what they found too', () => {
    const rows = [r(1, 'user'), r(2, 'assistant'), r(3, 'user'), r(4, 'assistant'), r(5, 'tool'), r(6, 'assistant'), r(7, 'user'), r(8, 'assistant')]
    expect(kept(rows, 6)).toEqual([1, 2, 3, 4, 5, 6])
    expect(kept(rows, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('takes the results that answer a row’s own calls with it', () => {
    const rows = [r(1, 'user'), r(2, 'assistant'), r(3, 'tool'), r(4, 'tool'), r(5, 'assistant')]
    expect(kept(rows, 2)).toEqual([1, 2, 3, 4])
  })

  it('leaves out what was taken back, and keeps what Hermes summarized as history', () => {
    const rows = [
      r(1, 'user', { active: 0, compacted: 1 }),
      r(2, 'assistant', { active: 0, compacted: 1 }),
      // An edit: the first try, taken back.
      r(3, 'user', { active: 0 }),
      r(4, 'assistant', { active: 0 }),
      r(5, 'user'),
      r(6, 'assistant'),
      r(7, 'user'),
    ]
    expect(kept(rows, 6)).toEqual([1, 2, 5, 6])
  })

  it('reads rows from before Hermes marked them as all part of the conversation', () => {
    expect(kept([{ id: 1, role: 'user' }, { id: 2, role: 'assistant' }, { id: 3, role: 'user' }], 2)).toEqual([1, 2])
  })

  it('has nothing to give for a reply Hermes has summarized away, or one it doesn’t have', () => {
    const rows = [r(1, 'user', { active: 0, compacted: 1 }), r(2, 'assistant', { active: 0, compacted: 1 }), r(3, 'user'), r(4, 'assistant')]
    expect(carried(rows, 2)).toBeNull()
    expect(carried(rows, 99)).toBeNull()
  })
})
