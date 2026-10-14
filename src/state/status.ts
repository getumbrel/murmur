// What each agent is doing right now, for the roster's orbs and activity lines.
//
// Chats open in Murmur report through the chat store. Chats running elsewhere
// (Hermes Desktop, the CLI, another tab) are picked up from Hermes's list of
// live sessions, which knows their stored id but not their agent, so owners
// are looked up from each agent's chat list once.

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { gateway, rpc } from '@/hermes/gateway'
import { useChats, type Chat } from '@/state/chats'
import type { OrbState } from '@/ui/orb'
import { scoped } from '@/hermes/instance'
import { listProfiles } from '@/hermes/compat'

type Remote = { status: 'working' | 'waiting'; title: string }

type Store = {
  /** Busy chats in other apps, by stored id. */
  remote: Record<string, Remote>
  /** Stored chat id → agent id. */
  owners: Record<string, string>
  /** Agents that just finished a reply, so their orb can smile for a moment. */
  finished: Record<string, true>
}

const useStatus = create<Store>(() => ({ remote: {}, owners: {}, finished: {} }))

const BUSY = new Set(['thinking', 'working', 'waiting'])
const DONE_MS = 2400

function markFinished(agentId: string) {
  useStatus.setState((s) => ({ finished: { ...s.finished, [agentId]: true } }))
  setTimeout(() => {
    useStatus.setState((s) => {
      const finished = { ...s.finished }
      delete finished[agentId]
      return { finished }
    })
  }, DONE_MS)
}

// ── Chats in other apps ─────────────────────────────────────────────────────

type LiveRow = { session_key: string; status: string; title: string }

let lookedUpAt = 0

async function lookUpOwners() {
  if (Date.now() - lookedUpAt < 15_000) return
  lookedUpAt = Date.now()
  const profiles = await listProfiles()
  const owners: Record<string, string> = {}
  await Promise.all(
    profiles.map(async (p) => {
      const res = await rpc<{ sessions: { id: string }[] }>('session.list', { profile: p.name, limit: 40, include_hidden: true })
      for (const s of res.sessions) owners[s.id] = p.name
    }),
  )
  useStatus.setState((s) => ({ owners: { ...s.owners, ...owners } }))
}

async function refreshRemote() {
  const { sessions } = await rpc<{ sessions: LiveRow[] }>('session.active_list', {})
  const remote: Record<string, Remote> = {}
  for (const row of sessions) {
    if (row.status === 'working' || row.status === 'waiting' || row.status === 'starting') {
      remote[row.session_key] = { status: row.status === 'waiting' ? 'waiting' : 'working', title: row.title }
    }
  }
  const { remote: before, owners } = useStatus.getState()
  for (const id of Object.keys(before)) if (!remote[id] && owners[id]) markFinished(owners[id])
  useStatus.setState({ remote })
  if (Object.keys(remote).some((id) => !owners[id])) await lookUpOwners()
  schedulePoll(Object.keys(remote).length > 0)
}

let pollTimer: ReturnType<typeof setTimeout> | undefined

/** Poll briefly while something elsewhere is busy; otherwise rarely. */
function schedulePoll(busy: boolean) {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(refresh, busy ? 3_000 : 20_000)
}

function refresh() {
  if (document.visibilityState !== 'visible') return schedulePoll(false)
  refreshRemote().catch(() => schedulePoll(false))
}

// ── Wiring ──────────────────────────────────────────────────────────────────

let wired = false

/** Starts on first use; idempotent. */
export function wireStatus() {
  if (wired) return
  wired = true
  let debounce: ReturnType<typeof setTimeout> | undefined
  gateway.onEvent((ev) => {
    if (ev.type !== 'sessions.changed') return
    clearTimeout(debounce)
    debounce = setTimeout(refresh, 500)
  })
  gateway.onState((state) => state === 'open' && refresh())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh())

  // A Murmur chat that goes from busy to idle has just finished.
  let prev = useChats.getState().chats
  useChats.subscribe(({ chats }) => {
    for (const chat of Object.values(chats)) {
      const before = prev[chat.id]
      if (before && BUSY.has(before.status) && chat.status === 'idle') markFinished(chat.profile)
    }
    prev = chats
  })
  refresh()
}

// ── Reading ─────────────────────────────────────────────────────────────────

export type AgentStatus = {
  state: OrbState
  /** Present-tense words for what it's doing: "Searching the web". */
  activity?: string
  /** The chat it's busy in, if any. */
  chatId?: string
}

const RANK: Record<string, number> = { waiting: 4, working: 3, thinking: 3, error: 1 }

function activityOf(chat: Chat): string {
  if (chat.status === 'waiting') return 'Needs you'
  const last = chat.items.at(-1)
  if (last?.kind === 'tool' && last.status === 'running') return last.label
  if (last?.kind === 'assistant' && last.streaming) return 'Writing'
  return 'Thinking'
}

