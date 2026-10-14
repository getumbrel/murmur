// Thin fetch helpers for the Hermes dashboard REST API, reached through the
// Murmur server at /hermes (which attaches the session token).

import { redialNow } from './gateway'
import { HERMES_GONE, HERMES_HEADER, tabHermes } from './instance'

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

/** Headers naming the Hermes this tab is for, so a switch in another tab never crosses its wires. */
export function hermesHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const id = tabHermes()
  return id ? { ...headers, [HERMES_HEADER]: id } : headers
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/hermes${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...init,
      headers: hermesHeaders({
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init?.headers as Record<string, string> | undefined),
      }),
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
  // Hermes answered, so if the socket is waiting out a retry, it needn't.
  redialNow()
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

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>('GET', path, undefined, init),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
}
