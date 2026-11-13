import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askAgainAt, dontAskAgain, isKept, refreshAskAgain, useAskAgain } from './ask-again'

// What the app shows of the questions Murmur's server is keeping: taken at
// once, taken back when the server didn't agree, and the server's word after.

const calls: { method: string; path: string; body?: unknown }[] = []
let answer: (path: string) => { status: number; body: unknown }

beforeEach(() => {
  calls.length = 0
  useAskAgain.setState({ held: {} })
  answer = () => ({ status: 200, body: { ok: true } })
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    calls.push({ method: init.method ?? 'GET', path, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const { status, body } = answer(path)
    return new Response(JSON.stringify(body), { status })
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('a question kept for when the model is back', () => {
  it('shows as kept at once, and tells the server which chat, agent and when', async () => {
    const asking = askAgainAt('default', 'chat1', 5000, 7)
    expect(useAskAgain.getState().held).toEqual({ chat1: { at: 5000, row: 7 } })
    await asking
    expect(calls).toEqual([{ method: 'POST', path: '/murmur/ask-again', body: { profile: 'default', chat: 'chat1', at: 5000 } }])
  })

  it('isn’t shown as kept when the server didn’t take it', async () => {
    answer = () => ({ status: 422, body: { error: 'There’s nothing to ask again in that chat.' } })
    await expect(askAgainAt('default', 'chat1', 5000)).rejects.toThrow()
    expect(useAskAgain.getState().held).toEqual({})
  })

  it('is let go on Cancel, and stays if the server couldn’t be told', async () => {
    useAskAgain.setState({ held: { chat1: { at: 5000 } } })
    answer = () => ({ status: 502, body: null })
    await expect(dontAskAgain('default', 'chat1')).rejects.toThrow()
    expect(useAskAgain.getState().held).toEqual({ chat1: { at: 5000 } })
    answer = () => ({ status: 200, body: { ok: true } })
    await dontAskAgain('default', 'chat1')
    expect(useAskAgain.getState().held).toEqual({})
    expect(calls.at(-1)).toEqual({ method: 'POST', path: '/murmur/ask-again/cancel', body: { chat: 'chat1' } })
    // Nothing kept: nothing to tell the server.
    await dontAskAgain('default', 'chat1')
    expect(calls).toHaveLength(2)
  })

  it('follows the server: asked or let go there, it stops showing here; other chats stay as they were', async () => {
    useAskAgain.setState({ held: { chat1: { at: 5000 }, chat2: { at: 6000 }, elsewhere: { at: 7000 } } })
    answer = () => ({ status: 200, body: { held: [{ profile: 'default', chat: 'chat2', at: 9000, row: 4 }] } })
    await refreshAskAgain('default', ['chat1', 'chat2'])
    expect(useAskAgain.getState().held).toEqual({ chat2: { at: 9000, row: 4 }, elsewhere: { at: 7000 } })
    // A blip changes nothing.
    answer = () => ({ status: 502, body: null })
    await refreshAskAgain('default', ['chat2'])
    expect(useAskAgain.getState().held).toEqual({ chat2: { at: 9000, row: 4 }, elsewhere: { at: 7000 } })
  })

  it('stays kept when a look at the server crosses the tap: the server takes a moment to keep it', async () => {
    // The server reads the chat before it keeps the question, so a look started meanwhile finds nothing yet.
    let took!: () => void
    const taken = new Promise<void>((r) => (took = r))
    vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => {
      if (init.method === 'POST') await taken
      return new Response(JSON.stringify(init.method === 'POST' ? { ok: true } : { held: [] }), { status: 200 })
    })
    const asking = askAgainAt('default', 'chat1', 5000, 7)
    await refreshAskAgain('default', ['chat1'])
    expect(useAskAgain.getState().held).toEqual({ chat1: { at: 5000, row: 7 } })
    // And one that set off before the server had it, but came back after.
    const look = refreshAskAgain('default', ['chat1'])
    took()
    await asking
    await look
    expect(useAskAgain.getState().held).toEqual({ chat1: { at: 5000, row: 7 } })
    // A look after that is the server's word again.
    await refreshAskAgain('default', ['chat1'])
    expect(useAskAgain.getState().held).toEqual({})
  })

  it('is this message’s only: a later one that stopped the same way is offered afresh', () => {
    expect(isKept({ at: 5000, row: 4 }, 4)).toBe(true)
    expect(isKept({ at: 5000, row: 4 }, 9)).toBe(false)
    // (The server didn't say which: the chat's last, then.)
    expect(isKept({ at: 5000 }, 9)).toBe(true)
    expect(isKept(undefined, 4)).toBe(false)
  })
})