/** The agent's state across all its chats: waiting beats working beats error. */
export function useAgentStatus(agentId: string): AgentStatus {
  wireStatus()
  const local = useChats(
    useShallow((s) => {
      let best: Chat | undefined
      for (const chat of Object.values(s.chats)) {
        if (chat.profile !== agentId || !RANK[chat.status]) continue
        if (!best || RANK[chat.status] > RANK[best.status]) best = chat
      }
      if (!best) return { state: undefined, activity: undefined, chatId: undefined }
      const state = best.status === 'thinking' ? 'thinking' : best.status
      return { state: state as OrbState, activity: best.status === 'error' ? undefined : activityOf(best), chatId: best.id }
    }),
  )
  const remote = useStatus(
    useShallow((s) => {
      const id = Object.keys(s.remote).find((key) => s.owners[key] === agentId && !useChats.getState().chats[key]?.runtimeId)
      return { id, status: id ? s.remote[id].status : undefined, finished: !!s.finished[agentId] }
    }),
  )
  if (local.state === 'waiting' || remote.status === 'waiting') {
    return { state: 'waiting', activity: 'Needs you', chatId: local.state === 'waiting' ? local.chatId : remote.id }
  }
  if (local.state && local.state !== 'error') return local
  if (remote.status) return { state: 'working', activity: 'Working', chatId: remote.id }
  if (remote.finished) return { state: 'done' }
  if (local.state === 'error') return local
  return { state: 'idle' }
}

export type NeedsYou = { chatId: string; agentId: string; text: string }

/** Chats waiting on the person: an approval or a question. */
export function useNeedsYou(): NeedsYou[] {
  wireStatus()
  const local = useChats(useShallow((s) => Object.values(s.chats).filter((c) => c.status === 'waiting').map((c) => c.id)))
  const remote = useStatus(
    useShallow((s) => Object.keys(s.remote).filter((id) => s.remote[id].status === 'waiting' && s.owners[id] && !local.includes(id))),
  )
  const { chats } = useChats.getState()
  const { owners } = useStatus.getState()
  return [
    ...local.map((chatId) => {
      const chat = chats[chatId]
      const ask = chat.items.findLast((i) => (i.kind === 'approval' || i.kind === 'clarify') && i.status === 'pending')
      const text = ask?.kind === 'approval' ? ask.title : ask?.kind === 'clarify' ? ask.questions[0]?.question : undefined
      return { chatId, agentId: chat.profile, text: text || 'Waiting for your answer' }
    }),
    ...remote.map((chatId) => ({ chatId, agentId: owners[chatId], text: 'Waiting for your answer' })),
  ]
}

/** Agents busy right now (here or elsewhere), so the roster can lift them up. */
export function useBusyAgents(): string[] {
  wireStatus()
  const local = useChats(useShallow((s) => Object.values(s.chats).flatMap((c) => (BUSY.has(c.status) ? [c.profile] : []))))
  const remote = useStatus(useShallow((s) => Object.keys(s.remote).flatMap((id) => (s.owners[id] ? [s.owners[id]] : []))))
  return [...new Set([...local, ...remote])]
}

// ── Unread ──────────────────────────────────────────────────────────────────
// Hermes never marks anything unread, so Murmur keeps its own watermarks (like
// Hermes Desktop): when you last looked at each chat. A chat is unread when it
// moved after that. Chats we've never opened count from the first time Murmur
// ran here, so a fresh install doesn't light everything up. Groups keep their
// own watermark (the room's log position) in state/groups.

const SEEN_KEY = scoped('murmur:seen')
const SINCE_KEY = scoped('murmur:seen-since')
/** Hermes's clock and ours can disagree by a moment. */
const SLACK = 2_000

function loadSeen(): { seen: Record<string, number>; since: number } {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>
    let since = Number(localStorage.getItem(SINCE_KEY))
    if (!since) {
      since = Date.now()
      localStorage.setItem(SINCE_KEY, String(since))
    }
    return { seen, since }
  } catch {
    return { seen: {}, since: Date.now() }
  }
}

type SeenStore = {
  seen: Record<string, number>
  since: number
  /** The chat on screen right now (and the tab is visible). */
  viewing?: string
}

const useSeen = create<SeenStore>(() => loadSeen())

const MAX_SEEN = 400

/** You've just looked at this chat. */
export function markChatSeen(chatId: string) {
  const at = Date.now()
  useSeen.setState((s) => {
    let entries = Object.entries({ ...s.seen, [chatId]: at })
    // Keep the newest few hundred; anything older reads as seen anyway.
    if (entries.length > MAX_SEEN) entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN)
    const seen = Object.fromEntries(entries)
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
    } catch {
      // Private mode: unread only lasts the visit.
    }
    return { seen }
  })
}

export function setViewingChat(chatId: string | undefined) {
  if (useSeen.getState().viewing !== chatId) useSeen.setState({ viewing: chatId })
}

/** Did this chat move since you last looked? `at` is its last activity (ms). */
export function useChatUnread(chatId: string | undefined, at: number | undefined) {
  return useSeen((s) => isUnread(s, chatId, at))
}

function isUnread(s: SeenStore, chatId: string | undefined, at: number | undefined) {
  if (!chatId || !at || s.viewing === chatId) return false
  return at > (s.seen[chatId] ?? s.since) + SLACK
}

/** How many of these chats moved since you last looked. */
export function useUnreadCount(chats: { id: string; at: number }[]) {
  const key = chats.map((c) => `${c.id}@${c.at}`).join('|')
  return useSeen((s) => key.split('|').filter((pair) => {
    if (!pair) return false
    const [id, at] = pair.split('@')
    return isUnread(s, id, Number(at))
  }).length)
}
