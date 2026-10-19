// What the agent page and settings read and write besides chats: config,
// tools, memory, apps, messaging, who may message an agent, insights and
// backups. Murmur's own readers run on the real answers where it has them.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { accessFrom } from '@/state/access'
import { importAgent } from '@/state/backups'
import { chatUsageOf, slicesOf, summarizeWeek } from '@/state/insights'
import { ensureAgentTimezone, readTimezone } from '@/state/timezone'
import { HIDDEN_TOOLSETS, hideDesktopToolsets } from '@/state/toolsets'
import { agentName, api, connect, newChat, q, turn, type Socket } from './client'

let socket: Socket
const agent = agentName('settings')
const p = q(agent)

beforeAll(async () => {
  startGateway()
  socket = await connect()
  await socket.request('profiles.create', { name: agent, share_auth: true }, 120_000)
})
afterAll(async () => {
  await api.call('DELETE', `/api/profiles/${agent}`)
  socket?.close()
  stopGateway()
})

const config = () => api.get(`/api/config?${p}&include_defaults=false`)

describe('config', () => {
  it('saves a timezone for a new agent, and reads it back', async () => {
    expect(await readTimezone(agent)).toBe('')
    const zone = await ensureAgentTimezone(agent, { restart: false })
    expect(zone).toEqual(expect.any(String))
    expect(await readTimezone(agent)).toBe(zone)
  })

  it('merges a PUT into what’s there, rather than replacing it', async () => {
    await api.put(`/api/config?${p}`, { config: { display: { in_app_tips: false } } })
    await api.put(`/api/config?${p}`, { config: { display: { message_reactions: true } } })
    expect((await config()).display).toMatchObject({ in_app_tips: false, message_reactions: true })
    expect((await config()).timezone).toEqual(expect.any(String))
  })

  it('takes the desktop-only toolsets off an agent', async () => {
    await hideDesktopToolsets(agent)
    expect((await config()).agent.disabled_toolsets).toEqual(expect.arrayContaining(HIDDEN_TOOLSETS))
    const toolsets = await api.get(`/api/tools/toolsets?${p}`)
    for (const name of HIDDEN_TOOLSETS) expect(toolsets.find((t: { name: string }) => t.name === name)?.enabled ?? false, name).toBe(false)
    expect(toolsets[0]).toMatchObject({ name: expect.any(String), enabled: expect.any(Boolean) })
  })

  it('lists picture makers, and the defaults Murmur reads', async () => {
    const image = await api.get('/api/tools/toolsets/image_gen/config')
    expect(image.providers[0]).toMatchObject({ name: expect.any(String), is_active: expect.any(Boolean), status: expect.any(String) })
    expect((await api.get('/api/config/defaults')).tools).toHaveProperty('tool_search')
  })

  it('lists commands for the composer', async () => {
    const catalog = await socket.request('commands.catalog', { profile: agent })
    expect(catalog.pairs).toContainEqual(['/new', expect.any(String)])
  })
})

describe('memory', () => {
  it('shows what the agent saved, and edits and forgets it by position', async () => {
    const { runtime } = await newChat(socket, agent)
    await turn(socket, runtime, 'Remember [[tool: memory {"action":"add","target":"user","content":"Prefers tea over coffee"}]]', agent)
    await turn(socket, runtime, 'And [[tool: memory {"action":"add","target":"memory","content":"Lives near the sea"}]]', agent)

    const { memory } = await api.get(`/api/learning/graph?${p}`)
    expect(memory).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'profile', body: 'Prefers tea over coffee' }),
      expect.objectContaining({ source: 'memory', body: 'Lives near the sea' }),
    ]))
    // Murmur's ids: memory:<source>:<index in this list>.
    const index = memory.findIndex((m: { body: string }) => m.body === 'Lives near the sea')
    const id = `memory:memory:${index}`
    expect((await api.get(`/api/learning/node?${p}&id=${encodeURIComponent(id)}`)).content).toContain('Lives near the sea')

    await api.put('/api/learning/node', { id, content: 'Lives by the sea in Lisbon', profile: agent })
    expect((await api.get(`/api/learning/graph?${p}`)).memory.map((m: { body: string }) => m.body)).toContain('Lives by the sea in Lisbon')

    const again = (await api.get(`/api/learning/graph?${p}`)).memory.findIndex((m: { body: string }) => m.body === 'Lives by the sea in Lisbon')
    await api.delete('/api/learning/node', { id: `memory:memory:${again}`, profile: agent })
    expect((await api.get(`/api/learning/graph?${p}`)).memory.map((m: { body: string }) => m.body)).not.toContain('Lives by the sea in Lisbon')

    await api.post(`/api/memory/reset?${p}`, { target: 'all' })
    expect((await api.get(`/api/learning/graph?${p}`)).memory).toEqual([])
  })
})

