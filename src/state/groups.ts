// Group chats. Each group is a Hermes "hosted room": Hermes runs the
// conversation itself, one agent at a time, so it carries on while the phone
// sleeps. Rooms send no live events, so the room's log is polled (quickly while
// someone is talking, slowly otherwise, never in a hidden tab). For words as
// they're written, we also listen in on each member's own behind-the-scenes
// chat for the room ("Group: <room id>"). The log stays the source of truth.

import { create } from 'zustand'
import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { gateway, rpc, type GatewayEvent, type ServerRequest } from '@/hermes/gateway'
import { api } from '@/hermes/rest'
import { hueFor } from '@/lib/hues'
import { toAgent, useAgents, type Agent, type Profile } from '@/state/agents'
import { friendlyError, resumeHolding } from '@/state/chats'
import { toolLabel } from '@/features/chat/tool-labels'
import type { ApprovalChoice, ChatItem, Speaker } from '@/features/chat/types'
import { mentionedIds, toHandles, toNames } from '@/features/group/mentions'
import { scoped } from '@/hermes/instance'
import { isMissingMethod } from '@/hermes/compat'

// ── Wire shapes (groups.* JSON-RPC) ─────────────────────────────────────────

type WireMember = { member_id: string; profile: string; handle: string; display_name?: string }
type WireRoom = {
  room_id: string
  name: string
  members: WireMember[]
  created_at: number
  updated_at: number
  latest_seq?: number
}
type Actor = { kind: string; id: string; profile?: string; display_name?: string }
type RoomEvent = {
  seq: number
  event_id: string
  kind: string
  actor: Actor
  payload: Record<string, unknown>
  created_at: number
}
type PendingAction = {
  kind: string
  task_id: string
  execution_generation?: number
  request_id?: string
  member_id?: string
  approval?: { command?: string; description?: string; request_id?: string }
}
type DriverStatus = { working?: boolean; blocked?: boolean; pending_actions?: PendingAction[] }
type StateResult = { room: WireRoom; driver_status?: DriverStatus }
type LogResult = { events: RoomEvent[]; cursor?: number; latest_seq?: number; has_more?: boolean }

// ── Public shapes ───────────────────────────────────────────────────────────

export type GroupMember = Speaker & { profile: string; handle: string; role: string }

export type Group = {
  id: string
  name: string
  members: GroupMember[]
  createdAt: number
  updatedAt: number
}

/** What the person sees happening right now. */
export type GroupActivity = {
  member: GroupMember
  phase: 'thinking' | 'working' | 'replying' | 'waiting'
  /** For `working`: "Searching the web". */
  label?: string
}

export type GroupSummary = {
  id: string
  name: string
  memberIds: string[]
  memberHues: number[]
  lastActivityAt: number
  /** A round is running. */
  live: boolean
  /** "Atlas: Sounds good" / "You: …" — empty for a brand-new group. */
  lastLine: string
  /** Someone said something since you last looked. */
  unread: boolean
}

export const MIN_MEMBERS = 2
export const MAX_MEMBERS = 6
const THREAD = 'main'
const HISTORY = 400
const FAST = 800
const SLOW = 5000

// ── Members ─────────────────────────────────────────────────────────────────

const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** Hermes's handle for an agent: its profile name, and "hermes" for the main one. */
export const handleFor = (profile: string) => (profile === 'default' ? 'hermes' : profile)

function toMember(m: WireMember, agents?: Agent[]): GroupMember {
  const agent = agents?.find((a) => a.id === m.profile)
  return {
    id: m.member_id,
    profile: m.profile,
    handle: m.handle,
    name: agent?.name ?? (m.display_name?.trim() || (m.profile === 'default' ? 'Hermes' : titleCase(m.profile))),
    hue: agent?.hue ?? (m.profile === 'default' ? 278 : hueFor(m.profile)),
    role: agent?.role ?? '',
  }
}

export function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('')
  if (names.length > 3) return `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`
  return `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`
}

function toGroup(room: WireRoom, agents?: Agent[]): Group {
  const members = room.members.map((m) => toMember(m, agents))
  return {
    id: room.room_id,
    name: room.name?.trim() || joinNames(members.map((m) => m.name)),
    members,
    createdAt: room.created_at * 1000,
    updatedAt: room.updated_at * 1000,
  }
}

// ── Query client hook-up ────────────────────────────────────────────────────
// Plain functions (create, rename, delete) refresh the lists through the
// app's query client, which the hooks below hand us on first use.

let qc: QueryClient | undefined
const LIST = ['groups'] as const
const SUMMARIES = ['group-summaries'] as const

function bind(client: QueryClient) {
  if (qc === client) return
  qc = client
  wire()
}

const refreshLists = () => {
  void qc?.invalidateQueries({ queryKey: LIST })
  void qc?.invalidateQueries({ queryKey: SUMMARIES })
}

// ── Lists ───────────────────────────────────────────────────────────────────

async function fetchRooms() {
  // Hermes before group chats: there are none, rather than an error on repeat.
  const res = await rpc<{ rooms: WireRoom[] }>('groups.list', { limit: 200 }).catch((error) => {
    if (isMissingMethod(error)) return { rooms: [] as WireRoom[] }
    throw error
  })
  // In development, probe scripts' leftover test rooms are hidden; they're not
  // anyone's conversation. Production builds never hide a group, so a person's
  // own room with that name can't vanish (same rule as agents.ts).
  if (!import.meta.env.DEV) return res.rooms
  return res.rooms.filter((r) => !r.room_id.startsWith('murmur-test-room'))
}

/** Every group, most recently active first. */
export function useGroups() {
  bind(useQueryClient())
  const agents = useAgents().data
  const rooms = useQuery({ queryKey: LIST, queryFn: fetchRooms, staleTime: 5_000 })
  const data = useMemo(() => rooms.data?.map((r) => toGroup(r, agents)), [rooms.data, agents])
  return { ...rooms, data }
}

/** Whether this Hermes can host group chats at all (gate "New group" on it). */
export function useGroupsAvailable() {
  const q = useQuery({
    queryKey: ['group-capabilities'],
    queryFn: async () =>
      (await rpc<{ driver?: boolean }>('groups.capabilities', {}).catch((error) => {
        if (isMissingMethod(error)) return { driver: false }
        throw error
      })).driver === true,
    staleTime: Infinity,
    retry: 1,
  })
  return q.data ?? false
}

