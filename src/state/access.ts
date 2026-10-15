// Who can message an agent from Telegram or WhatsApp. When someone new writes
// to an agent that asks first (Hermes's "pairing"), Hermes holds their request
// for an hour and tells them to wait; Murmur shows it under "Needs you" and in
// the platform's sheet, where one tap lets them in. Each agent (Hermes
// profile) keeps its own list. Hermes has no way to turn one request down, so
// Not now hides it here until it runs out on its own.

import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, within } from '@/hermes/rest'
import { gateway } from '@/hermes/gateway'
import { scoped } from '@/hermes/instance'
import { useAgents } from './agents'

export type AccessPlatform = 'telegram' | 'whatsapp' | (string & {})

/** Someone asking to talk to an agent. */
export type AccessRequest = {
  agentId: string
  platform: AccessPlatform
  requestId: string
  userId: string
  userName: string
  /** ms since epoch, near enough (Hermes says how many minutes ago). */
  at: number
}

/** Someone let in. */
export type Allowed = { platform: AccessPlatform; userId: string; userName: string; at?: number }

export type Access = { pending: AccessRequest[]; allowed: Allowed[] }

type Raw = {
  pending?: { platform: string; request_id: string; user_id: string; user_name?: string; age_minutes?: number }[]
  approved?: { platform: string; user_id: string; user_name?: string; approved_at?: number }[]
}

export const accessKey = (agentId: string) => ['access', agentId] as const
const q = (profile: string) => `?profile=${encodeURIComponent(profile)}`

/** Hermes's lists, tidied: requests it can't approve by id (from old versions) are left out. */
export function accessFrom(agentId: string, raw: Raw, now = Date.now()): Access {
  return {
    pending: (raw.pending ?? [])
      .filter((p) => p.request_id)
      .map((p) => ({
        agentId,
        platform: p.platform,
        requestId: p.request_id,
        userId: p.user_id,
        userName: p.user_name ?? '',
        // To the minute, as Hermes counts: a re-read doesn't reorder cards (a receipt stays put).
        at: (Math.floor(now / 60_000) - (p.age_minutes ?? 0)) * 60_000,
      })),
    allowed: (raw.approved ?? []).map((a) => ({
      platform: a.platform,
      userId: a.user_id,
      userName: a.user_name ?? '',
      at: a.approved_at ? a.approved_at * 1000 : undefined,
    })),
  }
}

async function readAccess(agentId: string) {
  return accessFrom(agentId, await api.get<Raw>(`/api/pairing${q(agentId)}`, within(20_000)))
}

let wired = false
/** Hermes says when anyone's list moves; every agent's is looked at again. */
function wire(qc: QueryClient) {
  if (wired) return
  wired = true
  let timer: ReturnType<typeof setTimeout> | undefined
  gateway.onEvent((ev) => {
    if (ev.type !== 'pairing.changed') return
    clearTimeout(timer)
    timer = setTimeout(() => qc.invalidateQueries({ queryKey: ['access'] }), 300)
  })
}

const query = (agentId: string) => ({
  queryKey: accessKey(agentId),
  queryFn: () => readAccess(agentId),
  staleTime: 30_000,
  // A request appears without a word from Hermes when its event is missed; look now and then.
  refetchInterval: 60_000,
})

/** One agent's requests and who's allowed. */
export function useAccess(agentId: string, { enabled = true } = {}) {
  const qc = useQueryClient()
  wire(qc)
  const ignored = useIgnored()
  const res = useQuery({ ...query(agentId), enabled })
  const data = useMemo(
    () => res.data && { ...res.data, pending: res.data.pending.filter((r) => !ignored.has(r.requestId)) },
    [res.data, ignored],
  )
  return { ...res, data }
}

/** Everyone waiting to talk to any agent, newest first. */
export function useAccessRequests(): AccessRequest[] {
  const qc = useQueryClient()
  wire(qc)
  const ignored = useIgnored()
  const agents = useAgents().data
  const results = useQueries({ queries: (agents ?? []).map((a) => query(a.id)) })
  const just = useJustAllowed((s) => s.byId)
  const all = results.flatMap((r) => r.data?.pending ?? [])
  const key = all.map((r) => r.requestId).join()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => waiting(all, ignored, Object.values(just)), [key, ignored, just])
}

