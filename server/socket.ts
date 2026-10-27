// A socket to one Hermes that stays open, for what Murmur's server keeps an
// eye on by itself (watch.ts). It speaks the same JSON-RPC as the app, comes
// back when Hermes restarts or the network drops, and pings to notice a
// connection that died without saying so. It never says it answers Hermes's
// questions (approvals, logins): those are for the person's own apps.

import type { Hermes } from './hermes.ts'

export type HermesEvent = { type: string; session_id?: string; payload?: unknown }

export class RpcError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

export type HermesSocket = {
  /** One call. Rejects while the socket is down, on Hermes's error, or when time runs out. */
  call<T>(method: string, params?: Record<string, unknown>, timeout?: number): Promise<T>
  close(): void
}

type Handlers = {
  /** Every event Hermes sends (`sessions.changed`, `cron.changed`, …). */
  onEvent?: (event: HermesEvent) => void
  /** Connected, or connected again: anything missed while down is worth a look. */
  onOpen?: () => void
}

const PING_MS = 20_000
const PING_TIMEOUT_MS = 15_000
const MAX_BACKOFF_MS = 30_000

export function openSocket(hermes: Pick<Hermes, 'socketUrl'>, handlers: Handlers = {}): HermesSocket {
  let socket: WebSocket | undefined
  let open = false
  let closed = false
  let attempt = 0
  let nextId = 0
  let redial: ReturnType<typeof setTimeout> | undefined
  let ping: ReturnType<typeof setInterval> | undefined
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  function settleAll(error: Error) {
    for (const [id, call] of pending) {
      clearTimeout(call.timer)
      call.reject(error)
      pending.delete(id)
    }
  }

  async function dial() {
    redial = undefined
    if (closed) return
    let url: URL
    try {
      url = await hermes.socketUrl()
    } catch {
      return retry()
    }
    if (closed) return
    const ws = new WebSocket(url)
    socket = ws
    ws.addEventListener('open', () => {
      if (socket !== ws) return
      open = true
      attempt = 0
      clearInterval(ping)
      ping = setInterval(() => {
        // Any answer, even "no such method" from an older Hermes, says it's there.
        call('gateway.ping', {}, PING_TIMEOUT_MS).catch((error) => {
          if (error instanceof RpcError) return
          // A connection that died quietly (a laptop that slept) may never say it closed: dial again now.
          lost(ws)
          ws.close()
        })
      }, PING_MS)
      ping.unref?.()
      handlers.onOpen?.()
    })
    ws.addEventListener('message', (event) => {
      let frame: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { code?: number; message?: string } }
      try {
        frame = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (frame.method === 'event') {
        const ev = frame.params as HermesEvent | undefined
        if (typeof ev?.type === 'string') handlers.onEvent?.(ev)
        return
      }
      // Answers carry our id and no method; Hermes's own requests aren't for this socket.
      if (typeof frame.id !== 'number' || frame.method !== undefined) return
      const call = pending.get(frame.id)
      if (!call) return
      pending.delete(frame.id)
      clearTimeout(call.timer)
      if (frame.error) call.reject(new RpcError(frame.error.code ?? -32603, frame.error.message ?? 'Hermes error'))
      else call.resolve(frame.result)
    })
    // An error is always followed by close, which is where the socket is let go.
    ws.addEventListener('close', () => lost(ws))
  }

  function lost(ws: WebSocket) {
    if (socket !== ws) return
    socket = undefined
    open = false
    clearInterval(ping)
    settleAll(new Error('Hermes went away'))
    retry()
  }

  function retry() {
    if (closed || redial) return
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++) * (0.85 + Math.random() * 0.3)
    redial = setTimeout(dial, delay)
    redial.unref?.()
  }

  function call<T>(method: string, params: Record<string, unknown> = {}, timeout = 15_000): Promise<T> {
    if (!open || !socket) return Promise.reject(new Error('Not connected to Hermes'))
    const id = ++nextId
    const ws = socket
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeout)
      timer.unref?.()
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  void dial()

  return {
    call,
    close() {
      closed = true
      clearTimeout(redial)
      clearInterval(ping)
      settleAll(new Error('Closed'))
      socket?.close()
      socket = undefined
    },
  }
}