// ── Create, rename, delete ──────────────────────────────────────────────────

const roomId = () => `murmur-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

/** Start a group with 2–6 agents. Resolves to the new group's id. */
export async function createGroup({ name, memberIds }: { name?: string; memberIds: string[] }) {
  const ids = [...new Set(memberIds)]
  if (ids.length < MIN_MEMBERS || ids.length > MAX_MEMBERS) {
    throw new Error(`Pick ${MIN_MEMBERS} to ${MAX_MEMBERS} agents.`)
  }
  const { profiles } = await api.get<{ profiles: Profile[] }>('/api/profiles')
  const agents = profiles.map((p) => toAgent(p))
  const members = ids.map((id) => {
    const agent = agents.find((a) => a.id === id)
    if (!agent) throw new Error('One of those agents no longer exists.')
    return { member_id: id, profile: id, handle: handleFor(id), display_name: agent.name }
  })
  const id = roomId()
  await rpc('groups.create', {
    room_id: id,
    name: (name?.trim() || joinNames(members.map((m) => m.display_name))).slice(0, 200),
    members,
  })
  markSeen(id, 0)
  refreshLists()
  return id
}

export async function renameGroup(id: string, name: string) {
  const next = name.trim().slice(0, 200)
  if (!next) return
  const res = await rpc<{ room: WireRoom }>('groups.rename', {
    room_id: id,
    event_id: `rn-${Date.now().toString(36)}`,
    name: next,
  })
  patch(id, (l) => ({ room: l.room ? { ...l.room, name: res.room?.name ?? next } : l.room }))
  refreshLists()
  void poll(id)
}

/** Delete a group for good, and tidy away each agent's copy of it. */
export async function deleteGroup(id: string) {
  const members =
    get(id)?.room?.members ?? (qc?.getQueryData<WireRoom[]>(LIST) ?? []).find((r) => r.room_id === id)?.members ?? []
  await rpc('groups.disband', { room_id: id })
  stopWatching(id)
  useGroupLive.setState((s) => {
    const rooms = { ...s.rooms }
    delete rooms[id]
    return { rooms }
  })
  qc?.setQueryData<WireRoom[]>(LIST, (rooms) => rooms?.filter((r) => r.room_id !== id))
  refreshLists()
  void Promise.all(members.map((m) => forgetMemberCopy(id, m.profile))).catch(() => {})
}

async function forgetMemberCopy(room: string, profile: string) {
  type Row = { id: string; title?: string }
  const title = `Group: ${room}`
  const res = await rpc<{ sessions: Row[] }>('session.list', { profile, title, include_hidden: true, limit: 5 })
  const rows = res.sessions.filter((s) => s.title === title)
  if (!rows.length) return
  for (const [runtime, who] of runtimes) if (who.room === room) runtimes.delete(runtime)
  // Hermes keeps them loaded; let go of them first, or it won't delete them.
  const live = await rpc<{ sessions: { id: string; session_key?: string }[] }>('session.active_list', {})
  for (const row of rows) {
    for (const s of live.sessions.filter((s) => s.session_key === row.id)) {
      await rpc('session.close', { session_id: s.id }).catch(() => {})
    }
    await rpc('session.delete', { session_id: row.id, profile }).catch(() => {})
  }
}

// ── Unread ──────────────────────────────────────────────────────────────────

const SEEN_KEY = scoped('murmur:group-seen')

function seenMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function markSeen(id: string, seq: number) {
  const seen = seenMap()
  if ((seen[id] ?? -1) >= seq) return
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...seen, [id]: seq }))
  } catch {
    // Private mode: everything just reads as seen.
  }
}

// ── Live state ──────────────────────────────────────────────────────────────

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

/** A member's turn, as it streams in from their copy of the room. */
type Stream = {
  id: string
  member: string
  text: string
  tools: ToolItem[]
  startedAt: number
  /** Log position the turn began after (unknown until the next poll lands). */
  after: number | null
  done: boolean
}

type Approval = {
  id: string
  requestId: string
  member: string
  command?: string
  description?: string
  /** Log position it arrived at, for placing it once the turn is over. */
  after: number
  status: 'pending' | 'approved' | 'denied'
  choice?: ApprovalChoice
}

type Outgoing = {
  id: string
  eventId: string
  /** As typed ("@Atlas"). */
  text: string
  /** As sent ("@atlas"), to recognise it in the log before Hermes confirms. */
  wire: string
  at: number
  stored?: string
  failed?: boolean
}

type Live = {
  room?: WireRoom
  events: RoomEvent[]
  cursor: number
  loaded: boolean
  missing: boolean
  driver: DriverStatus | null
  outgoing: Outgoing[]
  streams: Record<string, Stream>
  approvals: Approval[]
  /** Log event id → the id it was first shown under, so nothing re-mounts. */
  aliases: Record<string, string>
  /** Steps seen live, kept beside the message once the log takes over. */
  trail: Record<string, ToolItem[]>
  /** When Stop was pressed, until Hermes confirms the round is over. */
  stopping?: number
}

export const useGroupLive = create<{ rooms: Record<string, Live> }>(() => ({ rooms: {} }))

const blank = (): Live => ({
  events: [],
  cursor: 0,
  loaded: false,
  missing: false,
  driver: null,
  outgoing: [],
  streams: {},
  approvals: [],
  aliases: {},
  trail: {},
})

const get = (id: string) => useGroupLive.getState().rooms[id]

function patch(id: string, fn: (l: Live) => Partial<Live> | void) {
  useGroupLive.setState((s) => {
    const live = s.rooms[id]
    if (!live) return s
    const next = fn(live)
    return next ? { rooms: { ...s.rooms, [id]: { ...live, ...next } } } : s
  })
}

let n = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(n++).toString(36)}`

// ── Polling ─────────────────────────────────────────────────────────────────

const watchers = new Map<string, number>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const polling = new Map<string, Promise<void>>()
const again = new Set<string>()
const fastUntil = new Map<string, number>()

function watch(id: string) {
  watchers.set(id, (watchers.get(id) ?? 0) + 1)
  if (!get(id)) useGroupLive.setState((s) => ({ rooms: { ...s.rooms, [id]: blank() } }))
  void poll(id)
  return () => {
    const left = (watchers.get(id) ?? 1) - 1
    if (left > 0) watchers.set(id, left)
    else stopWatching(id)
  }
}

