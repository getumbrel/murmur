// How tests reach Hermes: the way the app does, through Murmur's server. REST
// goes to /hermes/api/*, and the socket is Hermes's own client (the one
// Murmur vendors) on /hermes/api/ws.

import { inject } from 'vitest'
import { JsonRpcGatewayClient, type GatewayEvent } from '@/hermes/vendor/json-rpc-gateway'
import type { ServerRequest } from '@/hermes/vendor/json-rpc-channel'

export const MURMUR = inject('murmur')

export type Res<T> = { status: number; body: T }

async function call<T>(method: string, path: string, body?: unknown): Promise<Res<T>> {
  const res = await fetch(`${MURMUR}/hermes${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {}
  return { status: res.status, body: parsed as T }
}

/** A REST call that must succeed (2xx); its body. */
async function ok<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await call<T>(method, path, body)
  if (res.status < 200 || res.status > 299) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`)
  return res.body
}

// Loose on purpose: tests check the fields Murmur reads, not every field Hermes sends.
type Json = any

export const api = {
  /** The raw response, for tests about status codes. */
  call: <T = Json>(method: string, path: string, body?: unknown) => call<T>(method, path, body),
  get: <T = Json>(path: string) => ok<T>('GET', path),
  post: <T = Json>(path: string, body: unknown = {}) => ok<T>('POST', path, body),
  put: <T = Json>(path: string, body: unknown = {}) => ok<T>('PUT', path, body),
  patch: <T = Json>(path: string, body: unknown = {}) => ok<T>('PATCH', path, body),
  delete: <T = Json>(path: string, body?: unknown) => ok<T>('DELETE', path, body),
}

export const q = (agent: string) => `profile=${encodeURIComponent(agent)}`

export type Socket = Awaited<ReturnType<typeof connect>>

/** A socket like the app's, which records every event and answers server requests with `answer`. */
export async function connect(answer?: (request: ServerRequest) => Record<string, unknown> | undefined) {
  const client = new JsonRpcGatewayClient({ requestIdPrefix: 't' })
  const events: GatewayEvent[] = []
  const requests: ServerRequest[] = []
  const waiters = new Set<() => void>()
  client.onEvent((event) => {
    events.push(event)
    for (const wake of waiters) wake()
  })
  client.onRequest((request) => {
    requests.push(request)
    for (const wake of waiters) wake()
    const result = answer?.(request)
    if (!result) return false
    request.respond(result)
    return true
  })
  await client.connect(`${MURMUR.replace(/^http/, 'ws')}/hermes/api/ws`)

  /** Resolves with the first thing `find` returns, re-checked on every event or request. */
  function until<T>(what: string, find: () => T | undefined, timeoutMs = 60_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = find()
        if (found === undefined) return false
        waiters.delete(check)
        clearTimeout(timer)
        resolve(found)
        return true
      }
      const timer = setTimeout(() => {
        waiters.delete(check)
        reject(new Error(`Timed out waiting for ${what}`))
      }, timeoutMs)
      if (!check()) waiters.add(check)
    })
  }

  const socket = {
    events,
    requests,
    request: <T = Json>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number) => client.request<T>(method, params, timeoutMs),
    /** The error a request fails with (or a test failure if it succeeds). */
    async failure(method: string, params: Record<string, unknown> = {}) {
      try {
        await client.request(method, params)
      } catch (error) {
        return error as Error & { code?: number; data?: unknown }
      }
      throw new Error(`${method} succeeded, but should have failed`)
    },
    event: <K extends GatewayEvent['type']>(type: K, sessionId?: string, timeoutMs?: number) =>
      until(`${type}${sessionId ? ` on ${sessionId}` : ''}`, () =>
        events.find((e) => e.type === type && (!sessionId || e.session_id === sessionId)) as GatewayEvent<K> | undefined,
      timeoutMs),
    serverRequest: (method: string, timeoutMs?: number) =>
      until(`a ${method} request`, () => requests.find((r) => r.method === method), timeoutMs),
    until,
    /** Events for one chat, in order. */
    of: (sessionId: string) => events.filter((e) => e.session_id === sessionId),
    close: () => client.close(),
  }
  return socket
}

/** A new chat with `agent`, made the way the app makes one. */
export async function newChat(socket: Socket, agent = 'default') {
  const created = await socket.request<{ session_id: string; stored_session_id: string; info: Json }>('session.create', {
    profile: agent,
    source: 'desktop',
  })
  return { runtime: created.session_id, stored: created.stored_session_id, created }
}

/** Sends `text` and waits for the turn to finish; the message.complete event. */
export async function turn(socket: Socket, runtime: string, text: string, agent = 'default') {
  const before = socket.events.length
  await socket.request('prompt.submit', { session_id: runtime, text, profile: agent })
  return socket.until(`the turn on ${runtime} to finish`, () =>
    socket.events.slice(before).find((e): e is GatewayEvent<'message.complete'> => e.type === 'message.complete' && e.session_id === runtime),
  120_000)
}

/** Every request Hermes sent the fake model so far. */
export async function modelRequests(): Promise<{ path: string; body: Json; auth?: string }[]> {
  return (await fetch(`${inject('model').local}/_requests`)).json()
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Hermes can still call a chat busy (4009) for a moment after message.complete,
 * while it wraps the turn up: an edit or an undo sent then is refused, where a
 * new message would just wait its turn. Retries `run` through that, for up to 10s.
 */
export async function whenIdle<T>(run: () => Promise<T>): Promise<T> {
  for (let tries = 0; ; tries++) {
    try {
      return await run()
    } catch (error) {
      if ((error as { code?: number }).code !== 4009 || tries >= 40) throw error
      await sleep(250)
    }
  }
}

/** A name for a throwaway agent, unique to this run. */
export const agentName = (what: string) => `contract-${what}-${Date.now().toString(36)}`
