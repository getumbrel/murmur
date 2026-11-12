// The live connections to Hermes: one JSON-RPC socket (/api/ws) per Hermes,
// the same protocol Hermes Desktop speaks. Hermes's own client handles
// requests, heartbeats and lossless replay; this module owns dialing and
// redialing each, and sends every call to the Hermes it's for (route.ts).
//
// `gateway` is all of them as one: its listeners hear every Hermes, and each
// event and request says which it came from (`hermes`).

import { create } from 'zustand'
import {
  JsonRpcGatewayClient,
  type ConnectionState,
  type GatewayEvent as WireEvent,
  type GatewayEventName,
} from './vendor/json-rpc-gateway'
import type { ServerRequest as WireRequest } from './vendor/json-rpc-channel'
import { SESSION_CHECK } from './rest'
import { browserServers, firstHermes, HERMES_GONE, HERMES_PARAM, hermesIds, noteHome, onHermesIds } from './instance'
import { noteAnswer, routeCall } from './route'

/** An event from Hermes, and which Hermes. */
export type GatewayEvent<K extends GatewayEventName = GatewayEventName> = WireEvent<K> & { hermes?: string | null }
/** A question from Hermes (an approval, a login), and which Hermes. */
export type ServerRequest = WireRequest & { hermes?: string | null }
export type { ConnectionState }

type Link = {
  /** Null only before the server has named any Hermes (a first visit in development). */
  hermes: string | null
  client: JsonRpcGatewayClient
  attempt: number
  timer: ReturnType<typeof setTimeout> | undefined
  /** Counting down to "away" while the socket is down. */
  awayTimer: ReturnType<typeof setTimeout> | undefined
  /** Being dialed (and redialed): not before the app starts, nor for a Hermes it's left or can't use. */
  live: boolean
}

const key = (hermes: string | null) => hermes ?? ''
const links = new Map<string, Link>()

type EventHandler = (event: GatewayEvent) => void
type RequestHandler = (request: ServerRequest) => boolean | void
type StateHandler = (state: ConnectionState, hermes: string | null) => void

const eventHandlers = new Set<EventHandler>()
const requestHandlers = new Set<RequestHandler>()
const stateHandlers = new Set<StateHandler>()

// ── How each is doing ───────────────────────────────────────────────────────

export type LinkState = {
  state: ConnectionState
  everOpened: boolean
  /** Not open for a moment now (blips don't count): its agents can't be reached. */
  away: boolean
}
const IDLE: LinkState = { state: 'idle', everOpened: false, away: false }

/** How long a socket may be down before its Hermes counts as away: longer than a slow first dial, or a phone's redial as it wakes. */
const AWAY_AFTER_MS = 4000

const useLinks = create<Record<string, LinkState>>(() => ({}))

/**
 * How the socket to one Hermes is doing: the one an agent lives on
 * (`useConnection(hermesOf(agentId))`), or the first.
 */
export function useConnection(): LinkState
export function useConnection(hermes: string | null | undefined): LinkState
export function useConnection<T>(select: (s: LinkState) => T, hermes?: string | null): T
export function useConnection<T>(a?: ((s: LinkState) => T) | string | null, b?: string | null) {
  const select = typeof a === 'function' ? a : undefined
  const hermes = typeof a === 'function' ? b : a
  return useLinks((all) => {
    const link = all[key(hermes ?? firstHermes())] ?? IDLE
    return select ? select(link) : link
  })
}
useConnection.getState = (hermes?: string | null): LinkState => useLinks.getState()[key(hermes ?? firstHermes())] ?? IDLE

/** Every Hermes's socket, by Hermes. */
export const useConnections = () => useLinks()

/** Whether a Hermes is away: its socket has been down for a moment. */
export const useAway = (hermes: string | null | undefined) => useConnection((s) => s.away, hermes)

// ── Dialing ─────────────────────────────────────────────────────────────────

