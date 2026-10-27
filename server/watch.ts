// What Murmur's server notices by itself, so notifications reach a phone
// whose tabs are closed: an agent finishing a reply or needing the person, a
// routine run finding something, a group's round ending. One watcher per
// Hermes, kept by notifications.ts while any device wants to be told.
//
// Chats: Hermes's live sessions (session.active_list), looked at every
//   couple of seconds while one is busy and whenever Hermes says chats
//   changed. Busy then idle is a finished reply, and so is a reply that came
//   and went between looks; waiting is a question, read from what Hermes is
//   still waiting on (session.events.since).
// Routines: each agent's newest runs (shared/routines.ts decides which landed).
// Groups: each room's log; a round that was running and isn't has ended, and
//   while one runs, the OKs it waits on.
//
// What had already happened at the first look isn't news; what's still going
// then (a reply, a question waiting, a run, a round) is told as it would be.

import { agentName, titleCase, type NamedProfile } from '../shared/agents.ts'
import { joinNames, lastLine, liveFromLog, TERMINAL, type RoomEvent } from '../shared/groups.ts'
import { askNote, askText, groupAskNote, groupNote, replyNote, runNote, type Note, type StoredMessage } from '../shared/notes.ts'
import { deliversElsewhere, isQuiet, isRunBrief, look, routineIdOf, runTitle, type Memory, type RunRow } from '../shared/routines.ts'
import type { Hermes } from './hermes.ts'
import { openSocket, RpcError, type HermesEvent } from './socket.ts'

/** Something to tell the person. An ask stays open (by `key`) until it's answered. */
export type Moment = { kind: 'note'; note: Note } | { kind: 'ask'; key: string; note: Note } | { kind: 'answered'; key: string }

export type WatchDeps = {
  call: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  /** A signed-in REST read; null when it didn't answer. */
  get: <T>(path: string) => Promise<T | null>
  tell: (moment: Moment) => void
  now?: () => number
  /** Waits between looks at a chat that just finished, while Hermes saves it. */
  pause?: (ms: number) => Promise<void>
}

type LiveRow = { id: string; session_key: string; status: string; title?: string; message_count?: number }
type OpenRequest = { id: string; method: string; params?: Record<string, unknown> }
type Owner = { profile: string; source: string }
type SessionRow = { id: string; title?: string | null; source?: string | null; started_at?: number; end_reason?: string | null; cron_job_id?: string | null }
type MessageRow = StoredMessage & { id?: number; timestamp?: number }
type JobRow = { id: string; name?: string; prompt?: string; deliver?: unknown }
type WireMember = { member_id: string; profile: string; handle: string; display_name?: string }
type WireRoom = { room_id: string; name?: string; members: WireMember[]; latest_seq?: number }
type PendingAction = { kind: string; task_id?: string; request_id?: string; member_id?: string; approval?: { request_id?: string } }

const BUSY = new Set(['working', 'waiting', 'starting'])
/** A group's behind-the-scenes chats, told as the group's. */
const GROUP_CHAT = 'bot_room'
/** A routine's runs, told as runs until the person replies in one. */
const RUN = 'cron'
/** How far a reply's time may trail the last look (clocks, and Hermes saving it). */
const SLACK_MS = 3000
/** Past every event Hermes keeps, so asking for what's waiting brings no history with it. */
const LATEST = Number.MAX_SAFE_INTEGER
const q = encodeURIComponent

const missing = (error: unknown) => error instanceof RpcError && error.code === -32601

