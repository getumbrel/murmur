import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Hermes } from './hermes.ts'
import { fetchPicture } from './umbrel.ts'

const KEY = `umbrelmcp_${'a'.repeat(32)}_${'b'.repeat(64)}`
const ID = 'f'.repeat(64)
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// umbrelOS's MCP endpoint as the SDK serves it: stateless, answering in one server-sent event.
let umbrel: http.Server
let url = ''
const seen: { auth?: string; body: any }[] = []
let key = KEY

beforeAll(async () => {
  umbrel = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw)
      seen.push({ auth: req.headers.authorization, body })
      if (req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end()
      const found = body.params.arguments.id === ID
      const result = found
        ? { content: [{ type: 'text', text: JSON.stringify({ id: ID }) }, { type: 'image', data: PIXEL, mimeType: 'image/png' }] }
        : { content: [{ type: 'text', text: `[photos-item-not-found] '${body.params.arguments.id}'` }], isError: true }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(`event: message\ndata: ${JSON.stringify({ result, jsonrpc: '2.0', id: body.id })}\n\n`)
    })
  })
  await new Promise<void>((r) => umbrel.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(umbrel.address() as AddressInfo).port}/mcp`
})
afterAll(() => new Promise<void>((r) => umbrel.close(() => r())))

/** A Hermes that knows one agent with an Umbrel, at `url`, whose key is `key`. */
const hermes = (name = 'umbrel') =>
  ({
    url: `hermes-${Math.random()}`,
    send: async (method: string, path: string, body?: { key?: string }) => {
      if (method === 'GET' && path.startsWith('/api/mcp/servers?profile=default')) return { status: 200, body: { servers: [{ name, url, enabled: true }] } }
      if (method === 'POST' && path.startsWith('/api/env/reveal?profile=default') && body?.key === 'MCP_UMBREL_API_KEY') return { status: 200, body: { value: key } }
      return { status: 404, body: null }
    },
  }) as unknown as Hermes

describe('pictures of what an agent found', () => {
  it('asks umbrelOS with the agent’s own key, and names itself', async () => {
    const picture = await fetchPicture(hermes(), 'default', 'umbrel', ID, '0.7.0')
    expect(picture?.type).toBe('image/png')
    expect(picture?.body.equals(Buffer.from(PIXEL, 'base64'))).toBe(true)
    const call = seen.at(-1)!
    expect(call.auth).toBe(`Bearer ${KEY}`)
    expect(call.body).toMatchObject({
      method: 'tools/call',
      params: { name: 'get_photo', arguments: { id: ID, image: true }, _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'murmur', version: '0.7.0' } } },
    })
  })

  it('has nothing for a photo umbrelOS doesn’t know, or an agent with no Umbrel', async () => {
    expect(await fetchPicture(hermes(), 'default', 'umbrel', '0'.repeat(64), '0.7.0')).toBeNull()
    expect(await fetchPicture(hermes('github'), 'default', 'umbrel', ID, '0.7.0')).toBeNull()
  })

  it('reads the key again when umbrelOS turns it down', async () => {
    const h = hermes()
    key = 'umbrelmcp_old'
    await expect(fetchPicture(h, 'default', 'umbrel', ID, '0.7.0')).resolves.toBeNull()
    key = KEY
    expect(await fetchPicture(h, 'default', 'umbrel', ID, '0.7.0')).not.toBeNull()
  })
})
