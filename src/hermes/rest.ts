// Thin fetch helpers for the Hermes dashboard REST API, reached through the
// Murmur server at /hermes (which attaches the session token).

import { redialNow } from './gateway'
import { firstHermes, HERMES_GONE, HERMES_HEADER, HERMES_PARAM } from './instance'
import { noteAnswer, routePath } from './route'

export class HermesError extends Error {
  status: number
  detail: unknown
  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

/** Fired when Murmur may have signed this browser out (an expired cookie), so the sign-in gate looks again. */
export const SESSION_CHECK = 'murmur:check-session'

/** Headers naming a Hermes (the first, unless said), for requests made outside `api`. */
export function hermesHeaders(headers: Record<string, string> = {}, hermes: string | null = firstHermes()): Record<string, string> {
  return hermes ? { ...headers, [HERMES_HEADER]: hermes } : headers
}

/** An address under /hermes with its Hermes in it, for what can't carry a header (an image, a download, a socket). */
export function hermesUrl(path: string, hermes: string | null = firstHermes()) {
  return `/hermes${path}${hermes ? `${path.includes('?') ? '&' : '?'}${HERMES_PARAM}=${encodeURIComponent(hermes)}` : ''}`
}

/** A socket's address under /hermes, on a Hermes (`hermesOf(agentId)` for an agent's). */
export const hermesSocket = (path: string, hermes: string | null = firstHermes()) =>
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${hermesUrl(path, hermes)}`

/** A request's options, with the Hermes it's for when the path doesn't say (`on(hermesOf(agentId))`). */
export type Init = RequestInit & { hermes?: string | null }

/** For a call that names no agent: the Hermes to ask. */
export const on = (hermes: string | null | undefined, init: RequestInit = {}): Init => ({ ...init, hermes })

async function request<T>(method: string, path: string, body?: unknown, init?: Init): Promise<T> {
  const { hermes: said, ...rest } = init ?? {}
  // To the Hermes of the agent the path names (route.ts), or the one said.
  const to = routePath(path, body, said)
  let res: Response
  try {
    res = await fetch(`/hermes${to.path}`, {
      method,
      body: to.body === undefined ? undefined : JSON.stringify(to.body),
      ...rest,
      headers: hermesHeaders(
        {
          ...(to.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(rest.headers as Record<string, string> | undefined),
        },
        to.hermes,
      ),
    })
  } catch {
    throw new HermesError(0, 'Can’t reach Hermes. Check that it’s running.')
  }
  const text = await res.text()
  const data = text ? safeJson(text) : null
  if (!res.ok) {
    const signedOut = res.status === 401 && (data as { error?: unknown } | null)?.error === 'signed_out'
    if (signedOut) window.dispatchEvent(new Event(SESSION_CHECK))
    if (res.status === 409 && (data as { error?: unknown } | null)?.error === 'hermes_gone') window.dispatchEvent(new Event(HERMES_GONE))
    const detail = (data as { detail?: unknown; error?: unknown } | null)?.detail ?? data
    throw new HermesError(res.status, messageFrom(detail) ?? `Hermes returned ${res.status}`, detail)
  }
  // Hermes answered, so if its socket is waiting out a retry, it needn't.
  redialNow(to.hermes)
  noteAnswer(to.hermes, data)
  return data as T
}

function safeJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function messageFrom(detail: unknown): string | null {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>
    if (typeof d.message === 'string') return d.message
    if (typeof d.error === 'string') return d.error
    if (typeof d.detail === 'string') return d.detail
  }
  return null
}

/** Gives up on a request after `ms` (it fails as unreachable), for callers that must never hang. */
export const within = (ms: number, hermes?: string | null): Init => ({ signal: AbortSignal.timeout(ms), ...(hermes !== undefined && { hermes }) })

export const api = {
  get: <T>(path: string, init?: Init) => request<T>('GET', path, undefined, init),
  post: <T>(path: string, body?: unknown, init?: Init) => request<T>('POST', path, body ?? {}, init),
  put: <T>(path: string, body?: unknown, init?: Init) => request<T>('PUT', path, body ?? {}, init),
  patch: <T>(path: string, body?: unknown, init?: Init) => request<T>('PATCH', path, body ?? {}, init),
  delete: <T>(path: string, body?: unknown, init?: Init) => request<T>('DELETE', path, body, init),
}
