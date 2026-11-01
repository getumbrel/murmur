// What Murmur shows of an agent's Umbrel (src/features/umbrel/finds.ts) relies
// on how Hermes reports umbrelOS's tools: reached through tool search (one
// tool_call), they're reported live under their own names with the tool's text
// inside {"result": …}, a picture the tool returned is cached and named on a
// MEDIA: line, and the stored result is the same text wrapped as untrusted data
// (Murmur connects umbrelOS as a server to ask about first, umbrel-mcp.ts).

import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { foundIn } from '@/features/umbrel/finds'
import { UMBREL_KEY, UMBREL_PHOTO } from './fake-model'
import { api, connect, newChat, q, turn, type Socket } from './client'

let socket: Socket
const p = q('default')
const server = 'umbrel'

beforeAll(async () => {
  startGateway()
  socket = await connect()
  const url = `${inject('model').forHermes.replace(/\/v1$/, '')}/mcp/umbrel`
  // As connectUmbrel does it: the key in the agent's .env, and asked about before acting.
  await api.post(`/api/mcp/servers?${p}`, { name: server, url, auth: 'header', bearer_token: UMBREL_KEY, profile: 'default' })
  await api.put(`/api/config?${p}`, { config: { mcp_servers: { [server]: { trust: 'untrusted' } } } })
  await socket.request('reload.mcp', { confirm: true })
})
afterAll(async () => {
  await api.call('DELETE', `/api/mcp/servers/${server}?${p}`)
  socket?.close()
  stopGateway()
})

/** Asks the fake model to reach an umbrelOS tool the way a real agent does: through tool search. */
const ask = (tool: string, args: Record<string, unknown>) =>
  `[[tool: tool_call ${JSON.stringify({ calls: [{ name: `mcp__${server}__${tool}`, arguments: args }] })}]]`

async function call(tool: string, args: Record<string, unknown>) {
  const { runtime, stored } = await newChat(socket)
  await turn(socket, runtime, ask(tool, args))
  const done = socket.of(runtime).find((e) => e.type === 'tool.complete')
  const live = done?.payload as { name?: string; args?: unknown; result?: unknown } | undefined
  const res = await api.get<{ messages: { role: string; content: string }[] }>(`/api/sessions/${stored}/messages?${p}&order=latest&limit=50`)
  return { live, stored: res.messages.find((m) => m.role === 'tool')?.content }
}

describe('umbrelOS results', () => {
  it('reports a search under its own name, live and in history alike', async () => {
    const { live, stored } = await call('search', { query: 'the beach', scope: 'photos' })
    expect(live?.name).toBe('mcp__umbrel__search')
    expect(live?.args).toEqual({ query: 'the beach', scope: 'photos' })
    const found = foundIn(live!.name!, live!.args, live!.result)
    expect(found).toEqual({
      server: 'umbrel',
      piece: {
        kind: 'search',
        query: 'the beach',
        filters: ['Big Sur'],
        photos: [{ id: UMBREL_PHOTO, takenAt: '2025-06-14T09:00:00-07:00' }],
        files: [expect.objectContaining({ name: 'Rental.pdf', snippet: 'private beach access', page: 3 })],
      },
    })
    expect(stored).toMatch(/^<untrusted_tool_result/)
    expect(foundIn('mcp__umbrel__search', { query: 'the beach' }, stored)).toEqual(found)
  })

  it('keeps the picture a tool hands back, and says where', async () => {
    const { live, stored } = await call('get_photo', { id: UMBREL_PHOTO })
    const found = foundIn(live!.name!, live!.args, live!.result)
    expect(found?.piece).toMatchObject({ kind: 'look', photo: { id: UMBREL_PHOTO, media: expect.stringMatching(/^\/opt\/data\/.+\.png$/) } })
    expect(foundIn('mcp__umbrel__get_photo', {}, stored)?.piece).toEqual(found?.piece)
  })
})