/** Requests not put aside, plus any just let in (still showing their receipt), newest first. */
export function waiting(all: AccessRequest[], ignored: Set<string>, just: AccessRequest[] = []) {
  const ids = new Set(all.map((r) => r.requestId))
  return [...all.filter((r) => !ignored.has(r.requestId)), ...just.filter((r) => !ids.has(r.requestId))].sort(
    (a, b) => b.at - a.at || a.requestId.localeCompare(b.requestId),
  )
}

/** Requests just let in, kept a moment so their card can turn into a receipt before it goes. */
export const useJustAllowed = create<{ byId: Record<string, AccessRequest> }>(() => ({ byId: {} }))
const RECEIPT_MS = 1_600

/** Let them in. They can message straight away. */
export async function allowRequest(qc: QueryClient, request: AccessRequest) {
  await api.post(
    '/api/pairing/approve',
    { platform: request.platform, request_id: request.requestId, profile: request.agentId },
    within(20_000),
  )
  useJustAllowed.setState((s) => ({ byId: { ...s.byId, [request.requestId]: request } }))
  setTimeout(() => {
    useJustAllowed.setState((s) => {
      const { [request.requestId]: _, ...rest } = s.byId
      return { byId: rest }
    })
  }, RECEIPT_MS)
  qc.setQueryData<Access>(
    accessKey(request.agentId),
    (old) =>
      old && {
        pending: old.pending.filter((r) => r.requestId !== request.requestId),
        allowed: [
          ...old.allowed,
          { platform: request.platform, userId: request.userId, userName: request.userName, at: Date.now() },
        ],
      },
  )
  void qc.invalidateQueries({ queryKey: accessKey(request.agentId) })
}

/** Stop letting them in. */
export async function removeAllowed(qc: QueryClient, agentId: string, person: Allowed) {
  await api.post(
    '/api/pairing/revoke',
    { platform: person.platform, user_id: person.userId, profile: agentId },
    within(20_000),
  )
  qc.setQueryData<Access>(
    accessKey(agentId),
    (old) =>
      old && {
        ...old,
        allowed: old.allowed.filter((a) => !(a.platform === person.platform && a.userId === person.userId)),
      },
  )
  void qc.invalidateQueries({ queryKey: accessKey(agentId) })
}

// ── Not now ─────────────────────────────────────────────────────────────────
// Requests put aside, kept for as long as Hermes keeps a request (an hour).

const IGNORED_KEY = scoped('murmur:access-ignored')
const KEEP_MS = 60 * 60_000
const listeners = new Set<() => void>()

function loadIgnored(now = Date.now()): Record<string, number> {
  try {
    const all = JSON.parse(localStorage.getItem(IGNORED_KEY) ?? '{}') as Record<string, number>
    return Object.fromEntries(Object.entries(all).filter(([, at]) => now - at < KEEP_MS))
  } catch {
    return {}
  }
}

let ignoredNow = new Set(Object.keys(loadIgnored()))

export function ignoreRequest(request: AccessRequest) {
  const all = { ...loadIgnored(), [request.requestId]: Date.now() }
  try {
    localStorage.setItem(IGNORED_KEY, JSON.stringify(all))
  } catch {
    // Private mode: it stays hidden until the page reloads.
  }
  ignoredNow = new Set(Object.keys(all))
  for (const fn of listeners) fn()
}

function useIgnored() {
  const [ignored, setIgnored] = useState(ignoredNow)
  useEffect(() => {
    const fn = () => setIgnored(ignoredNow)
    listeners.add(fn)
    return () => void listeners.delete(fn)
  }, [])
  return ignored
}

// ── Words ───────────────────────────────────────────────────────────────────

const PLATFORM_NAMES: Record<string, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp' }
export const platformName = (platform: string) =>
  PLATFORM_NAMES[platform] ?? platform[0]?.toUpperCase() + platform.slice(1)

/** Their name as the platform gave it; WhatsApp ids aren't always phone numbers, so they're never shown. */
export function personName(person: { userName: string; userId: string; platform: string }) {
  const name = person.userName.trim()
  if (name) return name
  if (person.platform === 'telegram' && person.userId) return `Telegram user ${person.userId}`
  return `Someone on ${platformName(person.platform)}`
}
