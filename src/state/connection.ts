// Which Hermes Murmur talks to, and Murmur's own optional sign-in.
// Both live on the Murmur server (server/connection.ts, server/access.ts);
// credentials never come to the browser.
//
// Murmur can know several Hermes, and the app uses them all at once: every
// one's agents are in the one list, each talking to its own (hermes/instance.ts).
// Adding or removing one changes the list where it stands. Only a change of
// the first, whose agents go by their plain names, starts the app over.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { hermesHeaders, SESSION_CHECK } from '@/hermes/rest'
import { setBenched, stopGateway } from '@/hermes/gateway'
import {
  browserServers,
  firstHermes,
  forgetForEveryHermes,
  forgetHermesStorage,
  HERMES_GONE,
  hermesIds,
  onHermesIds,
  scoped,
  setHermesIds,
} from '@/hermes/instance'
import { forgetKept, forgetKeptFor } from '@/state/kept'
import { openedKept } from '@/lib/keep-app'

export type ConnectionMode = 'token' | 'password' | 'sso' | 'unknown'
/** How a Hermes behind a sign-in lets people in: a password, single sign-on, or both. */
export type SignInWay = 'password' | 'sso'

/** A Hermes that signs in with single sign-on and nothing else. */
export const ssoOnly = (ways?: SignInWay[]) => !!ways?.includes('sso') && !ways.includes('password')
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
  /** What a Hermes behind a sign-in accepts, once Murmur has asked it. */
  signIns?: SignInWay[]
  /** Friendly, ready to show. */
  error?: string
}

/** A Hermes in the list: always named. */
export type KnownHermes = HermesConnection & { id: string; name: string }
export type HermesList = { active: string; connections: KnownHermes[] }

/** `signIn`: a finished single sign-on (state/sign-in.ts), in place of a username and password. */
export type ConnectionRequest = { url: string; username?: string; password?: string; signIn?: string }

// Where should your agents live (the built-in, or a Hermes Murmur found): state/setup.ts.

export const connectionKey = ['murmur', 'connection'] as const
export const connectionsKey = ['murmur', 'connections'] as const

async function send(method: string, path: string, body?: unknown, signal?: AbortSignal) {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      signal,
      // Names the first Hermes, which the single-Hermes endpoints act on.
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

// The first Hermes's connection, as Murmur's server last described it, so the
// app can open without waiting for a server that may not answer (away from
// home, say). Kept when it worked; let go when the server says it's no longer
// one to open on (it needs signing in to again, it's too old, or there's none
// chosen). A Hermes that's only down, or slow to answer, still is: the app
// opens and says it can't reach it. Signing out forgets it, like the roster.
const KEPT_KEY = 'murmur:connection'

function keptConnection(): HermesConnection | undefined {
  try {
    const kept = JSON.parse(localStorage.getItem(scoped(KEPT_KEY)) ?? 'null') as HermesConnection | null
    return kept?.status === 'connected' ? kept : undefined
  } catch {
    return undefined
  }
}

function keepConnection(connection: HermesConnection) {
  try {
    if (connection.status === 'connected' && !connection.outdated) localStorage.setItem(scoped(KEPT_KEY), JSON.stringify(connection))
    else if (connection.status !== 'unreachable' || connection.outdated || connection.source === 'default')
      localStorage.removeItem(scoped(KEPT_KEY))
  } catch {
    // No storage here: the next open waits for the server.
  }
  return connection
}

/** The connection query's start: what was kept, shown now and asked for now (timeless, like the kept roster). */
export const connectionStart = { initialData: keptConnection, initialDataUpdatedAt: 0 }

export const connectionApi = {
  get: () => call('GET', '/murmur/connection').then(keepConnection),
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
 * The first Hermes's connection (the only one, for most), plus `test`, `save`
 * and `reset`. After a successful save the server drops live sockets (the app
 * redials the new Hermes) and every cached query is refetched.
 */
export function useHermesConnection() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: connectionKey, queryFn: connectionApi.get, staleTime: 15_000, ...connectionStart })

  const switched = (next: HermesConnection) => {
    // A first run sets up the Hermes it was already showing: carry on with it.
    if (!takeListed()) return startOver()
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

/** Every Hermes this Murmur knows, first one first, with each one's status. */
export function useHermesList(enabled = true) {
  return useQuery({ queryKey: connectionsKey, queryFn: connectionsApi.list, staleTime: 15_000, enabled })
}

/** The ids of every Hermes the app is using, first one first: known before the list is. */
export const useHermesIds = () => useSyncExternalStore(onHermesIds, hermesIds)

/** Whether there's more than one Hermes: only then does anything say which. */
export const useSeveral = () => useHermesIds().length > 1

// What each Hermes is called, kept so a name can be said before the list is in.
const NAMES_KEY = 'murmur:servers'
type Named = Pick<KnownHermes, 'id' | 'name' | 'url'>

function keptNames(): Named[] {
  try {
    const kept = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '[]') as Named[]
    return Array.isArray(kept) ? kept : []
  } catch {
    return []
  }
}

function keepNames(list: Named[]) {
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(list.map(({ id, name, url }) => ({ id, name, url }))))
  } catch {
    // Private mode: names arrive with the list.
  }
}

/** Every Hermes the app is using, first one first: its name and address at once, its status once the list is in. */
export function useServers(): (Named & Partial<KnownHermes>)[] {
  const ids = useHermesIds()
  const listed = useHermesList().data?.connections
  return useMemo(() => {
    const kept = listed ? [] : keptNames()
    return ids.flatMap((id) => listed?.find((c) => c.id === id) ?? kept.find((c) => c.id === id) ?? [])
  }, [ids, listed])
}

