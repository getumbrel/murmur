// The one live connection to Hermes: its JSON-RPC socket (/api/ws), the same
// protocol Hermes Desktop speaks. Hermes's own client handles requests,
// heartbeats and lossless replay; this module owns dialing and redialing.

import { create } from 'zustand'
import { JsonRpcGatewayClient, type ConnectionState, type GatewayEvent } from './vendor/json-rpc-gateway'
import type { ServerRequest } from './vendor/json-rpc-channel'
import { SESSION_CHECK } from './rest'
import { browserHermes, HERMES_GONE, HERMES_PARAM, tabHermes } from './instance'

export type { GatewayEvent, ServerRequest }

/** The socket, naming the Hermes this tab is for. */
const url = () => {
  const id = tabHermes()
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/hermes/api/ws${id ? `?${HERMES_PARAM}=${id}` : ''}`
}

export const gateway = new JsonRpcGatewayClient({
  requestIdPrefix: 'm',
  closedErrorMessage: 'Lost connection to Hermes',
  notConnectedErrorMessage: 'Not connected to Hermes',
})

type ConnectionStore = { state: ConnectionState; everOpened: boolean }

export const useConnection = create<ConnectionStore>(() => ({ state: 'idle', everOpened: false }))

let attempt = 0
let timer: ReturnType<typeof setTimeout> | undefined
let started = false
let stopped = false

async function dial() {
  if (stopped) return
  clearTimeout(timer)
  timer = undefined
  try {
    await gateway.connect(url())
    attempt = 0
  } catch {
    // A refused upgrade looks like any failure; after a few, ask whether we're still signed in.
    if (attempt >= 2) window.dispatchEvent(new Event(SESSION_CHECK))
    // That answer also puts right a cookie naming a Hermes that's been removed: start over on the one it names now.
    const named = browserHermes()
    if (named && tabHermes() && named !== tabHermes()) return void window.dispatchEvent(new Event(HERMES_GONE))
    scheduleRedial()
  }
}

function scheduleRedial() {
  // A failed dial reports itself several ways ('error', then 'closed', then the
  // rejection); they're one failure, so only the first schedules a retry.
  if (timer || stopped) return
  // 0.5s, 1s, 2s … with a little jitter so tabs don't stampede. Capped low
  // while someone's looking, so a Hermes that's back is noticed in seconds.
  const cap = document.visibilityState === 'visible' ? 4000 : 15_000
  const delay = Math.min(cap, 500 * 2 ** attempt++) * (0.85 + Math.random() * 0.3)
  timer = setTimeout(dial, delay)
}

/** Down and waiting to retry? Try now (the page came back, or Hermes answered). */
export function redialNow() {
  if (!started || !timer) return
  attempt = 0
  void dial()
}

export function startGateway() {
  if (started) return
  started = true
  gateway.onState((state) => {
    // (The client itself announces that we answer approvals and questions.)
    useConnection.setState((s) => ({ state, everOpened: s.everOpened || state === 'open' }))
    if (state === 'closed' || state === 'error') scheduleRedial()
  })
  // Phones suspend sockets in the background; come back fast when visible.
  const wake = () => {
    if (document.visibilityState === 'visible') redialNow()
  }
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
  window.addEventListener('online', wake)
  void dial()
}

/** Hang up for good: this tab is moving to another Hermes (and reloading). */
export function stopGateway() {
  stopped = true
  clearTimeout(timer)
  timer = undefined
  gateway.close()
}

/** Resolves once the socket is open (immediately if it already is). */
export function whenOpen(): Promise<void> {
  if (gateway.connectionState === 'open') return Promise.resolve()
  return new Promise((resolve) => {
    const off = gateway.onState((state) => {
      if (state === 'open') {
        off()
        resolve()
      }
    })
  })
}

/** A request that waits for the connection instead of failing while dialing. */
export async function rpc<T = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
) {
  await whenOpen()
  return gateway.request<T>(method, params, timeoutMs)
}