/**
 * Start loading a group before it opens (on press), so its conversation is
 * usually there by the time the screen is. One look; watching starts on open.
 */
export function prefetchGroup(id: string) {
  const live = get(id)
  if (live?.loaded || polling.has(id)) return
  if (!live) useGroupLive.setState((s) => ({ rooms: { ...s.rooms, [id]: blank() } }))
  void poll(id)
}

function stopWatching(id: string) {
  watchers.delete(id)
  clearTimeout(timers.get(id))
  timers.delete(id)
}

function isBusy(l: Live | undefined) {
  if (!l) return false
  return Boolean(
    l.driver?.working || l.outgoing.some((o) => !o.failed) || Object.values(l.streams).some((s) => !s.done),
  )
}

function schedule(id: string) {
  clearTimeout(timers.get(id))
  if (!watchers.has(id) || document.visibilityState === 'hidden') return
  const fast = isBusy(get(id)) || Date.now() < (fastUntil.get(id) ?? 0)
  timers.set(
    id,
    setTimeout(() => void poll(id), fast ? FAST : SLOW),
  )
}

/** Fetch the room's state and any new log entries. Calls made mid-poll queue one more. */
function poll(id: string): Promise<void> {
  const running = polling.get(id)
  if (running) {
    again.add(id)
    return running
  }
  const task = (async () => {
    const startedAt = Date.now()
    try {
      const live = get(id)
      if (!live) return
      // State and log together: one round trip per look. (If a round ends
      // between the two, the quick follow-up look below catches its tail.)
      const latest = qc?.getQueryData<WireRoom[]>(LIST)?.find((r) => r.room_id === id)?.latest_seq
      const since = live.loaded ? live.cursor : Math.max(0, (latest ?? 0) - HISTORY)
      let [state, first] = await Promise.all([
        rpc<StateResult>('groups.state', { room_id: id }),
        rpc<LogResult>('groups.log', { room_id: id, since_seq: since, limit: 500 }),
      ])
      // State can answer after the log. If it says the round is over while we
      // still expect words, the log we hold may predate them: read it again.
      if (!state.driver_status?.working && isBusy(live)) {
        first = await rpc<LogResult>('groups.log', { room_id: id, since_seq: since, limit: 500 })
      }
      const events: RoomEvent[] = [...first.events]
      let cursor = first.cursor ?? first.events.at(-1)?.seq ?? since
      for (let page = 0, more = first.has_more; more && page < 3; page++) {
        const log = await rpc<LogResult>('groups.log', { room_id: id, since_seq: cursor, limit: 500 })
        events.push(...log.events)
        cursor = log.cursor ?? log.events.at(-1)?.seq ?? cursor
        more = log.has_more
      }
      // Long history and nothing cached: keep only the most recent stretch.
      if (!live.loaded && events.length > HISTORY) events.splice(0, events.length - HISTORY)
      const wasWorking = Boolean(live.driver?.working)
      apply(id, state, events, cursor, startedAt)
      const now = get(id)
      if (now?.driver?.working) void listenIn(id)
      // A round just ended: one more quick look for its last words.
      if (wasWorking && !now?.driver?.working) fastUntil.set(id, Date.now() + 1500)
      if (events.length || wasWorking !== Boolean(now?.driver?.working)) {
        void qc?.invalidateQueries({ queryKey: SUMMARIES })
      }
    } catch (e) {
      const code = (e as { code?: number }).code
      if (code === 4112 || /not found/i.test(String((e as Error).message))) {
        patch(id, () => ({ missing: true, loaded: true }))
        stopWatching(id)
      }
    } finally {
      polling.delete(id)
      if (again.delete(id)) void poll(id)
      else schedule(id)
    }
  })()
  polling.set(id, task)
  return task
}

const memberOf = (ev: RoomEvent) => String(ev.payload.member_id ?? ev.actor.id ?? '')
const ENDS_TURN = new Set(['message.member', 'turn.settled', 'turn.failed', 'turn.cancelled'])

function apply(id: string, state: StateResult, fresh: RoomEvent[], cursor: number, startedAt: number) {
  patch(id, (l) => {
    const known = l.events.at(-1)?.seq ?? 0
    const added = fresh.filter((e) => e.seq > known)
    const events = added.length ? [...l.events, ...added] : l.events
    const end = Math.max(cursor, events.at(-1)?.seq ?? 0)
    const driver = state.driver_status ?? null
    const aliases = { ...l.aliases }
    const trail = { ...l.trail }

    // Sent messages that have landed in the log (even before Hermes confirmed the send).
    const logged = new Set(events.map((e) => e.event_id))
    const claimed = new Set(Object.keys(l.aliases))
    const outgoing = l.outgoing.filter((o) => {
      if (o.stored) return !logged.has(o.stored)
      const match = added.find(
        (e) => e.kind === 'message.user' && !claimed.has(e.event_id) && e.payload.text === o.wire,
      )
      if (!match) return true
      aliases[match.event_id] = o.id
      claimed.add(match.event_id)
      return false
    })

    // Streams whose turn the log now records hand over to it.
    const streams: Record<string, Stream> = {}
    for (const [k, s] of Object.entries(l.streams)) {
      if (s.after !== null) {
        const ended = added.find((e) => e.seq > s.after! && ENDS_TURN.has(e.kind) && memberOf(e) === s.member)
        if (ended) {
          if (ended.kind === 'message.member') {
            aliases[ended.event_id] = `${s.id}-a`
            if (s.tools.length) trail[ended.event_id] = s.tools.map(settle)
          }
          continue
        }
      }
      // Nothing is running and this turn predates our look: it's over. (A finished
      // reply waits for the log to take over, so it never blinks out.)
      const waiting = s.done && visibleText(s.text) && Date.now() - s.startedAt < 120_000
      if (!driver?.working && s.startedAt < startedAt && !waiting) continue
      streams[k] = s.after === null && s.startedAt < startedAt ? { ...s, after: end } : s
    }

    // Permission requests: Hermes lists the open ones; keep what we answered.
    const open = (driver?.pending_actions ?? []).filter((a) => a.kind === 'approval')
    const openIds = new Set(open.map(requestIdOf))
    const approvals = l.approvals.filter(
      (a) => a.status !== 'pending' || openIds.has(a.requestId) || held.has(a.requestId),
    )
    for (const a of open) {
      const requestId = requestIdOf(a)
      if (!approvals.some((x) => x.requestId === requestId)) {
        approvals.push({
          id: `ap-${requestId}`,
          requestId,
          member: a.member_id ?? '',
          command: a.approval?.command,
          description: a.approval?.description,
          after: end,
          status: 'pending',
        })
      }
    }

    return {
      room: state.room,
      driver,
      events,
      cursor: end,
      loaded: true,
      missing: false,
      outgoing,
      streams,
      approvals,
      aliases,
      trail,
      // Hermes has wound down (or never answered): stopping is over.
      stopping: driver?.working && l.stopping && Date.now() - l.stopping < 15_000 ? l.stopping : undefined,
    }
  })
  const live = get(id)
  if (live) markSeenIfVisible(id, live)
}

