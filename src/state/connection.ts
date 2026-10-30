// Which Hermes Murmur talks to, and Murmur's own optional sign-in.
// Both live on the Murmur server (server/connection.ts, server/access.ts);
// credentials never come to the browser.
//
// Murmur can know several Hermes; this browser uses one at a time. Switching
// reloads the app under a curtain, so nothing (the socket, cached queries,
// chats and groups in memory, unread marks) carries from one to the other.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import { hermesHeaders, SESSION_CHECK } from '@/hermes/rest'
import { stopGateway } from '@/hermes/gateway'
import { adoptHermes, browserHermes, forgetHermesStorage, HERMES_GONE, tabHermes } from '@/hermes/instance'

export type ConnectionMode = 'token' | 'password' | 'unknown'
export type ConnectionStatus = 'connected' | 'unreachable' | 'needs-login' | 'bad-login'

export type HermesConnection = {
  /** Which of Murmur's Hermes this is, and what the person calls it. */
  id?: string
  name?: string
  url: string
  /** Set by the server's environment (HERMES_URL, or the built-in): show it, don't offer to change or forget it. */
  managed: boolean
  /** `builtin`: the Hermes that comes with Murmur (id 'builtin', see state/setup.ts). */
  source: 'env' | 'saved' | 'default' | 'builtin'
  mode: ConnectionMode
  status: ConnectionStatus
  hermesVersion?: string
  /** Reachable, but older than the Hermes Murmur needs (MIN_HERMES_VERSION on the server)… */
  outdated?: boolean
  /** …which is this. */
  minVersion?: string
  /** It runs from an image (Docker): updated by pulling a newer one, not with `hermes update`. */
  fromImage?: boolean
  /** Who Murmur signs in as, when this Hermes has a password. */
  username?: string
  /** Friendly, ready to show. */
  error?: string
}

/** A Hermes in the list: always named. */
export type KnownHermes = HermesConnection & { id: string; name: string }
export type HermesList = { active: string; connections: KnownHermes[] }

export type ConnectionRequest = { url: string; username?: string; password?: string }

// Where should your agents live (the built-in, or a Hermes Murmur found): state/setup.ts.

export const connectionKey = ['murmur', 'connection'] as const
export const connectionsKey = ['murmur', 'connections'] as const

async function send(method: string, path: string, body?: unknown, signal?: AbortSignal) {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      signal,
      // Names this tab's Hermes, which the single-Hermes endpoints act on.
      headers: hermesHeaders(body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Can’t reach Murmur. Check your connection, then try again.')
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (data?.error === 'hermes_gone') window.dispatchEvent(new Event(HERMES_GONE))
  return { res, data }
}

async function call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<HermesConnection> {
  const { res, data } = await send(method, path, body, signal)
  // 422 carries a full answer (what went wrong, in words); anything else without one is unexpected.
  if (data && 'status' in data) return data as HermesConnection
  throw new Error((data?.error as string | undefined) ?? `Murmur returned ${res.status}`)
}

async function callList<T = HermesList>(method: string, path: string, body?: unknown): Promise<T> {
  const { res, data } = await send(method, path, body)
  if (res.ok && data) return data as T
  // A Hermes that couldn't be reached or signed in to answers like the single form does.
  if (data && 'status' in data) return { connection: data } as T
  throw new Error((data?.error as string | undefined) ?? `Murmur returned ${res.status}`)
}

export const connectionApi = {
  get: () => call('GET', '/murmur/connection'),
  test: (req: ConnectionRequest, signal?: AbortSignal) => call('POST', '/murmur/connection/test', req, signal),
  save: (req: ConnectionRequest) => call('PUT', '/murmur/connection', req),
  reset: () => call('DELETE', '/murmur/connection'),
}

type Changed = HermesList & { connection: KnownHermes }

const one = (id: string) => `/murmur/connections/${encodeURIComponent(id)}`

export const connectionsApi = {
  list: () => callList('GET', '/murmur/connections'),
  /** Tests, then saves. Answers `{connection}` alone (not connected) when it couldn't. */
  add: (req: ConnectionRequest & { name?: string; activate?: boolean }) =>
    callList<Partial<Changed> & { connection: HermesConnection }>('POST', '/murmur/connections', req),
  rename: (id: string, name: string) => callList<Changed>('PATCH', one(id), { name }),
  update: (id: string, req: ConnectionRequest) =>
    callList<Partial<Changed> & { connection: HermesConnection }>('PATCH', one(id), req),
  remove: (id: string) => callList('DELETE', one(id)),
  activate: (id: string) => callList('POST', `${one(id)}/activate`),
}

/**
 * The current Hermes connection, plus `test`, `save` and `reset`.
 * After a successful save the server drops live sockets (the app redials the
 * new Hermes) and every cached query is refetched.
 */
export function useHermesConnection() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: connectionKey, queryFn: connectionApi.get, staleTime: 15_000 })

  const switched = (next: HermesConnection) => {
    // A first run sets up the Hermes it was already showing: carry on with it.
    if (next.id && next.id !== tabHermes() && !adoptHermes(next.id)) return void switchHermes(next as KnownHermes)
    qc.setQueryData(connectionKey, next)
    void qc.invalidateQueries({ queryKey: connectionsKey })
    if (next.status === 'connected') void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'murmur' })
  }

  const test = useMutation({ mutationFn: (req: ConnectionRequest) => connectionApi.test(req) })
  const save = useMutation({ mutationFn: connectionApi.save, onSuccess: switched })
  const reset = useMutation({ mutationFn: connectionApi.reset, onSuccess: switched })

  return { connection: query.data, isLoading: query.isLoading, refetch: query.refetch, test, save, reset }
}

