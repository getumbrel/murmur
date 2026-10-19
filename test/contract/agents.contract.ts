// Agents are Hermes profiles (src/state/agents.ts, src/hermes/compat.ts).
// Murmur's own createAgent, updateAgent, fetchAgentChats and deleteAgent run
// here against Hermes, and the fields they rely on are checked on the wire.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { listProfiles } from '@/hermes/compat'
import { composeSoul, createAgent, deleteAgent, fetchAgentChats, fetchSoul, readSoul, toAgent, updateAgent, type Profile } from '@/state/agents'
import { api, connect, newChat, sleep, turn, type Socket } from './client'

let socket: Socket
let id: string
const name = `Contract Scout ${Date.now().toString(36)}`

const profile = async (agent: string) => (await listProfiles<Profile>({ include_sessions: true })).find((p) => p.name === agent)!

beforeAll(async () => {
  startGateway()
  socket = await connect()
})
afterAll(async () => {
  if (id) await api.call('DELETE', `/api/profiles/${id}`)
  socket?.close()
  stopGateway()
})

describe('an agent', () => {
  it('is made by Murmur with its look, role and soul', async () => {
    const soul = composeSoul(name, 'Finds things', 'warm')
    id = await createAgent({ name, hue: 210, role: 'Finds things', soul, template: 'scout' })
    expect(id).toMatch(/^contract-scout-/)

    const agent = toAgent(await profile(id))
    expect(agent).toMatchObject({ id, name, hue: 210, role: 'Finds things', isDefault: false, template: 'scout', model: 'murmur-fake-small' })
    expect(readSoul(await fetchSoul(id))).toEqual({ personality: 'warm', custom: '' })
  })

  it('shares the main agent’s model, so it can talk straight away', async () => {
    const { runtime } = await newChat(socket, id)
    expect((await turn(socket, runtime, 'Hello [[say: Ready]]', id)).payload?.text).toBe('Ready')
  })

  it('is edited without losing what Hermes Desktop keeps', async () => {
    const before = await profile(id)
    // Something Hermes Desktop's Bot Mode wrote, which Murmur must keep.
    await socket.request('profiles.configure', { name: id, ui_meta: { 'hermes-bots': { ...(before.ui_meta?.['hermes-bots'] as object), avatar: 'desktop' } } })
    await updateAgent(toAgent(await profile(id)), { name: `${name} II`, hue: 30, role: 'Finds more' })

    const after = await profile(id)
    expect(toAgent(after)).toMatchObject({ name: `${name} II`, hue: 30, role: 'Finds more', template: 'scout' })
    expect(after.ui_meta?.['hermes-bots']).toMatchObject({ avatar: 'desktop', imageKind: 'shape' })
  })

  it('shows its newest chat on Home, and lists its chats', async () => {
    const { runtime, stored } = await newChat(socket, id)
    await turn(socket, runtime, 'Plan the trip [[say: Packed]]', id)
    await sleep(500)

    const row = await profile(id)
    expect(row.last_session).toMatchObject({ id: stored, preview: 'Packed', started_at: expect.any(Number), last_active: expect.any(Number), message_count: 2 })
    expect(row).toHaveProperty('canonical_session')
    expect(toAgent(row).lastChat).toMatchObject({ id: stored, at: expect.any(Number) })

    // The chat list previews how a chat began; Home, what was said last.
    const chats = await fetchAgentChats(id)
    expect(chats[0]).toMatchObject({ id: stored, preview: 'Plan the trip [[say: Packed]]', messageCount: 2, source: 'desktop' })
  })

  it('is listed over REST too, for older Hermes and the group picker', async () => {
    const { profiles } = await api.get('/api/profiles')
    expect(profiles.find((p: { name: string }) => p.name === id)).toMatchObject({ is_default: false, description: 'Finds more', model: expect.any(String) })
  })

  it('is removed with its chats, and the main agent can’t be', async () => {
    await deleteAgent(toAgent(await profile(id)))
    expect((await listProfiles()).map((p) => p.name)).not.toContain(id)
    id = ''
    expect((await api.call('DELETE', '/api/profiles/default')).status).toBeGreaterThanOrEqual(400)
  })
})