export function createWatcher({ call, get, tell, now = Date.now, pause = (ms) => new Promise((done) => setTimeout(done, ms)) }: WatchDeps) {
  // ── Agents ────────────────────────────────────────────────────────────────

  let profiles: { list: NamedProfile[]; at: number } | null = null

  async function agents(): Promise<NamedProfile[]> {
    if (profiles && now() - profiles.at < 60_000) return profiles.list
    let list: NamedProfile[]
    try {
      list = (await call<{ profiles: NamedProfile[] }>('profiles.list')).profiles
    } catch (error) {
      if (!missing(error)) throw error
      list = (await get<{ profiles: NamedProfile[] }>('/api/profiles'))?.profiles ?? []
    }
    profiles = { list, at: now() }
    return list
  }

  /** An agent's name; a group member Hermes no longer lists keeps the name it was given. */
  async function nameOf(profile: string, given?: string) {
    const found = (await agents()).find((p) => p.name === profile)
    return found ? agentName(found) : given?.trim() || (profile === 'default' ? 'Hermes' : titleCase(profile))
  }

  // Live sessions know their stored id but not their agent: each agent's newest chats say.
  const owners = new Map<string, Owner>()
  let ownersAt = 0

  async function ownerOf(key: string, fresh = false): Promise<Owner | undefined> {
    if ((!owners.has(key) && now() - ownersAt > 5000) || fresh) {
      ownersAt = now()
      owners.clear()
      for (const p of await agents()) {
        const res = await call<{ sessions: SessionRow[] }>('session.list', { profile: p.name, limit: 40, include_hidden: true })
        for (const s of res.sessions ?? []) owners.set(s.id, { profile: p.name, source: s.source ?? '' })
      }
    }
    return owners.get(key)
  }

  // ── Chats ─────────────────────────────────────────────────────────────────

  type Live = { key: string; count: number; busy: boolean; ask?: string }

  /** Live chats by their live id, as last seen: how many messages each held, whether it was busy, the ask it waits on. */
  const live = new Map<string, Live>()
  let looked = 0

  async function chats() {
    const { sessions: rows } = await call<{ sessions: LiveRow[] }>('session.active_list')
    const since = looked
    looked = now()
    const present = new Set<string>()
    for (const row of rows ?? []) {
      if (row.title?.startsWith('Group: ')) continue
      present.add(row.id)
      const count = row.message_count ?? 0
      const was = live.get(row.id)
      const chat = was ?? { key: row.session_key, count, busy: false }
      live.set(row.id, chat)
      const grew = count > chat.count
      chat.count = count
      // Compacting a long chat saves it afresh, under a new id.
      chat.key = row.session_key
      if (BUSY.has(row.status)) {
        chat.busy = true
        if (row.status === 'waiting') await asking(row.id, chat)
        else answered(chat)
      } else if (chat.busy) {
        chat.busy = false
        await finished(chat)
      } else if (since && (grew || (!was && count))) {
        // A reply that came and went between looks: told if it's new since the last one.
        await finished(chat, since)
      }
    }
    // Gone from the list: let go of by Hermes, finished if it was busy.
    for (const [id, chat] of live) {
      if (present.has(id)) continue
      live.delete(id)
      if (chat.busy) await finished(chat)
    }
  }

  /** Whether a chat is busy, so it's looked at often. */
  const busy = () => [...live.values()].some((chat) => chat.busy)

  function answered(chat: Live) {
    if (!chat.ask) return
    tell({ kind: 'answered', key: chat.ask })
    chat.ask = undefined
  }

  async function asking(id: string, chat: Live) {
    // Only read: an answer from here, even a refusal, would settle the question for the person.
    const res = await call<{ open_requests?: OpenRequest[] }>('session.events.since', { session_id: id, last_seen: LATEST })
    // The oldest question Murmur can answer; others (a terminal read) aren't the person's.
    const request = (res.open_requests ?? []).find((r) => askText(r.method, r.params ?? {}))
    if (request?.id === chat.ask) return
    answered(chat)
    if (!request) return
    const owner = await ownerOf(chat.key)
    if (!owner || owner.source === GROUP_CHAT) return
    chat.ask = request.id
    const ask = askText(request.method, request.params ?? {})!
    tell({ kind: 'ask', key: request.id, note: askNote(await nameOf(owner.profile), { id: chat.key, profile: owner.profile }, ask) })
  }

  /** A chat stopped working: its reply, if it has one (and, when it wasn't seen working, one written `since` then). */
  async function finished(chat: Live, since?: number) {
    answered(chat)
    // Hermes may still be saving the reply (or the chat, when it's new) for a moment.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await pause(1500)
      const owner = await ownerOf(chat.key, attempt > 0)
      if (!owner) continue
      if (owner.source === GROUP_CHAT) return
      const res = await get<{ messages?: MessageRow[] }>(`/api/sessions/${q(chat.key)}/messages?profile=${q(owner.profile)}&order=latest&limit=20`)
      const messages = chronological(res?.messages ?? [])
      if (owner.source === RUN && !repliedIn(messages)) return
      // A chat opened again isn't a reply: its newest answer is older than the last look.
      const answeredAt = messages.findLast((m) => m.role === 'assistant')?.timestamp ?? 0
      if (since && answeredAt * 1000 < since - SLACK_MS) return
      const note = replyNote(await nameOf(owner.profile), { id: chat.key, profile: owner.profile }, messages)
      if (note) return tell({ kind: 'note', note })
    }
  }

  // ── Routines ──────────────────────────────────────────────────────────────

  const memories = new Map<string, Memory>()

  async function runs() {
    for (const agent of await agents()) await runsOf(agent.name).catch(() => {})
  }

  async function runsOf(agent: string) {
    // Only Hermes's scheduler makes chats from "cron", so these are all runs.
    const res = await get<{ sessions?: SessionRow[] }>(`/api/sessions?profile=${q(agent)}&source=cron&order=recent&limit=20`)
    if (!res) return
    const rows = (res.sessions ?? []).map(
      (s): RunRow & { routineId?: string } => ({
        id: s.id,
        startedAt: s.started_at ?? 0,
        finished: Boolean(s.end_reason?.startsWith('cron_')),
        title: s.title ?? '',
        routineId: s.cron_job_id || routineIdOf(s.id),
      }),
    )
    const { memory, landed } = look(rows, memories.get(agent))
    memories.set(agent, memory)
    if (!landed.length) return
    const jobs = await get<JobRow[]>(`/api/cron/jobs?profile=${q(agent)}`)
    for (const run of landed) {
      const routineId = run.routineId ?? (await get<SessionRow>(`/api/sessions/${q(run.id)}?profile=${q(agent)}`))?.cron_job_id
      const said = await get<{ messages?: MessageRow[] }>(`/api/sessions/${q(run.id)}/messages?profile=${q(agent)}&order=latest&limit=20`)
      // Hermes didn't answer: the next look tries this run again.
      if (!Array.isArray(jobs) || !said) {
        memory.done.delete(run.id)
        memory.going.add(run.id)
        continue
      }
      const job = jobs.find((j) => j.id === routineId)
      if (job && deliversElsewhere(job.deliver)) continue
      const messages = chronological(said.messages ?? [])
      const text = (messages.findLast((m) => m.role === 'assistant' && m.content?.trim())?.content ?? '').trim()
      // Nothing to report, or a run you've replied in (a conversation, told like any chat).
      if (!text || isQuiet(text) || repliedIn(messages)) continue
      const routine = (job?.name || job?.prompt || runTitle(run.title) || 'Routine').trim()
      const note = runNote({ agentId: agent, runId: run.id, routine, text })
      if (note) tell({ kind: 'note', note })
    }
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  const rooms = new Map<string, { seq: number; live: boolean; asks: Set<string> }>()

  async function groups() {
    let list: WireRoom[]
    try {
      list = (await call<{ rooms: WireRoom[] }>('groups.list', { limit: 200 })).rooms ?? []
    } catch (error) {
      if (missing(error)) return // A Hermes from before group chats.
      throw error
    }
    const present = new Set(list.map((r) => r.room_id))
    for (const [id, room] of rooms) {
      if (present.has(id)) continue
      for (const key of room.asks) tell({ kind: 'answered', key })
      rooms.delete(id)
    }
    for (const room of list) await groupOf(room)
  }

  async function groupOf(room: WireRoom) {
    const seq = room.latest_seq ?? 0
    const known = rooms.get(room.room_id)
    if (known && known.seq === seq && !known.live) return
    const events = await tailOf(room.room_id, seq)
    const isLive = liveFromLog(events, now())
    const roster = await Promise.all(
      room.members.map(async (m) => ({ id: m.member_id, handle: m.handle, name: await nameOf(m.profile, m.display_name) })),
    )
    const group = { id: room.room_id, name: room.name?.trim() || joinNames(roster.map((m) => m.name)) }
    // While a round runs, the OKs it waits on.
    const asks = known?.asks ?? new Set<string>()
    const open = new Map<string, PendingAction>()
    if (isLive) {
      const state = await call<{ driver_status?: { pending_actions?: PendingAction[] } }>('groups.state', { room_id: room.room_id })
      for (const action of state.driver_status?.pending_actions ?? []) {
        if (action.kind !== 'approval') continue
        open.set(`group:${room.room_id}:${action.request_id ?? action.approval?.request_id ?? action.task_id}`, action)
      }
    }
    for (const key of asks) {
      if (open.has(key)) continue
      asks.delete(key)
      tell({ kind: 'answered', key })
    }
    for (const [key, action] of open) {
      if (asks.has(key)) continue
      asks.add(key)
      const who = roster.find((m) => m.id === action.member_id)?.name ?? 'An agent'
      tell({ kind: 'ask', key, note: groupAskNote(group, who) })
    }
    rooms.set(room.room_id, { seq, live: isLive, asks })
    if (known?.live && !isLive) {
      const note = groupNote({ ...group, lastLine: lastLine(events, roster) })
      if (note) tell({ kind: 'note', note })
    }
  }

  /** A room's newest events: enough to say whether a round is running, reading further back while one runs long. */
  async function tailOf(roomId: string, seq: number) {
    const read = (limit: number) =>
      call<{ events?: RoomEvent[] }>('groups.log', { room_id: roomId, since_seq: Math.max(0, seq - limit), limit }).then((r) => r.events ?? [])
    const events = await read(16)
    const said = (e: RoomEvent) => e.kind === 'message.user' || TERMINAL.has(e.kind)
    return seq <= 16 || events.some(said) ? events : read(256)
  }

  /** Whether a round is running somewhere, so groups are looked at often. */
  const rounds = () => [...rooms.values()].some((r) => r.live)

  return { chats, busy, runs, groups, rounds }
}