describe('apps', () => {
  it('has a catalog to pick from', async () => {
    const { entries } = await api.get('/api/mcp/catalog')
    expect(entries[0]).toMatchObject({ name: expect.any(String), description: expect.any(String), auth_type: expect.any(String), required_env: expect.any(Array) })
  })

  it('adds a server by address, switches it off and on, and removes it', async () => {
    const name = 'contract-tools'
    await api.post(`/api/mcp/servers?${p}`, { name, url: 'http://host.docker.internal:9/mcp', auth: 'header', bearer_token: 'contract-token', profile: agent })
    const listed = (await api.get(`/api/mcp/servers?${p}`)).servers.find((s: { name: string }) => s.name === name)
    expect(listed).toMatchObject({ name, url: 'http://host.docker.internal:9/mcp', enabled: true })
    expect((await api.call('POST', `/api/mcp/servers?${p}`, { name, url: 'http://host.docker.internal:9/mcp', auth: 'header', bearer_token: 'x', profile: agent })).status).toBe(409)

    const probe = await api.post(`/api/mcp/servers/${name}/test?${p}`)
    expect(probe).toMatchObject({ ok: false, error: expect.any(String) })

    await api.put(`/api/mcp/servers/${name}/enabled?${p}`, { enabled: false, profile: agent })
    expect((await api.get(`/api/mcp/servers?${p}`)).servers.find((s: { name: string }) => s.name === name).enabled).toBe(false)
    await api.delete(`/api/mcp/servers/${name}?${p}`)
    expect((await api.get(`/api/mcp/servers?${p}`)).servers.map((s: { name: string }) => s.name)).not.toContain(name)
    expect(await socket.request('reload.mcp', { confirm: true })).toBeDefined()
  })
})

describe('messaging', () => {
  it('lists Telegram and WhatsApp with their state', async () => {
    const { platforms } = await api.get(`/api/messaging/platforms?${p}`)
    for (const id of ['telegram', 'whatsapp']) {
      expect(platforms.find((x: { id: string }) => x.id === id), id).toMatchObject({ enabled: false, configured: false, state: expect.any(String) })
    }
  })

  it('lists who may message the agent', async () => {
    const raw = await api.get(`/api/pairing?${p}`)
    expect(raw).toMatchObject({ pending: [], approved: [] })
    expect(accessFrom(agent, raw)).toEqual({ pending: [], allowed: [] })
  })
})

describe('insights', () => {
  it('sums the week from Hermes’s analytics', async () => {
    const { runtime } = await newChat(socket, agent)
    await turn(socket, runtime, 'Count me [[say: Counted]]', agent)
    const raw = await api.get(`/api/analytics/usage?days=31&${p}`)
    expect(raw.daily[0]).toMatchObject({ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), sessions: expect.any(Number), estimated_cost: expect.any(Number) })
    // Hermes keys days in its own timezone; read the week as of the day it reported.
    const week = summarizeWeek(raw, new Date(`${raw.daily.at(-1).day}T12:00`))
    expect(week?.chats).toBeGreaterThan(0)
  })

  it('reads how full a chat is and what fills it', async () => {
    const { runtime, stored } = await newChat(socket, agent)
    await turn(socket, runtime, 'Hi [[say: Hi]]', agent)
    const usage = await socket.request('session.usage', { session_id: runtime }, 15_000)
    const row = await api.get(`/api/sessions/${stored}?${p}`)
    expect(chatUsageOf(usage, row)).toMatchObject({ max: expect.any(Number), used: expect.any(Number), included: false, compressions: 0 })

    const { categories } = await socket.request('session.context_breakdown', { session_id: runtime })
    const slices = slicesOf(categories)
    expect(slices.map((s) => s.id)).toEqual(expect.arrayContaining(['chat', 'instructions', 'tools']))
  })
})

describe('backups', () => {
  it('exports an agent as an archive and brings it back as a new one', async () => {
    const { archive } = await api.post(`/api/profiles/${agent}/export`, { extra_files: { 'murmur.json': JSON.stringify({ name: 'Settings', hue: 120, role: 'Tests' }) } })
    expect(archive).toMatch(/\.tar\.gz$/)
    const download = await fetch(`/hermes/api/fs/download?${new URLSearchParams({ path: archive })}`)
    expect(download.ok).toBe(true)
    const file = new File([await download.arrayBuffer()], `${agent}-agent-2026-10-19.tar.gz`)

    const id = await importAgent(file, [])
    try {
      const { profiles } = await socket.request('profiles.list', {})
      expect(profiles.find((x: { name: string }) => x.name === id)?.ui_meta).toMatchObject({ murmur: { hue: 120 } })
    } finally {
      await api.call('DELETE', `/api/profiles/${id}`)
    }
  })
})