/** One Hermes, by id (an agent's: `hermesOf(agent.id)`). */
export function useServer(hermes: string | null | undefined) {
  return useServers().find((s) => s.id === hermes)
}

/**
 * One Hermes's connection, for copy about where it runs. The first's is its
 * own answer, as it always was; another's comes from the list.
 */
export function useConnectionOn(hermes: string | null | undefined): Partial<HermesConnection> | undefined {
  const first = useHermesConnection().connection
  const listed = useServer(hermes)
  return !hermes || hermes === hermesIds()[0] ? first : listed
}

/** Why a Hermes can't be used as it is, when Murmur knows: it's too old, or its sign-in stopped working. */
export type Trouble = 'outdated' | 'sign-in'
export const troubleOf = (c: Partial<HermesConnection> | undefined): Trouble | undefined =>
  c?.outdated ? 'outdated' : c?.status === 'needs-login' || c?.status === 'bad-login' ? 'sign-in' : undefined

/** The list, plus adding, renaming, changing and removing. */
export function useHermesManager() {
  const qc = useQueryClient()
  const list = useHermesList()
  const settle = (next: Partial<HermesList>) => {
    if (!next.connections) return
    qc.setQueryData(connectionsKey, { active: next.active!, connections: next.connections })
    channel?.postMessage('changed')
  }
  const add = useMutation({ mutationFn: connectionsApi.add, onSuccess: settle })
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => connectionsApi.rename(id, name),
    onSuccess: (next) => {
      settle(next)
      if (next.connection.id === firstHermes()) qc.setQueryData(connectionKey, next.connection)
    },
  })
  const update = useMutation({
    mutationFn: ({ id, ...req }: ConnectionRequest & { id: string }) => connectionsApi.update(id, req),
    onSuccess: (next) => {
      settle(next)
      // It got a new address or password: its socket was closed, so what came from it is read again.
      if (next.connections) {
        if (next.connection.id === firstHermes()) qc.setQueryData(connectionKey, next.connection)
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'murmur' })
      }
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => connectionsApi.remove(id),
    onSuccess: (next, id) => {
      forgetHermesStorage(id)
      forgetKeptFor(id)
      settle(next)
    },
  })
  return { list, add, rename, update, remove }
}

// ── Keeping up with the list ────────────────────────────────────────────────
// The app holds every Hermes's things side by side, so one more or one fewer
// changes the list where it stands: its socket is dialed or hung up, and what
// came from it arrives or goes. Only the first changing starts the app over,
// since its agents are the ones that go by their plain names.

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('murmur:hermes')
let leaving = false

/** The app's ids no longer mean what they did: load it again, at home. */
export function startOver() {
  if (leaving) return
  leaving = true
  stopGateway()
  location.replace('/')
}

/**
 * Take the list as the server says it is now, in the cookie its last answer
 * set: at once, so the next request already names a Hermes that exists.
 * False when the app has to start over (the caller says where).
 */
export const takeListed = () => {
  const listed = browserServers()
  return !listed.length || setHermesIds(listed)
}

/** Take the list as the server has it now. Called with every answer that carries it. */
export function applyServers(list: HermesList | undefined) {
  if (!list?.connections.length || leaving) return
  const ids = list.connections.map((c) => c.id)
  if (!setHermesIds(ids)) return startOver()
  keepNames(list.connections)
  // With one Hermes its troubles are the app's (the gate says so); with several, the others carry on without it.
  setBenched(ids.length > 1 ? list.connections.filter(troubleOf).map((c) => c.id) : [])
}

/**
 * Keep up with the list wherever it changes: here (the list's own answers),
 * in another tab (at once), in another window or on another device (looked at
 * when this one comes back into view, and when a Hermes it names turns out to
 * be gone). Every list made of each Hermes's things is then made again.
 */
export function useServersSync() {
  const qc = useQueryClient()
  const list = useHermesList().data
  useEffect(() => applyServers(list), [list])
  useEffect(() => {
    const look = () => void qc.invalidateQueries({ queryKey: connectionsKey })
    const seen = () => {
      if (document.visibilityState !== 'visible') return
      const listed = browserServers()
      if (listed.length && listed.join() !== hermesIds().join()) look()
    }
    const changed = onHermesIds(() => void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'murmur' }))
    channel?.addEventListener('message', look)
    document.addEventListener('visibilitychange', seen)
    window.addEventListener(HERMES_GONE, look)
    return () => {
      changed()
      channel?.removeEventListener('message', look)
      document.removeEventListener('visibilitychange', seen)
      window.removeEventListener(HERMES_GONE, look)
    }
  }, [qc])
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

/**
 * Forget what this browser kept to open quickly and to show when nothing can
 * be reached: the roster (state/agents.ts), which Hermes it was on, and the
 * chats and their lists (state/kept.ts). They have names and conversations in
 * them, for each Hermes.
 */
async function forgetAll() {
  forgetForEveryHermes('murmur:roster')
  forgetForEveryHermes(KEPT_KEY)
  await forgetKept()
}

export function useMurmurSession() {
  const [session, setSession] = useState<MurmurSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    // The page itself came from this device because the server didn't answer: no waiting on it again.
    if (openedKept) setSession((s) => s ?? { required: false, signedIn: true })
    try {
      // A server that's out of reach can leave a request hanging for a minute; this is asked before anything is drawn.
      const res = await fetch('/murmur/session', { cache: 'no-store', signal: AbortSignal.timeout(4000) })
      const session = res.ok ? ((await res.json()) as MurmurSession) : { required: false, signedIn: true }
      // Signed out (here or by the cookie running out): what this device kept of the chats goes too.
      if (session.required && !session.signedIn) await forgetAll()
      setSession(session)
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
    await forgetAll()
    location.reload()
  }, [])

  return { session, error, signIn, signOut, clearError: () => setError(null) }
}