const requestIdOf = (a: PendingAction) => String(a.request_id ?? a.approval?.request_id ?? a.task_id)
const settle = (t: ToolItem): ToolItem =>
  t.status === 'running' ? { ...t, status: 'done', endedAt: t.endedAt ?? Date.now() } : t

function markSeenIfVisible(id: string, live: Live) {
  if (watchers.has(id) && document.visibilityState === 'visible') markSeen(id, live.cursor)
}

// ── Listening in on members' turns ──────────────────────────────────────────
// Once an agent has spoken in a room, its copy of the room is an ordinary
// Hermes chat; attaching to it streams that agent's words as they're written.

/** Hermes's live id for a member's copy → which room and member it is. */
const runtimes = new Map<string, { room: string; member: string }>()
const listening = new Map<string, number>()
/** Permission requests that reached this connection directly, by request id. */
const held = new Map<string, ServerRequest>()

async function listenIn(id: string) {
  const room = get(id)?.room
  if (!room) return
  const attached = new Set([...runtimes.values()].filter((r) => r.room === id).map((r) => r.member))
  await Promise.all(
    room.members
      .filter((m) => !attached.has(m.member_id))
      .map(async (m) => {
        const key = `${id}/${m.member_id}`
        if (Date.now() - (listening.get(key) ?? 0) < 1500) return
        listening.set(key, Date.now())
        try {
          const title = `Group: ${id}`
          type Row = { id: string; resolved_id?: string; title?: string; source?: string }
          const list = await rpc<{ sessions: Row[] }>('session.list', {
            profile: m.profile,
            title,
            include_hidden: true,
            limit: 5,
          })
          const row = list.sessions.find((s) => s.title === title)
          if (!row) return
          type Resume = { session_id: string; running?: boolean; inflight?: { assistant?: string } }
          // Permission requests it re-delivers wait until we know whose they are.
          const { res, held: waiting } = await resumeHolding(() =>
            rpc<Resume>('session.resume', {
              session_id: row.resolved_id || row.id,
              profile: m.profile,
              omit_messages: true,
              // Resuming rebuilds the agent with this as its surface; keep the
              // room's own, or Hermes would fall back to its terminal's.
              ...(row.source ? { source: row.source } : {}),
            }),
          )
          runtimes.set(res.session_id, { room: id, member: m.member_id })
          waiting.forEach(onServerRequest)
          // Arrived mid-sentence: show what's been said so far.
          const partial = res.running ? res.inflight?.assistant?.trim() : ''
          if (partial) updateStream(id, m.member_id, (s) => ({ text: s.text || partial }))
        } catch {
          // Not there yet, or gone; the log still tells the story.
        }
      }),
  )
}

function updateStream(id: string, member: string, fn: (s: Stream) => Partial<Stream>) {
  patch(id, (l) => {
    const current = l.streams[member] ?? {
      id: uid(`live-${member}`),
      member,
      text: '',
      tools: [],
      startedAt: Date.now(),
      after: null,
      done: false,
    }
    return { streams: { ...l.streams, [member]: { ...current, ...fn(current) } } }
  })
}

type P = Record<string, unknown>

function onEvent(ev: GatewayEvent) {
  const runtime = (ev as { session_id?: string }).session_id ?? ''
  if (ev.type === 'session.reclaimed') {
    runtimes.delete(String((ev as { payload?: P }).payload?.session_id ?? ''))
    return
  }
  const who = runtimes.get(runtime)
  if (!who) return
  const { room, member } = who
  const payload = ((ev as { payload?: P }).payload ?? {}) as P
  const text = typeof payload.text === 'string' ? payload.text : ''

  switch (ev.type) {
    case 'message.start':
      // A fresh turn. A finished one still waiting on the log steps aside.
      patch(room, (l) => {
        const prev = l.streams[member]
        if (!prev || !prev.done) return
        const streams = { ...l.streams, [`${member}#${prev.id}`]: prev }
        delete streams[member]
        return { streams }
      })
      updateStream(room, member, () => ({}))
      void poll(room)
      return
    case 'message.delta':
      return updateStream(room, member, (s) => ({ text: s.text ? s.text + text : text.trimStart(), done: false }))
    case 'tool.start': {
      const name = String(payload.name ?? 'tool')
      const label = toolLabel(name, payload.args, typeof payload.context === 'string' ? payload.context : undefined)
      return updateStream(room, member, (s) => ({
        tools: [
          ...s.tools,
          {
            kind: 'tool',
            id: `tool-${String(payload.tool_id ?? uid('x'))}`,
            name,
            label: label.label,
            detail: label.detail,
            status: 'running',
            startedAt: Date.now(),
          },
        ],
      }))
    }
    case 'tool.complete': {
      const key = `tool-${String(payload.tool_id ?? '')}`
      const result = payload.result as P | undefined
      const failed = Boolean(result && (result.status === 'blocked' || result.exit_code === -1 || result.error))
      return updateStream(room, member, (s) => ({
        tools: s.tools.map((t) =>
          t.id === key ? { ...t, status: failed ? 'error' : 'done', endedAt: Date.now() } : t,
        ),
      }))
    }
    case 'request.cancel': {
      // Hermes withdrew a permission request (timed out, or answered elsewhere).
      const srq = String(payload.id ?? '')
      const entry = [...held].find(([, req]) => req.id === srq)
      if (!entry) return
      held.delete(entry[0])
      return patch(room, (l) => ({
        approvals: l.approvals.filter((a) => a.requestId !== entry[0] || a.status !== 'pending'),
      }))
    }
    case 'message.complete':
      updateStream(room, member, (s) => ({
        text: text.trim() || s.text.trim(),
        tools: s.tools.map(settle),
        done: true,
      }))
      fastUntil.set(room, Date.now() + 3000)
      void poll(room)
      return
  }
}

