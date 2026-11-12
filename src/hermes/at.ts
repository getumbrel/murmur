// Hermes's API, bound to one Hermes.
//
// Most calls name an agent, a chat or a group, and find their own way
// (route.ts). What's about a whole Hermes names none: which services it's
// connected to, its keys, its runtime, its updates. Those say which Hermes
// here, once, and every call made through it goes there.

import { rpc } from './gateway'
import { mainOn } from './instance'
import { api } from './rest'

export function at(hermes: string | null) {
  const to = (init?: RequestInit) => ({ ...init, hermes })
  return {
    hermes,
    /** This Hermes's main agent: what's set once per Hermes is set on it. */
    main: mainOn(hermes),
    get: <T>(path: string, init?: RequestInit) => api.get<T>(path, to(init)),
    post: <T>(path: string, body?: unknown, init?: RequestInit) => api.post<T>(path, body, to(init)),
    put: <T>(path: string, body?: unknown, init?: RequestInit) => api.put<T>(path, body, to(init)),
    patch: <T>(path: string, body?: unknown, init?: RequestInit) => api.patch<T>(path, body, to(init)),
    delete: <T>(path: string, body?: unknown, init?: RequestInit) => api.delete<T>(path, body, to(init)),
    rpc: <T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number) =>
      rpc<T>(method, params, timeoutMs, hermes),
  }
}

/** One Hermes's API (`at(hermes)`). */
export type At = ReturnType<typeof at>
