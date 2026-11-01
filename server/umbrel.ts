// Pictures of what an agent found on its Umbrel. umbrelOS's search and
// list_photos tools answer with Photos IDs, not pictures; its get_photo tool
// has the picture, 512 pixels on its short side (what Photos shows in its
// grid). Murmur asks for it the way the agent would: with that agent's own
// key, at the address the agent uses, so it can't see anything the agent
// can't. It names itself, so umbrelOS lists the request as Murmur's.
//
//   GET /murmur/umbrel/photo?agent=<profile>&server=<name>&id=<photo id>&v=<Murmur's version>

import type http from 'node:http'
import type { Hermes } from './hermes.ts'
import { hermesFor } from './connection.ts'
import { sendJson } from './http.ts'

const PHOTO_ID = /^[a-f0-9]{64}$/
const NAME = /^[A-Za-z0-9_.-]{1,64}$/
/** How long an agent's address and key are trusted before they're read again. */
const CREDENTIALS_MS = 5 * 60_000
/** Pictures kept in memory: a grid's worth for a good while (each is 20–60 KB). */
const KEEP = 400
/** At most this many at once per Umbrel: it makes each on demand. */
const AT_ONCE = 4

type Credentials = { url: string; key: string; at: number }
type Picture = { type: string; body: Buffer }

const credentials = new WeakMap<Hermes, Map<string, Promise<Credentials | null>>>()
const pictures = new Map<string, Picture>()
const fetching = new Map<string, Promise<Picture | null>>()

/** Where Hermes keeps a server's key (mcp_config._env_key_for_server; umbrel-mcp.ts). */
const envKeyOf = (server: string) => `MCP_${server.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_API_KEY`

async function readCredentials(hermes: Hermes, agent: string, server: string): Promise<Credentials | null> {
  const q = `profile=${encodeURIComponent(agent)}`
  const listed = await hermes.send<{ servers?: { name: string; url?: string | null; enabled?: boolean }[] }>('GET', `/api/mcp/servers?${q}`)
  const entry = listed.body?.servers?.find((s) => s.name === server && s.enabled !== false)
  if (!entry?.url) return null
  const revealed = await hermes.send<{ value?: string }>('POST', `/api/env/reveal?${q}`, { key: envKeyOf(server), profile: agent })
  const key = revealed.body?.value?.trim()
  return key ? { url: entry.url, key, at: Date.now() } : null
}

async function credentialsFor(hermes: Hermes, agent: string, server: string, fresh = false): Promise<Credentials | null> {
  let byAgent = credentials.get(hermes)
  if (!byAgent) credentials.set(hermes, (byAgent = new Map()))
  const id = `${agent}\n${server}`
  // A grid of thumbnails shares one read.
  const pending = byAgent.get(id)
  if (pending && !fresh) {
    const had = await pending
    if (had && Date.now() - had.at < CREDENTIALS_MS) return had
    const again = byAgent.get(id)
    if (again && again !== pending) return again
  }
  const next = readCredentials(hermes, agent, server).catch(() => null)
  byAgent.set(id, next)
  return next
}

// One queue per Umbrel, so a grid of thumbnails doesn't ask for all of them at once.
const running = new Map<string, number>()
const waiting = new Map<string, (() => void)[]>()

async function inTurn<T>(umbrel: string, work: () => Promise<T>): Promise<T> {
  if ((running.get(umbrel) ?? 0) >= AT_ONCE) await new Promise<void>((go) => waiting.set(umbrel, [...(waiting.get(umbrel) ?? []), go]))
  running.set(umbrel, (running.get(umbrel) ?? 0) + 1)
  try {
    return await work()
  } finally {
    running.set(umbrel, (running.get(umbrel) ?? 1) - 1)
    const queue = waiting.get(umbrel)
    queue?.shift()?.()
    if (!queue?.length) waiting.delete(umbrel)
  }
}

class Refused extends Error {}

/** One MCP tool call. umbrelOS's server is stateless and answers in JSON or one server-sent event. */
async function callTool(c: Credentials, name: string, args: Record<string, unknown>, version: string) {
  const res = await fetch(c.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${c.key}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'murmur', title: 'Murmur', version } } },
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 401 || res.status === 403) throw new Refused(String(res.status))
  const text = await res.text()
  if (!res.ok) throw new Error(`umbrelOS answered ${res.status}`)
  const messages = (res.headers.get('content-type') ?? '').includes('text/event-stream')
    ? text.split('\n').flatMap((line) => (line.startsWith('data:') ? [line.slice(5).trim()] : []))
    : [text]
  for (const raw of messages) {
    try {
      const message = JSON.parse(raw) as { id?: unknown; result?: { content?: unknown[]; isError?: boolean } }
      if (message.id === 1) return message.result ?? null
    } catch {
      /* not this one */
    }
  }
  return null
}

export async function fetchPicture(hermes: Hermes, agent: string, server: string, id: string, version: string): Promise<Picture | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = await credentialsFor(hermes, agent, server, attempt > 0)
    if (!c) return null
    try {
      const result = await inTurn(c.url, () => callTool(c, 'get_photo', { id, image: true }, version))
      if (!result || result.isError) return null
      const image = (result.content ?? []).find(
        (b): b is { type: 'image'; data: string; mimeType: string } =>
          !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'image' && typeof (b as { data?: unknown }).data === 'string',
      )
      if (!image || !/^image\/(webp|jpeg|png|avif|gif)$/.test(image.mimeType)) return null
      return { type: image.mimeType, body: Buffer.from(image.data, 'base64') }
    } catch (error) {
      // A key that changed since it was read: read it again, once. Still no: there's no picture to have.
      if (error instanceof Refused) {
        if (!attempt) continue
        return null
      }
      throw error
    }
  }
  return null
}

function keep(key: string, picture: Picture) {
  pictures.delete(key)
  pictures.set(key, picture)
  while (pictures.size > KEEP) pictures.delete(pictures.keys().next().value!)
}

export async function handleUmbrel(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (url.pathname !== '/murmur/umbrel/photo' || req.method !== 'GET') return false
  const agent = url.searchParams.get('agent') ?? ''
  const server = url.searchParams.get('server') ?? ''
  const id = url.searchParams.get('id') ?? ''
  const version = (url.searchParams.get('v') ?? '').slice(0, 32) || 'unknown'
  if (!NAME.test(agent) || !NAME.test(server) || !PHOTO_ID.test(id)) {
    sendJson(res, 400, { error: 'bad_request' })
    return true
  }
  const hermes = hermesFor(req, url)
  if (!hermes) {
    sendJson(res, 409, { error: 'hermes_gone' })
    return true
  }
  const key = `${hermes.url}\n${agent}\n${server}\n${id}`
  let picture = pictures.get(key) ?? null
  if (!picture) {
    let pending = fetching.get(key)
    if (!pending) {
      pending = fetchPicture(hermes, agent, server, id, version).finally(() => fetching.delete(key))
      fetching.set(key, pending)
    }
    try {
      picture = await pending
    } catch {
      sendJson(res, 502, { error: 'umbrel_unreachable' })
      return true
    }
    if (picture) keep(key, picture)
  } else keep(key, picture)
  if (!picture) {
    sendJson(res, 404, { error: 'not_found' })
    return true
  }
  res.writeHead(200, {
    'content-type': picture.type,
    'content-length': picture.body.length,
    // The same photo, the same picture: kept by this browser for a day.
    'cache-control': 'private, max-age=86400',
    'x-content-type-options': 'nosniff',
  })
  res.end(picture.body)
  return true
}
