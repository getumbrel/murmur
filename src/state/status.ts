// What each agent is doing right now, for the roster's orbs and activity lines.
//
// Chats open in Murmur report through the chat store. Chats running elsewhere
// (Hermes Desktop, the CLI, another tab) are picked up from Hermes's list of
// live sessions, which knows their stored id but not their agent, so owners
// are looked up from each agent's chat list once.

import { useMemo } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { gateway, rpc } from '@/hermes/gateway'
import { useChats, type Chat } from '@/state/chats'
import { secretAskText } from '@shared/notes.ts'
import type { OrbState } from '@/ui/orb'
import { firstHermes, hermesOf, homeOf, onHermesIds, scoped } from '@/hermes/instance'
import { everyHermes } from '@/hermes/kept'
import { listEveryProfile } from '@/hermes/compat'
import { useAwayOn } from '@/state/reach'

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
  // Every Hermes's agents, by id: each chat's owner is the agent it's listed under.
  const profiles = await listEveryProfile()
  const owners: Record<string, string> = {}
  await Promise.all(
    profiles.map(async (p) => {
      const res = await rpc<{ sessions: { id: string }[] }>('session.list', { profile: p.name, limit: 40, include_hidden: true }).catch(
        () => ({ sessions: [] }),
      )
      for (const s of res.sessions) owners[s.id] = p.name
    }),
  )
  useStatus.setState((s) => ({ owners: { ...s.owners, ...owners } }))
}