// ── Several Hermes ──────────────────────────────────────────────────────────

/** Every Hermes this Murmur knows, with each one's status, and which this browser uses. */
export function useHermesList() {
  return useQuery({ queryKey: connectionsKey, queryFn: connectionsApi.list, staleTime: 15_000 })
}

/** The list, plus adding, renaming, changing and removing. Switching is `switchHermes`. */
export function useHermesManager() {
  const qc = useQueryClient()
  const list = useHermesList()
  const settle = (next: Partial<HermesList>) => {
    if (next.connections) qc.setQueryData(connectionsKey, { active: next.active!, connections: next.connections })
  }
  const add = useMutation({ mutationFn: connectionsApi.add, onSuccess: settle })
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => connectionsApi.rename(id, name),
    onSuccess: (next) => {
      settle(next)
      if (next.connection.id === tabHermes()) qc.setQueryData(connectionKey, next.connection)
    },
  })
  const update = useMutation({
    mutationFn: ({ id, ...req }: ConnectionRequest & { id: string }) => connectionsApi.update(id, req),
    onSuccess: (next) => {
      settle(next)
      // The Hermes in use got a new address or password: its socket was closed, so refetch everything.
      if (next.connections && next.connection.id === tabHermes()) {
        qc.setQueryData(connectionKey, next.connection)
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'murmur' })
      }
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => connectionsApi.remove(id),
    onSuccess: (next, id) => {
      forgetHermesStorage(id)
      settle(next)
      // Removed the one in use: the server has moved this browser on.
      if (id === tabHermes()) {
        const to = next.connections.find((c) => c.id === next.active)
        if (to) void switchHermes(to, { activated: true })
      }
    },
  })
  return { list, add, rename, update, remove }
}

// ── Switching ───────────────────────────────────────────────────────────────
// Everything the app holds belongs to one Hermes, much of it outside React
// (the socket, chats and groups in memory, caches of pictures and files), so
// a switch reloads the app rather than trying to empty each. A curtain covers
// the seam: it blurs in over the old Hermes, holds through the reload (in
// sessionStorage) and lifts once the new one is drawn.

const CURTAIN_KEY = 'murmur:switching'
const CURTAIN_TTL_MS = 15_000
const MIN_HOLD_MS = 520

type Curtain = { name: string | null; at: number; arriving: boolean } | null

function restoredCurtain(): Curtain {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CURTAIN_KEY) ?? 'null') as { name: string | null; at: number } | null
    sessionStorage.removeItem(CURTAIN_KEY)
    if (saved && Date.now() - saved.at < CURTAIN_TTL_MS) return { ...saved, arriving: true }
  } catch {
    // Private mode: no curtain to carry over.
  }
  return null
}

