// Groups are Hermes's hosted rooms (src/state/groups.ts): made with members,
// talked to, read back as a log, renamed and disbanded.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { agentName, api, connect, sleep, type Socket } from './client'

let socket: Socket
const member = agentName('member')
const room = `murmur-contract-${Date.now().toString(36)}`

type LogEvent = { seq: number; event_id: string; kind: string; actor: unknown; payload: Record<string, unknown>; created_at: number }

async function log(since = 0) {
  return socket.request<{ events: LogEvent[]; latest_seq: number; has_more: boolean }>('groups.log', { room_id: room, since_seq: since, limit: 500 })
}

beforeAll(async () => {
  socket = await connect()
  await socket.request('profiles.create', { name: member, share_auth: true }, 120_000)
})
afterAll(async () => {
  await api.call('DELETE', `/api/profiles/${member}`)
  socket?.close()
})

describe('a group', () => {
  it('runs the room driver', async () => {
    expect(await socket.request('groups.capabilities', {})).toMatchObject({ driver: true })
  })

  it('is made with the members Murmur names', async () => {
    const created = await socket.request('groups.create', {
      room_id: room,
      name: 'Hermes & Member',
      members: [
        { member_id: 'default', profile: 'default', handle: 'hermes', display_name: 'Hermes' },
        { member_id: member, profile: member, handle: member, display_name: 'Member' },
      ],
    })
    expect(created.room).toMatchObject({ room_id: room, name: 'Hermes & Member' })
    const { rooms } = await socket.request('groups.list', { limit: 200 })
    expect(rooms.find((r: { room_id: string }) => r.room_id === room)).toMatchObject({
      members: [expect.objectContaining({ member_id: 'default', profile: 'default', handle: 'hermes', display_name: 'Hermes' }), expect.anything()],
      created_at: expect.any(Number),
      updated_at: expect.any(Number),
    })
  })

  it('takes a message, and a member answers it in the log', async () => {
    const sent = await socket.request('groups.send', { room_id: room, event_id: 'contract-1', payload: { text: '@hermes hi [[say: Hello room]]', thread_id: 'main' } })
    expect(sent.event).toMatchObject({ event_id: expect.any(String), kind: 'message.user' })

    let events: LogEvent[] = []
    for (let i = 0; i < 60 && !events.some((e) => e.kind === 'turn.settled'); i++) {
      await sleep(1000)
      events = (await log()).events
    }
    const said = events.find((e) => e.kind === 'message.member')!
    expect(said.payload).toMatchObject({ text: 'Hello room', member_id: 'default', round_index: expect.any(Number) })
    expect(said).toMatchObject({ seq: expect.any(Number), created_at: expect.any(Number) })
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['message.user', 'message.member', 'turn.settled']))
  })

  it('reports the room’s state, with what’s waiting', async () => {
    const state = await socket.request('groups.state', { room_id: room })
    expect(state.room).toMatchObject({ room_id: room, latest_seq: expect.any(Number) })
    expect(state.driver_status).toMatchObject({ working: false, blocked: false, pending_actions: [] })
  })

  it('reads the log from a point, for polling', async () => {
    const all = await log()
    const tail = await log(all.latest_seq - 1)
    expect(tail.events.map((e) => e.seq)).toEqual([all.latest_seq])
    expect(tail.has_more).toBe(false)
  })

  it('keeps each member’s side as a hidden chat named after the room', async () => {
    const { sessions } = await socket.request('session.list', { profile: 'default', title: `Group: ${room}`, include_hidden: true, limit: 5 })
    expect(sessions[0]).toMatchObject({ title: `Group: ${room}`, source: 'bot_room', id: expect.any(String) })
  })

  it('is renamed, logging the new name', async () => {
    const renamed = await socket.request('groups.rename', { room_id: room, event_id: 'rn-contract', name: 'Renamed' })
    expect(renamed.room.name).toBe('Renamed')
    expect((await log()).events.at(-1)).toMatchObject({ kind: 'room.renamed', payload: { name: 'Renamed' } })
  })

  it('is disbanded, and then reads as not found', async () => {
    await socket.request('groups.disband', { room_id: room })
    const { rooms } = await socket.request('groups.list', { limit: 200 })
    expect(rooms.map((r: { room_id: string }) => r.room_id)).not.toContain(room)
    // Murmur treats code 4112 or "not found" as a room that's gone.
    const error = await socket.failure('groups.log', { room_id: room, since_seq: 0, limit: 10 })
    expect(error.code === 4112 || /not found/i.test(error.message)).toBe(true)
  })
})