/** Oldest first, in the order Hermes saved them (its ids count up; two can share a timestamp). */
const chronological = (rows: MessageRow[]) =>
  [...rows].sort((a, b) => (a.id !== undefined && b.id !== undefined ? a.id - b.id : (a.timestamp ?? 0) - (b.timestamp ?? 0)))

/** The person said something in it, beyond the brief a routine's run starts with. */
const repliedIn = (messages: StoredMessage[]) => messages.some((m) => m.role === 'user' && m.content?.trim() && !isRunBrief(m.content))

// ── Running it ──────────────────────────────────────────────────────────────

/** A look that runs one at a time, again `every` ms after it ends, and sooner when asked. */
function loop(pass: () => Promise<void>, every: () => number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let due = Infinity
  let running = false
  let again = false
  let stopped = false

  async function run() {
    timer = undefined
    due = Infinity
    if (running) return void (again = true)
    running = true
    try {
      await pass()
    } catch {
      // Hermes is away or restarting: the next look tries again.
    } finally {
      running = false
    }
    if (again) {
      again = false
      return soon(0)
    }
    soon(every())
  }

  function soon(ms: number) {
    if (stopped || Date.now() + ms >= due) return
    clearTimeout(timer)
    due = Date.now() + ms
    timer = setTimeout(run, ms)
    timer.unref?.()
  }

  return { soon, stop: () => ((stopped = true), clearTimeout(timer)) }
}

/** Watches one Hermes until stopped, telling `tell` what the person should hear. */
export function watchHermes(hermes: Hermes, tell: (moment: Moment) => void) {
  const loops: ReturnType<typeof loop>[] = []
  const socket = openSocket(hermes, {
    onOpen: () => loops.forEach((l) => l.soon(0)),
    onEvent: (event: HermesEvent) => {
      if (event.type === 'sessions.changed') {
        chats.soon(300)
        groups.soon(700)
        // Chats change all the time; a run that lands can wait a few seconds.
        runs.soon(10_000)
      }
      if (event.type === 'cron.changed') runs.soon(1500)
    },
  })
  const watcher = createWatcher({ call: socket.call, get: (path) => hermes.read(path, 10_000), tell })
  const chats = loop(watcher.chats, () => (watcher.busy() ? 2000 : 10_000))
  const groups = loop(watcher.groups, () => (watcher.rounds() ? 3000 : 20_000))
  const runs = loop(watcher.runs, () => 60_000)
  loops.push(chats, groups, runs)
  return {
    stop() {
      for (const l of loops) l.stop()
      socket.close()
    },
  }
}