/** The curtain: up while switching, and on the far side of the reload until the app is drawn. */
export const useSwitchCurtain = create<{ curtain: Curtain }>(() => ({ curtain: restoredCurtain() }))

/** The app is drawn: lift the curtain (a no-op when there's none). */
export const liftCurtain = () => useSwitchCurtain.setState({ curtain: null })

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('murmur:hermes')
let leaving = false

function leave(name: string | null) {
  if (leaving) return
  leaving = true
  useSwitchCurtain.setState({ curtain: { name, at: Date.now(), arriving: false } })
  stopGateway()
  try {
    sessionStorage.setItem(CURTAIN_KEY, JSON.stringify({ name, at: Date.now() }))
  } catch {
    // Private mode: the new Hermes just loads without the curtain.
  }
  // Long enough to read; the old screen's routes mean nothing to the new Hermes, so start at home.
  setTimeout(() => location.replace('/'), MIN_HOLD_MS)
}

/**
 * Move this browser to another Hermes: the curtain comes down, the server
 * notes the choice, other tabs follow, and the app starts over on it.
 */
export async function switchHermes(to: Pick<KnownHermes, 'id' | 'name'>, { activated = false } = {}) {
  if (leaving) return
  useSwitchCurtain.setState({ curtain: { name: to.name, at: Date.now(), arriving: false } })
  if (!activated) {
    try {
      await connectionsApi.activate(to.id)
    } catch (error) {
      liftCurtain()
      throw error
    }
  }
  channel?.postMessage({ id: to.id, name: to.name })
  leave(to.name)
}

/**
 * Follow a switch made elsewhere: another tab (at once), another window coming
 * back into view (the cookie changed), or a Hermes removed from under this tab.
 */
export function followSwitches() {
  const check = (name: string | null = null) => {
    const now = browserHermes()
    if (now && tabHermes() && now !== tabHermes()) leave(name)
  }
  channel?.addEventListener('message', (e: MessageEvent<{ id: string; name: string }>) => check(e.data?.name ?? null))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
  window.addEventListener(HERMES_GONE, () => leave(null))
}

/** Whether to put the connection form in front of the app: never set up, or its password stopped working. */
export function needsConnectionSetup(c: HermesConnection | undefined) {
  if (!c || c.managed || c.status === 'connected') return false
  return c.source === 'default' || c.status === 'needs-login' || c.status === 'bad-login'
}

// ── Murmur's own sign-in (MURMUR_PASSWORD) ──────────────────────────────────
// Plain state, not react-query: the gate sits outside the app's QueryClient
// so nothing in the app (its socket included) starts before sign-in.

export type MurmurSession = { required: boolean; signedIn: boolean }

export function useMurmurSession() {
  const [session, setSession] = useState<MurmurSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/murmur/session', { cache: 'no-store' })
      setSession(res.ok ? ((await res.json()) as MurmurSession) : { required: false, signedIn: true })
    } catch {
      // Murmur's server is unreachable; let the app show its own offline state.
      setSession({ required: false, signedIn: true })
    }
  }, [])

  useEffect(() => {
    void refresh()
    // The cookie can expire inside a long-lived PWA: look again when Hermes calls fail signed out.
    window.addEventListener(SESSION_CHECK, refresh)
    return () => window.removeEventListener(SESSION_CHECK, refresh)
  }, [refresh])

  const signIn = useCallback(async (password: string) => {
    setError(null)
    let res: Response
    try {
      res = await fetch('/murmur/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
    } catch {
      setError('Can’t reach Murmur. Check your connection, then try again.')
      return false
    }
    if (res.ok) {
      setSession({ required: true, signedIn: true })
      return true
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    setError(data?.error ?? 'Something went wrong. Try again.')
    return false
  }, [])

  const signOut = useCallback(async () => {
    await fetch('/murmur/logout', { method: 'POST' }).catch(() => {})
    location.reload()
  }, [])

  return { session, error, signIn, signOut, clearError: () => setError(null) }
}