/** Permission requests from an agent's copy of a room land here, not in a chat. */
function onServerRequest(req: ServerRequest) {
  if (req.method !== 'approval') return false
  const params = req.params as P
  const who = runtimes.get(String(params.session_id ?? ''))
  if (!who) return false
  const requestId = String(params.request_id ?? req.id)
  held.set(requestId, req)
  patch(who.room, (l) => {
    if (l.approvals.some((a) => a.requestId === requestId)) return
    return {
      approvals: [
        ...l.approvals,
        {
          id: `ap-${requestId}`,
          requestId,
          member: who.member,
          command: typeof params.command === 'string' ? params.command : undefined,
          description: typeof params.description === 'string' ? params.description : undefined,
          after: l.cursor,
          status: 'pending',
        },
      ],
    }
  })
  return true
}

let wired = false
let summaryTimer: ReturnType<typeof setTimeout> | undefined

function wire() {
  if (wired) return
  wired = true
  gateway.onEvent(onEvent)
  gateway.onRequest(onServerRequest)
  // Room turns ripple out as "chats changed"; refresh the roster lines gently.
  gateway.onEvent((ev) => {
    if (ev.type !== 'sessions.changed') return
    clearTimeout(summaryTimer)
    summaryTimer = setTimeout(() => qc?.invalidateQueries({ queryKey: SUMMARIES }), 700)
  })
  // A new connection has no attachments; listen in again and catch up.
  // Words written while we were away are lost to the stream, so half-heard
  // turns step aside: listening in again picks up a reply still going, and the
  // log (read fresh, right away) tells the rest.
  gateway.onState((state) => {
    if (state !== 'open') return
    runtimes.clear()
    listening.clear()
    for (const id of watchers.keys()) {
      patch(id, (l) => ({ streams: Object.fromEntries(Object.entries(l.streams).filter(([, s]) => s.done)) }))
      fastUntil.set(id, Date.now() + 3000)
      void poll(id)
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    for (const id of watchers.keys()) void poll(id)
  })
}

// ── Actions ─────────────────────────────────────────────────────────────────

function wireMembers(id: string) {
  return (get(id)?.room?.members ?? []).map((m) => ({ id: m.member_id, name: displayName(m), handle: m.handle }))
}

/** Names as the person knows them (agents may have been renamed since). */
function displayName(m: WireMember) {
  const agents = qc?.getQueryData<Agent[]>(['agents'])
  return toMember(m, agents).name
}

/** Say something to the group. "@Name" asks just them. */
export async function sendToGroup(id: string, text: string) {
  const body = text.trim()
  if (!body) return
  const eventId = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const out: Outgoing = {
    id: `out-${eventId}`,
    eventId,
    text: body,
    wire: toHandles(body, wireMembers(id)),
    at: Date.now(),
  }
  patch(id, (l) => ({ outgoing: [...l.outgoing, out], stopping: undefined }))
  fastUntil.set(id, Date.now() + 6000)
  await deliver(id, out)
}

async function deliver(id: string, out: Outgoing) {
  try {
    const res = await rpc<{ event?: { event_id?: string } }>('groups.send', {
      room_id: id,
      event_id: out.eventId,
      payload: { text: out.wire, thread_id: THREAD },
    })
    const stored = res.event?.event_id
    patch(id, (l) => {
      // A quick poll may already have brought it in.
      if (!l.outgoing.some((o) => o.id === out.id)) return
      return {
        outgoing: l.events.some((e) => e.event_id === stored)
          ? l.outgoing.filter((o) => o.id !== out.id)
          : l.outgoing.map((o) => (o.id === out.id ? { ...o, stored, failed: false } : o)),
        aliases: stored ? { ...l.aliases, [stored]: out.id } : l.aliases,
      }
    })
  } catch {
    patch(id, (l) => ({ outgoing: l.outgoing.map((o) => (o.id === out.id ? { ...o, failed: true } : o)) }))
  }
  void poll(id)
}

/** Stop whoever is talking, and everyone queued after them. */
export async function stopGroup(id: string) {
  patch(id, (l) => ({
    stopping: Date.now(),
    streams: Object.fromEntries(
      Object.entries(l.streams).map(([k, s]) => [k, { ...s, done: true, tools: s.tools.map(settle) }]),
    ),
  }))
  await rpc('groups.stop', { room_id: id }).catch(() => {})
  fastUntil.set(id, Date.now() + 3000)
  void poll(id)
}

/** Answer an agent's permission request. Rooms only offer "this once" or "no". */
export async function approveInGroup(id: string, requestId: string, choice: ApprovalChoice) {
  const answer = choice === 'deny' ? 'deny' : 'once'
  patch(id, (l) => ({
    approvals: l.approvals.map((a) =>
      a.requestId === requestId ? { ...a, status: answer === 'deny' ? 'denied' : 'approved', choice: answer } : a,
    ),
  }))
  const action = get(id)?.driver?.pending_actions?.find((a) => a.kind === 'approval' && requestIdOf(a) === requestId)
  if (action) {
    await rpc('groups.approve', {
      room_id: id,
      member_id: action.member_id,
      task_id: action.task_id,
      execution_generation: action.execution_generation,
      choice: answer,
      request_id: action.request_id ?? action.approval?.request_id,
    }).catch(() => {})
  }
  held.get(requestId)?.respond({ choice: answer })
  held.delete(requestId)
  void poll(id)
}

/** Try again: a message that didn't send, or a turn Hermes couldn't finish. */
export async function retryGroup(id: string) {
  const live = get(id)
  if (!live) return
  const failed = live.outgoing.filter((o) => o.failed)
  for (const out of failed) {
    patch(id, (l) => ({ outgoing: l.outgoing.map((o) => (o.id === out.id ? { ...o, failed: false } : o)) }))
    await deliver(id, out)
  }
  const deferred = putAside(live)
  if (deferred) {
    // Hermes can refuse to pick a put-aside turn back up (after a restart,
    // say); then ask again, in the same words.
    const ok = await rpc('groups.retry', { room_id: id, task_id: deferred.task }).then(
      () => true,
      () => false,
    )
    if (!ok) return sendToGroup(id, toNames(deferred.text, wireMembers(id)))
  }
  fastUntil.set(id, Date.now() + 4000)
  void poll(id)
}

/** The latest message's turn that Hermes put aside, if it's still waiting for a retry. */
function putAside(live: Live) {
  const asked = live.events.findLastIndex((e) => e.kind === 'message.user')
  const ev = live.events.findLast((e, i) => i > asked && e.kind === 'turn.deferred')
  const task = ev && String(ev.payload.task_id ?? '')
  if (!ev || !live.driver?.pending_actions?.some((a) => a.kind === 'retry' && a.task_id === task)) return
  return { task: task!, member: memberOf(ev), text: String(live.events[asked]?.payload.text ?? '') }
}

// ── From the log to the screen ──────────────────────────────────────────────

const TERMINAL = new Set(['room.activity', 'room.stop_requested', 'room.disbanded'])
const SETTLES = new Set(['turn.settled', 'turn.failed', 'turn.cancelled'])

/** Hide a reply while it's still on its way to being "(pass)". */
function visibleText(text: string) {
  const t = text.trim()
  if (!t) return ''
  if ('(pass)'.startsWith(t.toLowerCase()) || /^\(pass\)\.?$/i.test(t)) return ''
  return t
}

/**
 * Who Hermes will hand the floor to next, when we can tell from the log alone:
 * whoever was asked (everyone, if nobody was named), then whoever another
 * agent pulled in, in roster order.
 */
function predictNext(
  events: RoomEvent[],
  members: GroupMember[],
  pendingText?: string,
  /** Turns we watched finish that the log hasn't caught up with. */
  finished: string[] = [],
): string | undefined {
  let tail: RoomEvent[]
  let text: string
  if (pendingText !== undefined) {
    tail = []
    finished = []
    text = pendingText
  } else {
    const at = events.findLastIndex((e) => e.kind === 'message.user')
    if (at < 0) return
    tail = events.slice(at + 1)
    text = String(events[at].payload.text ?? '')
  }
  if (tail.some((e) => TERMINAL.has(e.kind))) return
  const roster = members.map((m) => ({ id: m.id, name: m.name, handle: m.handle }))
  const asked = mentionedIds(text, roster)
  let responders = new Set(asked.length ? asked : roster.map((m) => m.id))
  const unlogged = new Set(finished)
  for (let round = 0; round < 4; round++) {
    const settled = new Set(
      tail.filter((e) => SETTLES.has(e.kind) && Number(e.payload.round_index ?? 0) === round).map(memberOf),
    )
    // A finished turn belongs to the earliest round that still expects them.
    for (const m of responders) {
      if (!settled.has(m) && unlogged.delete(m)) settled.add(m)
    }
    const order = [...roster.slice(round % roster.length), ...roster.slice(0, round % roster.length)]
    const next = order.find((m) => responders.has(m.id) && !settled.has(m.id))
    if (next) return next.id
    // Next round: whoever this round's speakers pulled in.
    const spoken = tail.filter((e) => e.kind === 'message.member' && Number(e.payload.round_index ?? 0) === round)
    responders = new Set(
      spoken.flatMap((e) => mentionedIds(String(e.payload.text ?? ''), roster).filter((m) => m !== memberOf(e))),
    )
    if (!responders.size) return
  }
}

type View = {
  items: ChatItem[]
  working: boolean
  /** Stop was pressed; the round is winding down. */
  stopping: boolean
  active?: GroupActivity
}

// Faces stay the same objects from render to render, so a settled turn
// compares equal and only the one being written re-renders.
const faces = new WeakMap<GroupMember, Speaker>()
const strangers = new Map<string, GroupMember>()

function castOf(members: GroupMember[]) {
  const byId = new Map(members.map((m) => [m.id, m]))
  const roster = members.map((m) => ({ id: m.id, name: m.name, handle: m.handle }))
  const speaker = (id: string): GroupMember => {
    let m = byId.get(id) ?? strangers.get(id)
    if (!m) strangers.set(id, (m = { id, profile: id, handle: id, name: titleCase(id), hue: hueFor(id), role: '' }))
    return m
  }
  const say = (m: GroupMember): Speaker => {
    let s = faces.get(m)
    if (!s) faces.set(m, (s = { id: m.id, name: m.name, hue: m.hue }))
    return s
  }
  const approvalItem = (a: Approval): ChatItem => {
    const who = speaker(a.member)
    return {
      kind: 'approval',
      id: a.id,
      requestId: a.requestId,
      title: a.command
        ? `${who.name} wants to run a command`
        : a.description
          ? `${who.name} wants to ${a.description}`
          : `${who.name} needs your OK`,
      command: a.command,
      choices: ['once', 'deny'],
      status: a.status,
      choice: a.choice,
      speaker: say(who),
    }
  }
  return { members, roster, speaker, say, approvalItem }
}
type Cast = ReturnType<typeof castOf>

/** Finished turns the log already shows (the safety net for a missed handover). */
const loggedReplies = (events: RoomEvent[]) =>
  new Set(
    events
      .filter((e) => e.kind === 'message.member')
      .map((e) => `${memberOf(e)}\u0000${String(e.payload.text ?? '').trim()}`),
  )

/** Turns being written, or written and not yet in the log, oldest first. */
const liveStreams = (streams: Record<string, Stream>, logged: Set<string>) =>
  Object.values(streams)
    .filter(
      (s) => !s.done || ((visibleText(s.text) || s.tools.length) && !logged.has(`${s.member}\u0000${s.text.trim()}`)),
    )
    .sort((a, b) => a.startedAt - b.startedAt)

/** The log as a conversation. Changes only when the log does, never per word. */
function presentLog(
  { events, aliases, trail, approvals }: Pick<Live, 'events' | 'aliases' | 'trail' | 'approvals'>,
  cast: Cast,
  /** Members with a turn on screen: their requests sit with it instead. */
  speaking: string,
): ChatItem[] {
  const { roster, speaker, say, approvalItem } = cast
  const streaming = new Set(speaking.split(','))
  const key = (eventId: string) => aliases[eventId] ?? eventId
  // An answered request sits with the reply it was part of; otherwise where it arrived.
  const withReply = new Map<string, Approval[]>()
  const placed: Approval[] = []
  for (const a of approvals.filter((a) => !streaming.has(a.member)).sort((a, b) => a.after - b.after)) {
    const reply = events.find((e) => e.kind === 'message.member' && e.seq > a.after && memberOf(e) === a.member)
    if (reply) withReply.set(reply.event_id, [...(withReply.get(reply.event_id) ?? []), a])
    else placed.push(a)
  }

  const items: ChatItem[] = []
  let p = 0
  for (const ev of events) {
    while (p < placed.length && placed[p].after < ev.seq) items.push(approvalItem(placed[p++]))
    const at = ev.created_at * 1000
    switch (ev.kind) {
      case 'message.user':
        items.push({ kind: 'user', id: key(ev.event_id), text: toNames(String(ev.payload.text ?? ''), roster), at })
        break
      case 'message.member': {
        const who = speaker(memberOf(ev))
        for (const t of trail[ev.event_id] ?? []) items.push({ ...t, speaker: say(who) })
        for (const a of withReply.get(ev.event_id) ?? []) items.push(approvalItem(a))
        const text = visibleText(String(ev.payload.text ?? ''))
        if (text)
          items.push({
            kind: 'assistant',
            id: key(ev.event_id),
            text: toNames(text, roster),
            streaming: false,
            at,
            speaker: say(who),
          })
        break
      }
      case 'turn.failed': {
        const who = speaker(memberOf(ev))
        const raw = String(ev.payload.error ?? '')
        const late = ev.payload.reason_code === 'turn_deadline_exceeded'
        // An empty line opens the member's section so the note sits under their name.
        items.push({ kind: 'assistant', id: `${ev.event_id}-who`, text: '', streaming: false, at, speaker: say(who) })
        items.push({
          kind: 'error',
          id: ev.event_id,
          message: late
            ? `${who.name} took too long to reply.`
            : `${who.name} couldn’t reply. ${raw ? friendlyError(raw) : ''}`.trim(),
        })
        break
      }
      case 'room.stop_requested':
        items.push({ kind: 'notice', id: ev.event_id, text: 'Stopped' })
        break
      case 'room.renamed':
        items.push({ kind: 'notice', id: ev.event_id, text: `Group renamed “${String(ev.payload.name ?? '')}”` })
        break
    }
  }
  while (p < placed.length) items.push(approvalItem(placed[p++]))
  return items
}

/** The log's conversation plus what's happening now: sends, turns being written, who's next. */
function present(live: Live, cast: Cast, streams: Stream[], history: ChatItem[]): View {
  const { members, roster, speaker, say, approvalItem } = cast
  const items = [...history]

  for (const o of live.outgoing) {
    items.push({ kind: 'user', id: o.id, text: o.text, at: o.at, pending: !o.stored })
    if (o.failed)
      items.push({
        kind: 'error',
        id: `${o.id}-err`,
        message: 'Couldn’t send that. Check your connection and try again.',
        retryable: true,
      })
  }

  let active: GroupActivity | undefined
  for (const s of streams) {
    const who = speaker(s.member)
    const text = visibleText(s.text)
    for (const t of s.tools) items.push({ ...t, speaker: say(who) })
    if (text)
      items.push({
        kind: 'assistant',
        id: `${s.id}-a`,
        text: toNames(text, roster),
        streaming: !s.done,
        at: s.startedAt,
        speaker: say(who),
      })
    else if (!s.tools.length)
      items.push({
        kind: 'thinking',
        id: `${s.id}-t`,
        text: '',
        streaming: true,
        startedAt: s.startedAt,
        speaker: say(who),
      })
    for (const a of live.approvals.filter((a) => a.member === s.member)) items.push(approvalItem(a))
    if (!s.done) {
      const running = s.tools.findLast((t) => t.status === 'running')
      active = running
        ? { member: who, phase: 'working', label: running.label }
        : { member: who, phase: text ? 'replying' : 'thinking' }
    }
  }

  const pendingOut = live.outgoing.find((o) => !o.failed)
  const working = Boolean(live.driver?.working || pendingOut || streams.some((s) => !s.done))

  // A turn Hermes put aside (it hit a snag) waits for a retry: offer one.
  // A turn Hermes put aside (it hit a snag) waits for a retry: offer one.
  const deferred = working ? undefined : putAside(live)
  if (deferred)
    items.push({
      kind: 'error',
      id: `retry-${deferred.task}`,
      message: `${speaker(deferred.member).name} couldn’t reply just now.`,
      retryable: true,
    })
  // Stop answers at once: nobody has the floor, nobody is up next.
  const stopping = Boolean(live.stopping) && !pendingOut
  if (stopping) return { items, working, stopping, active: undefined }

  const waiting = live.approvals.find((a) => a.status === 'pending')
  if (waiting) active = { member: speaker(waiting.member), phase: 'waiting' }

  // Between turns, or before we can hear anyone: say who's up next if we know.
  if (!active && working) {
    const pendingText = pendingOut ? toHandles(pendingOut.text, roster) : undefined
    const next = predictNext(
      live.events,
      members,
      pendingText,
      streams.filter((s) => s.done).map((s) => s.member),
    )
    if (next) {
      const who = speaker(next)
      active = { member: who, phase: 'thinking' }
      items.push({
        kind: 'thinking',
        id: `next-${next}`,
        text: '',
        streaming: true,
        // Since the floor last changed hands (steady, so the row stays put).
        startedAt: pendingOut?.at ?? (live.events.at(-1)?.created_at ?? 0) * 1000,
        speaker: say(who),
      })
    }
  }

  return { items, working, stopping, active }
}

/** Items equal to last time's are last time's, so memoised rows skip re-rendering. */
function keep(prev: ChatItem[], next: ChatItem[]) {
  if (!prev.length) return next
  const before = new Map(prev.map((i) => [i.id, i]))
  return next.map((item) => {
    const old = before.get(item.id)
    if (!old || old.kind !== item.kind) return item
    const a = old as Record<string, unknown>
    const b = item as Record<string, unknown>
    const keys = Object.keys(b)
    return keys.length === Object.keys(a).length && keys.every((k) => a[k] === b[k]) ? old : item
  })
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export type GroupView = {
  group?: Group
  items: ChatItem[]
  /** First load finished. */
  loaded: boolean
  /** The group was deleted (or never existed). */
  missing: boolean
  /** A round is running: someone is (or is about to be) talking. */
  working: boolean
  /** Who has the floor, and what they're doing. */
  active?: GroupActivity
  /** Stop was pressed and the round is winding down. */
  stopping: boolean
}

const QUIET: View = { items: [], working: false, stopping: false }
const NONE: RoomEvent[] = []

/** One group, live. Polls while mounted; streams replies when it can. */
export function useGroup(id: string): GroupView {
  bind(useQueryClient())
  useEffect(() => watch(id), [id])
  const live = useGroupLive((s) => s.rooms[id])
  const people = useAgents()
  const agents = people.data
  const listed = useQuery({ queryKey: LIST, queryFn: fetchRooms, staleTime: 5_000 }).data?.find((r) => r.room_id === id)
  const room = live?.room ?? listed
  // Faces wait for the agents, so nobody shows up in a stand-in colour first.
  const ready = Boolean(agents) || people.isError

  const group = useMemo(() => (room && ready ? toGroup(room, agents) : undefined), [room, agents, ready])
  const cast = useMemo(() => castOf(group?.members ?? []), [group])

  // Streamed words change `streams` alone; everything the log says is worked
  // out again only when the log (or a permission request) moves.
  const events = live?.events ?? NONE
  const logged = useMemo(() => loggedReplies(events), [events])
  const streams = useMemo(() => (live ? liveStreams(live.streams, logged) : []), [live?.streams, logged])
  const speaking = [...new Set(streams.map((s) => s.member))].join()
  const { aliases, trail, approvals } = live ?? {}
  const history = useMemo(
    () => (aliases && trail && approvals ? presentLog({ events, aliases, trail, approvals }, cast, speaking) : []),
    [events, aliases, trail, approvals, cast, speaking],
  )
  const view = useMemo(() => (live ? present(live, cast, streams, history) : QUIET), [live, cast, streams, history])
  const kept = useRef<ChatItem[]>([])
  const items = useMemo(() => (kept.current = keep(kept.current, view.items)), [view.items])

  return {
    group,
    items,
    // A group the list says is brand new needs no wait to show its welcome.
    loaded: ready && (Boolean(live?.loaded) || (listed?.latest_seq === 0 && !live?.outgoing.length)),
    missing: Boolean(live?.missing),
    working: view.working,
    stopping: view.stopping,
    active: view.active,
  }
}

// ── Roster summaries ────────────────────────────────────────────────────────

const tails = new Map<string, { seq: number; events: RoomEvent[] }>()

async function fetchTail(room: WireRoom) {
  const seq = room.latest_seq ?? 0
  const cached = tails.get(room.room_id)
  if (cached?.seq === seq) return cached.events
  const res = await rpc<LogResult>('groups.log', {
    room_id: room.room_id,
    since_seq: Math.max(0, seq - 16),
    limit: 16,
  }).catch(() => null)
  if (!res) return cached?.events ?? []
  tails.set(room.room_id, { seq, events: res.events })
  return res.events
}

const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** A round is running if the latest message hasn't been wrapped up yet. */
function liveFromLog(events: RoomEvent[]) {
  const last = events.at(-1)
  // Hermes gives up on a turn after ~30 minutes; anything older is stale.
  if (!last || Date.now() - last.created_at * 1000 > 35 * 60_000) return false
  for (let i = events.length - 1; i >= 0; i--) {
    if (TERMINAL.has(events[i].kind)) return false
    if (events[i].kind === 'message.user') return true
  }
  return false
}

function summarize(room: WireRoom, events: RoomEvent[], agents: Agent[] | undefined, working?: boolean): GroupSummary {
  const group = toGroup(room, agents)
  const roster = group.members.map((m) => ({ id: m.id, name: m.name, handle: m.handle }))
  const said = events.findLast(
    (e) => e.kind === 'message.user' || (e.kind === 'message.member' && visibleText(String(e.payload.text ?? ''))),
  )
  let lastLine = ''
  if (said) {
    const who =
      said.kind === 'message.user' ? 'You' : (group.members.find((m) => m.id === memberOf(said))?.name ?? 'Someone')
    lastLine = `${who}: ${plain(toNames(String(said.payload.text ?? ''), roster))}`.slice(0, 140)
  }
  const seen = seenMap()[room.room_id]
  const lastMember = events.findLast((e) => e.kind === 'message.member')
  return {
    id: group.id,
    name: group.name,
    memberIds: group.members.map((m) => m.profile),
    memberHues: group.members.map((m) => m.hue),
    lastActivityAt: Math.max(group.updatedAt, (events.at(-1)?.created_at ?? 0) * 1000),
    live: working ?? liveFromLog(events),
    lastLine,
    unread: Boolean(lastMember && lastMember.seq > (seen ?? 0) && !watchers.has(room.room_id)),
  }
}

/**
 * Every group as a roster row: name, faces, last line, whether a round is
 * running, and unread. Most recent first.
 */
export function useGroupSummaries() {
  bind(useQueryClient())
  const agents = useAgents().data
  const q = useQuery({
    queryKey: SUMMARIES,
    queryFn: async () => {
      const rooms = await fetchRooms()
      qc?.setQueryData(LIST, rooms)
      return Promise.all(rooms.map(async (room) => ({ room, events: await fetchTail(room) })))
    },
    staleTime: 2_000,
    refetchInterval: (query) => (query.state.data?.some((r) => liveFromLog(r.events)) ? 3_000 : 20_000),
  })
  // The open group knows better than the tail of its log. (Re-render on its
  // progress, not on every streamed word.)
  const pulse = useGroupLive((s) =>
    Object.entries(s.rooms)
      .map(([id, l]) => `${id}:${l.cursor}:${l.room?.name}:${isBusy(l) ? 1 : 0}`)
      .join('|'),
  )
  const data = useMemo(
    () =>
      q.data
        ?.map(({ room, events }) => {
          const live = useGroupLive.getState().rooms[room.room_id]
          const own = live?.loaded && !live.missing ? live : undefined
          return summarize(
            own?.room ?? room,
            own ? own.events.slice(-16) : events,
            agents,
            own ? isBusy(own) : undefined,
          )
        })
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.data, pulse, agents],
  )
  return { ...q, data }
}