const url = (hermes: string | null) =>
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/hermes/api/ws${hermes ? `?${HERMES_PARAM}=${hermes}` : ''}`

function linkTo(hermes: string | null): Link {
  const had = links.get(key(hermes))
  if (had) return had
  const client = new JsonRpcGatewayClient({
    requestIdPrefix: 'm',
    closedErrorMessage: 'Lost connection to Hermes',
    notConnectedErrorMessage: 'Not connected to Hermes',
  })
  const link: Link = { hermes, client, attempt: 0, timer: undefined, awayTimer: undefined, live: false }
  links.set(key(hermes), link)
  client.onEvent((event) => {
    const ev = event as GatewayEvent
    ev.hermes = hermes
    noteHome(ev.session_id, hermes)
    noteAnswer(hermes, ev.payload)
    for (const handler of [...eventHandlers]) handler(ev)
  })
  client.onRequest((request) => {
    const req = request as ServerRequest
    req.hermes = hermes
    noteHome((req.params as { session_id?: unknown } | undefined)?.session_id, hermes)
    // As the client does it: each in turn, until one doesn't decline.
    for (const handler of [...requestHandlers]) if (handler(req) !== false) return true
    return false
  })
  client.onState((state) => {
    // (The client itself announces that we answer approvals and questions.)
    const set = (change: Partial<LinkState>) =>
      useLinks.setState((all) => ({ [key(hermes)]: { ...(all[key(hermes)] ?? IDLE), ...change } }))
    if (state === 'open') {
      clearTimeout(link.awayTimer)
      link.awayTimer = undefined
      set({ state, everOpened: true, away: false })
    } else {
      set({ state })
      if (state !== 'idle' && link.live) {
        link.awayTimer ??= setTimeout(() => {
          link.awayTimer = undefined
          if (client.connectionState !== 'open' && link.live) set({ away: true })
        }, AWAY_AFTER_MS)
      }
    }
    if (state === 'closed' || state === 'error') scheduleRedial(link)
    for (const handler of [...stateHandlers]) handler(state, hermes)
  })
  return link
}

async function dial(link: Link) {
  if (!link.live) return
  clearTimeout(link.timer)
  link.timer = undefined
  try {
    await link.client.connect(url(link.hermes))
    link.attempt = 0
  } catch {
    // A refused upgrade looks like any failure; after a few, ask whether we're still signed in.
    if (link.attempt >= 2) window.dispatchEvent(new Event(SESSION_CHECK))
    // That answer also brings the list as it is now: a Hermes that's been removed has nothing to dial.
    const listed = browserServers()
    if (link.hermes && listed.length && !listed.includes(link.hermes)) return void window.dispatchEvent(new Event(HERMES_GONE))
    scheduleRedial(link)
  }
}

function scheduleRedial(link: Link) {
  // A failed dial reports itself several ways ('error', then 'closed', then the
  // rejection); they're one failure, so only the first schedules a retry.
  if (link.timer || !link.live) return
  // 0.5s, 1s, 2s … with a little jitter so tabs don't stampede. Capped low
  // while someone's looking, so a Hermes that's back is noticed in seconds.
  const cap = document.visibilityState === 'visible' ? 4000 : 15_000
  const delay = Math.min(cap, 500 * 2 ** link.attempt++) * (0.85 + Math.random() * 0.3)
  link.timer = setTimeout(() => void dial(link), delay)
}

let started = false

/** Down and waiting to retry? Try now (the page came back, or Hermes answered). One Hermes, or all of them. */
export function redialNow(hermes?: string | null) {
  if (!started) return
  for (const link of links.values()) {
    if (hermes !== undefined && link.hermes !== hermes) continue
    if (!link.timer) continue
    link.attempt = 0
    void dial(link)
  }
}

// Hermes the app has but can't use as they are (too old for Murmur, or their
// sign-in stopped working): not dialed, and away until that changes.
let benched = new Set<string>()

/** Which Hermes to leave undialed. */
export function setBenched(ids: Iterable<string>) {
  const next = new Set(ids)
  if (next.size === benched.size && [...next].every((id) => benched.has(id))) return
  benched = next
  syncGateways()
}

/** Dial every Hermes the app has and can use, and hang up on the rest. Call again when the list changes. */
export function syncGateways() {
  if (!started) return
  const ids = hermesIds()
  const wanted = new Set((ids.length ? ids : [null]).filter((id) => !id || !benched.has(id)).map(key))
  for (const [id, link] of [...links]) {
    if (wanted.has(id)) continue
    if (link.live) hangUp(link)
    // Still the app's, but not to be used: its agents stay, away. Gone from the app: nothing is kept.
    if (link.hermes && ids.includes(link.hermes)) {
      useLinks.setState((all) => ({ [id]: { ...(all[id] ?? IDLE), state: 'idle', away: true } }))
    } else {
      links.delete(id)
      useLinks.setState((all) => {
        const { [id]: _gone, ...rest } = all
        return rest
      }, true)
    }
  }
  for (const id of ids.length ? ids : [null]) {
    if (!wanted.has(key(id))) {
      if (!links.has(key(id))) useLinks.setState({ [key(id)]: { ...IDLE, away: true } })
      continue
    }
    const link = linkTo(id)
    if (link.live) continue
    link.live = true
    link.attempt = 0
    void dial(link)
  }
}

// One more Hermes, or one fewer: dialed, or hung up on, as the list changes.
onHermesIds(syncGateways)

export function startGateway() {
  if (started) return
  started = true
  // Phones suspend sockets in the background; come back fast when visible.
  const wake = () => {
    if (document.visibilityState === 'visible') redialNow()
  }
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
  window.addEventListener('online', wake)
  syncGateways()
}

function hangUp(link: Link) {
  link.live = false
  clearTimeout(link.timer)
  clearTimeout(link.awayTimer)
  link.timer = undefined
  link.awayTimer = undefined
  link.client.close()
}

/** Hang up for good: the app is starting over (the list of Hermes changed under it). */
export function stopGateway() {
  for (const link of links.values()) hangUp(link)
}

/** Resolves once the socket to a Hermes is open (immediately if it already is). */
export function whenOpen(hermes: string | null = firstHermes()): Promise<void> {
  const link = linkTo(hermes)
  if (link.client.connectionState === 'open') return Promise.resolve()
  return new Promise((resolve) => {
    const off = link.client.onState((state) => {
      if (state === 'open') {
        off()
        resolve()
      }
    })
  })
}

/**
 * Every Hermes's socket as one: 'open' while any is, 'down' while none is and
 * one is being dialed, 'idle' while none is dialed yet. Murmur's server, or
 * the device's connection, is what's likelier away when they're all down.
 */
export function stateOfAll(): 'open' | 'down' | 'idle' {
  const live = [...links.values()].filter((link) => link.live).map((link) => link.client.connectionState)
  return live.includes('open') ? 'open' : live.some((state) => state !== 'idle') ? 'down' : 'idle'
}

/** Whether the socket to a Hermes is open right now: for what goes round every Hermes and shouldn't wait on one that's away. */
export const isOpen = (hermes: string | null) => linkTo(hermes).client.connectionState === 'open'

/** Whether the socket to a Hermes is open, or opens within `ms`: for what shouldn't wait on a Hermes that's away. */
export function openSoon(hermes: string | null, ms: number): Promise<boolean> {
  if (hermes && benched.has(hermes)) return Promise.resolve(false)
  if (linkTo(hermes).client.connectionState === 'open') return Promise.resolve(true)
  return Promise.race([whenOpen(hermes).then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))])
}

/**
 * A request that waits for the connection instead of failing while dialing.
 * It goes to the Hermes of the agent, chat or group it names (route.ts), or
 * to `on`, a Hermes's id (`hermesOf(agentId)` for an agent's).
 */
export async function rpc<T = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
  on?: string | null,
) {
  const to = routeCall(method, params, on)
  await whenOpen(to.hermes)
  const result = await linkTo(to.hermes).client.request<T>(method, to.params, timeoutMs)
  noteAnswer(to.hermes, result)
  return result
}

/** Every Hermes's socket as one. */
export const gateway = {
  /** Every event, from any Hermes (`event.hermes` says which). */
  onEvent(handler: EventHandler) {
    eventHandlers.add(handler)
    return () => void eventHandlers.delete(handler)
  },
  /** One kind of event, from any Hermes. */
  on<K extends GatewayEventName>(type: K, handler: (event: GatewayEvent<K>) => void) {
    const each: EventHandler = (event) => {
      if (event.type === type) handler(event as GatewayEvent<K>)
    }
    eventHandlers.add(each)
    return () => void eventHandlers.delete(each)
  },
  /** Hermes's questions (approvals, logins), from any Hermes. */
  onRequest(handler: RequestHandler) {
    requestHandlers.add(handler)
    return () => void requestHandlers.delete(handler)
  },
  /** Each Hermes's socket opening and closing. */
  onState(handler: StateHandler) {
    stateHandlers.add(handler)
    return () => void stateHandlers.delete(handler)
  },
  /** How the socket to one Hermes is doing right now (the first, unless named). */
  stateOf(hermes: string | null = firstHermes()): ConnectionState {
    return links.get(key(hermes))?.client.connectionState ?? 'idle'
  },
}