async function refreshRemote() {
  // Each Hermes that's connected says what's mid-turn on it; one that's away has nothing to say.
  const asked = everyHermes().filter((hermes) => gateway.stateOf(hermes) === 'open')
  const lists = await Promise.all(
    asked.map((hermes) =>
      rpc<{ sessions: LiveRow[] }>('session.active_list', {}, undefined, hermes).then(
        (r) => r.sessions,
        (error) => {
          // One Hermes: its failure is the answer, as it always was.
          if (asked.length === 1) throw error
          return [] as LiveRow[]
        },
      ),
    ),
  )
  const remote: Record<string, Remote> = {}
  for (const row of lists.flat()) {
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
  void refreshActivity()
}

let asking: Promise<void> | undefined

/**
 * Asks Hermes which chats are mid-turn in other apps; calls while one is out
 * share its answer. Chat lists wait for this before they take in a change
 * (state/sync.ts), so a chat that has just started working never moves first.
 */
export function refreshActivity(): Promise<void> {
  asking ??= refreshRemote()
    .catch(() => schedulePoll(false))
    .finally(() => (asking = undefined))
  return asking
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

  // A Murmur chat that goes from busy to idle has just finished; one that
  // starts waiting has just asked something.
  let prev = useChats.getState().chats
  useChats.subscribe(({ chats }) => {
    for (const chat of Object.values(chats)) {
      const before = prev[chat.id]
      if (!before || before === chat) continue
      if (BUSY.has(before.status) && chat.status === 'idle') {
        markFinished(chat.profile)
        tell({ kind: 'finished', chat })
      }
      if (chat.status === 'waiting' && before.status !== 'waiting') tell({ kind: 'needs-you', chat })
    }
    prev = chats
  })
  refresh()
}

/** Something worth telling the person about in a chat open in Murmur. */
export type ChatMoment = { kind: 'finished' | 'needs-you'; chat: Chat }

const listeners = new Set<(moment: ChatMoment) => void>()

function tell(moment: ChatMoment) {
  for (const fn of listeners) fn(moment)
}

/** Called when a chat's reply finishes or it starts waiting on the person. Returns the unsubscribe. */
export function onChatMoment(fn: (moment: ChatMoment) => void) {
  wireStatus()
  listeners.add(fn)
  return () => void listeners.delete(fn)
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
  const away = useAwayOn(hermesOf(agentId))
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
  // Nothing of it can be reached: asleep, whatever it was doing when the connection went.
  if (away) return { state: 'offline' }
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
      const ask = chat.items.findLast(
        (i) => (i.kind === 'approval' || i.kind === 'clarify' || i.kind === 'secret') && i.status === 'pending',
      )
      const text =
        ask?.kind === 'approval'
          ? ask.title
          : ask?.kind === 'clarify'
            ? ask.questions[0]?.question
            : ask?.kind === 'secret'
              ? secretAskText(ask)
              : undefined
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

// ── Mid-turn ────────────────────────────────────────────────────────────────
// Hermes stamps a chat's last activity with every step of a turn (your
// message, each tool call it stores, a heartbeat), not just when the agent
// speaks. So from the moment a chat is asked until its reply lands, lists
// hold it (and its agent) where they were, its title glows instead, and it
// isn't new to you yet. Then it moves, once.

/** A chat mid-turn: working on it, or waiting on you (an approval or a question). */
export type ChatActivity = 'working' | 'waiting'

/** Chats mid-turn right now, here or in another app, by stored id. */
export function useChatActivities(): Readonly<Record<string, ChatActivity>> {
  wireStatus()
  const local = useChats(useShallow((s) => localActivities(s.chats)))
  const remote = useStatus(useShallow((s) => Object.fromEntries(Object.entries(s.remote).map(([id, r]) => [id, r.status]))))
  return useMemo(() => mergeActivities(local, remote), [local, remote])
}

/** What one chat is doing right now, as useChatActivities has it. */
export function useChatActivity(chatId: string | undefined): ChatActivity | undefined {
  wireStatus()
  const local = useChats((s) => {
    const chat = chatId ? s.chats[chatId] : undefined
    return chat ? localActivities({ [chat.id]: chat })[chat.id] : undefined
  })
  const remote = useStatus((s) => (chatId ? s.remote[chatId]?.status : undefined))
  return local === 'idle' ? undefined : (local ?? remote)
}

/**
 * What the chats on this page are doing; one attached here and at rest says so too. A turn
 * Hermes started elsewhere counts from its start, before this page shows it.
 */
export function localActivities(chats: Record<string, Pick<Chat, 'id' | 'status' | 'runtimeId' | 'starting'>>) {
  const out: Record<string, ChatActivity | 'idle'> = {}
  for (const c of Object.values(chats)) {
    if (c.status === 'waiting') out[c.id] = 'waiting'
    else if (BUSY.has(c.status) || c.starting) out[c.id] = 'working'
    else if (c.runtimeId) out[c.id] = 'idle'
  }
  return out
}

/**
 * Hermes's list of chats mid-turn (polled, so a beat behind), with each chat
 * attached here speaking for itself, the moment it changes.
 */
export function mergeActivities(local: Record<string, ChatActivity | 'idle'>, remote: Record<string, ChatActivity>) {
  const out: Record<string, ChatActivity> = { ...remote }
  for (const [id, now] of Object.entries(local)) {
    if (now === 'idle') delete out[id]
    else out[id] = now
  }
  return out
}

/**
 * Where each chat, or agent, stands in its list: when it last came to rest,
 * or (`rested: false`) when first seen, if that was mid-turn.
 */
const settled = new Map<string, { at: number; rested: boolean }>()

/**
 * Where a list should place something that last moved `at`: there, unless
 * it's mid-turn, when it stays where it was before the turn began (or where
 * it was first seen, if that was mid-turn). Keys are chat ids, or anything
 * else that's held the same way.
 */
export function settledAt(key: string, at: number, busy: boolean) {
  const was = settled.get(key)
  if (!busy || !was) settled.set(key, { at, rested: !busy })
  return busy && was ? was.at : at
}

/** When a chat last came to rest, as far as this page saw. */
const restedAt = (chatId: string | undefined) => {
  const was = chatId ? settled.get(chatId) : undefined
  return was?.rested ? was.at : undefined
}

// ── Unread ──────────────────────────────────────────────────────────────────
// Hermes never marks anything unread, so Murmur keeps its own watermarks (like
// Hermes Desktop): when you last looked at each chat. A chat is unread when it
// moved after that. Chats we've never opened count from the first time Murmur
// ran here, so a fresh install doesn't light everything up. Groups keep their
// own watermark (the room's log position) in state/groups.

const SEEN_KEY = 'murmur:seen'
const SINCE_KEY = 'murmur:seen-since'
/** A little slack, so a reply's own timestamp never reads as newer than the look that saw it. */
const SLACK = 2_000

// Each Hermes keeps its own marks, as it did when the app used one at a
// time: read as one here, and a look is kept with the Hermes the chat is on.
// "Since" is each Hermes's own too: one added today doesn't light up every
// chat it already had.
function loadSeen(): { seen: Record<string, number>; since: Record<string, number> } {
  const seen: Record<string, number> = {}
  const since: Record<string, number> = {}
  for (const hermes of everyHermes()) {
    try {
      const kept = JSON.parse(localStorage.getItem(scoped(SEEN_KEY, hermes)) ?? '{}') as Record<string, number>
      for (const [id, at] of Object.entries(kept)) if (!(seen[id] >= at)) seen[id] = at
      let first = Number(localStorage.getItem(scoped(SINCE_KEY, hermes)))
      if (!first) {
        first = Date.now()
        localStorage.setItem(scoped(SINCE_KEY, hermes), String(first))
      }
      since[hermes ?? ''] = first
    } catch {
      since[hermes ?? ''] = Date.now()
    }
  }
  return { seen, since }
}

type SeenStore = {
  seen: Record<string, number>
  /** When Murmur first ran here against each Hermes ('' where none is named yet). */
  since: Record<string, number>
  /** The chat on screen right now (and the tab is visible). */
  viewing?: string
}

const useSeen = create<SeenStore>(() => loadSeen())

// A Hermes just added: what it already has isn't new to you; what comes from
// here on is. (One this browser has used before keeps the marks it had.)
onHermesIds(() => {
  const { seen, since } = loadSeen()
  useSeen.setState((s) => ({ seen: { ...seen, ...s.seen }, since: { ...since, ...s.since } }))
})

const MAX_SEEN = 400

/** You've just looked at this chat. */
export function markChatSeen(chatId: string) {
  const at = Date.now()
  useSeen.setState((s) => ({ seen: { ...s.seen, [chatId]: at } }))
  const key = scoped(SEEN_KEY, homeOf(chatId) ?? firstHermes())
  try {
    let entries = Object.entries({ ...(JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, number>), [chatId]: at })
    // Keep the newest few hundred; anything older reads as seen anyway.
    if (entries.length > MAX_SEEN) entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN)
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Private mode: unread only lasts the visit.
  }
}

/** The chat on screen while the tab is visible, if any. */
export const viewingChat = () => useSeen.getState().viewing

export function setViewingChat(chatId: string | undefined) {
  if (useSeen.getState().viewing !== chatId) useSeen.setState({ viewing: chatId })
}

/**
 * Did this chat move since you last looked? `at` is its last activity (ms).
 * Mid-turn, only what came before the turn counts: the rest isn't said yet.
 */
export function useChatUnread(chatId: string | undefined, at: number | undefined) {
  const busy = !!useChatActivities()[chatId ?? '']
  return useSeen((s) => isUnread(s, chatId, busy ? restedAt(chatId) : at))
}

function isUnread(s: SeenStore, chatId: string | undefined, at: number | undefined) {
  if (!chatId || !at || s.viewing === chatId) return false
  const since = s.since[homeOf(chatId) ?? firstHermes() ?? ''] ?? s.since[firstHermes() ?? ''] ?? 0
  return at > (s.seen[chatId] ?? since) + SLACK
}

/** How many of these chats moved since you last looked (mid-turn, before the turn began). */
export function useUnreadCount(chats: { id: string; at: number }[]) {
  const busy = useChatActivities()
  const key = chats.map((c) => `${c.id}@${busy[c.id] ? (restedAt(c.id) ?? 0) : c.at}`).join('|')
  return useSeen((s) => key.split('|').filter((pair) => {
    if (!pair) return false
    const [id, at] = pair.split('@')
    return isUnread(s, id, Number(at))
  }).length)
}
