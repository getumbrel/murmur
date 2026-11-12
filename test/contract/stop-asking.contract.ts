// "Stop asking in this chat" (src/features/chat-screen/asking.tsx,
// setChatUnasked in src/state/chats.ts): one chat's agent going ahead without
// asking for an OK, as Hermes switches it, reports it and keeps it.

import { afterEach, describe, expect, it } from 'vitest'
import { unaskedOf } from '@/features/chat/asking'
import { connect, newChat, turn, type Socket } from './client'

let socket: Socket | undefined
afterEach(() => socket?.close())

const risky = (name: string) => `Tidy up [[tool: terminal {"command":"rm -rf /opt/data/contract-${name}"}]]`
type Info = { yolo?: boolean; approval_mode?: string }
type Done = { result: Record<string, unknown> }
const ran = (s: Socket, runtime: string) => s.of(runtime).findLast((e) => e.type === 'tool.complete')!.payload as Done
const asked = (s: Socket) => s.requests.filter((r) => r.method === 'approval').length
/** The switch, as the app throws it. */
const stopAsking = (s: Socket, runtime: string, on: boolean) =>
  s.request<{ value: string; scope: string }>('config.set', { session_id: runtime, key: 'yolo', value: on ? 'on' : 'off', scope: 'session' })
/** What Hermes last said about the chat. */
const said = (s: Socket, runtime: string) => s.of(runtime).findLast((e) => e.type === 'session.info')?.payload as Info | undefined
/**
 * Where a chat stands once Hermes says: opening one answers before its agent
 * is up, with nothing about asking, and `session.info` follows with it.
 */
const stands = (s: Socket, runtime: string) =>
  s.until(`${runtime} to say whether it asks`, () => unaskedOf(said(s, runtime)))

describe('stop asking in this chat', () => {
  it('a new chat says it asks', async () => {
    socket = await connect()
    const { runtime, created } = await newChat(socket)
    // Not in the answer itself, which is why the app waits to be told before offering it.
    expect(unaskedOf(created.info as Info)).toBeUndefined()
    expect(await stands(socket, runtime)).toBe(false)
  })

  it('goes ahead without asking once switched, and says so', async () => {
    socket = await connect((r) => (r.method === 'approval' ? { choice: 'deny' } : undefined))
    const { runtime } = await newChat(socket)
    // (The agent is built by the first turn; the switch reports through it.)
    await turn(socket, runtime, 'hello')
    expect(await stopAsking(socket, runtime, true)).toMatchObject({ value: '1', scope: 'session' })
    expect(unaskedOf(said(socket, runtime))).toBe('chat')

    await turn(socket, runtime, risky('unasked'))
    expect(asked(socket)).toBe(0)
    expect(ran(socket, runtime).result).toMatchObject({ exit_code: 0 })
  })

  it("goes ahead with what isn't a command too", async () => {
    socket = await connect((r) => (r.method === 'approval' ? { choice: 'deny' } : undefined))
    const { runtime } = await newChat(socket)
    await stopAsking(socket, runtime, true)
    await turn(socket, runtime, 'Set up [[tool: write_file {"path":"~/.ssh/config","content":"Host contract\\n"}]]')
    expect(asked(socket)).toBe(0)
  })

  it('is for that chat only', async () => {
    socket = await connect((r) => (r.method === 'approval' ? { choice: 'deny' } : undefined))
    const one = await newChat(socket)
    await stopAsking(socket, one.runtime, true)
    const other = await newChat(socket)
    expect(await stands(socket, other.runtime)).toBe(false)
    await turn(socket, other.runtime, risky('other'))
    expect(asked(socket)).toBe(1)
    expect(ran(socket, other.runtime).result).toMatchObject({ status: 'blocked' })
  })

  it('asks again once switched back', async () => {
    socket = await connect((r) => (r.method === 'approval' ? { choice: 'deny' } : undefined))
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, 'hello')
    await stopAsking(socket, runtime, true)
    expect(await stopAsking(socket, runtime, false)).toMatchObject({ value: '0' })
    expect(unaskedOf(said(socket, runtime))).toBe(false)
    await turn(socket, runtime, risky('again'))
    expect(asked(socket)).toBe(1)
    expect(ran(socket, runtime).result).toMatchObject({ status: 'blocked' })
  })

  it('is kept with the chat: closed and opened again, it still says so and still goes ahead', async () => {
    socket = await connect((r) => (r.method === 'approval' ? { choice: 'deny' } : undefined))
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'hello')
    await stopAsking(socket, runtime, true)
    await socket.request('session.close', { session_id: runtime })

    const before = socket.events.length
    const resumed = await socket.request<{ session_id: string; info: Info }>('session.resume', { session_id: stored, profile: 'default', source: 'desktop' })
    // Said by itself as the chat opens, before anything is asked of it.
    const told = await socket.until('the opened chat to say whether it asks', () =>
      socket!.events.slice(before).find((e) => e.type === 'session.info' && e.session_id === resumed.session_id && unaskedOf(e.payload as Info) !== undefined),
    )
    expect(unaskedOf(told.payload as Info)).toBe('chat')
    await turn(socket, resumed.session_id, risky('kept'))
    expect(asked(socket)).toBe(0)
    expect(ran(socket, resumed.session_id).result).toMatchObject({ exit_code: 0 })
  })

  it("says when asking is off for all of Hermes, which a chat's switch can't undo", async () => {
    socket = await connect()
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, 'hello')
    await socket.request('config.set', { session_id: runtime, key: 'yolo', value: 'on', scope: 'global' })
    try {
      expect(unaskedOf(said(socket, runtime))).toBe('everywhere')
      expect(await stopAsking(socket, runtime, false)).toMatchObject({ value: '0' })
      expect(unaskedOf(said(socket, runtime))).toBe('everywhere')
    } finally {
      await socket.request('config.set', { session_id: runtime, key: 'yolo', value: 'off', scope: 'global' })
    }
    expect(unaskedOf(said(socket, runtime))).toBe(false)
  })
})
