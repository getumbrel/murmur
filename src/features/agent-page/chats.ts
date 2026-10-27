import { useMemo } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { create } from 'zustand'
import { api } from '@/hermes/rest'
import { toSummary, useAgentChats, useAgents, type Agent, type ChatSummary, type SessionRow } from '@/state/agents'
import { replaceGone } from '@/lib/transitions'
import { routineRunsKey, useContinuedRuns, useRoutineNews, type RoutineRun } from '@/state/routines'
import { deleteChat, updateChat, type ChatChange } from '@/state/chats'
import { useChatUnread } from '@/state/status'
import { resultLine, standingResults } from '@shared/routines.ts'

// One agent's chats as people think of them, most recently active first: its
// conversations, and a line for each routine that has found something, its
// newest result (what Home's row shows, one tap away). A busy routine is still
// one line; its other runs stay with it, and quiet ones never show. A run
// you've replied in is a chat of its own, labelled. Pinned chats come along
// even when they're older than the list's window; archived ones wait in their
// own list. Pins and archives are Hermes's own, so Hermes Desktop agrees.

export type AgentChat = ChatSummary & {
  /** A routine's run: its newest result, or one you've replied in. */
  routine?: boolean
  /** A routine's newest result (its line among the chats), with what it found as the preview. */
  result?: boolean
  /** When it last moved, or when it began where Hermes doesn't say. */
  at: number
  /** Kept at the top of its agent's chats, under the main chat. */
  pinned?: boolean
  /** Out of the list and in Archived: search still finds it, and the agent still remembers it. */
  archived?: boolean
}

type Row = SessionRow & { last_active?: number; pinned?: boolean; archived?: boolean; hidden?: boolean | number }

type Activity = {
  /** When each chat last moved. */
  at: Record<string, number>
  /** The pinned chats, older ones too: Hermes adds any pin the window missed. */
  pinned: AgentChat[]
  /** This Hermes keeps pins and archives (it says so on every row). */
  filing: boolean
}

const listed = (r: Row): AgentChat => ({ ...toSummary(r), at: (r.last_active ?? r.started_at ?? 0) * 1000 })
const said = (r: Row) => (r.message_count ?? 0) > 0

/**
 * Hermes's chat list is in order of last activity but only says when each
 * began; its REST listing says when each last moved, and which are pinned.
 * Hidden chats (the main one) aren't in it, so that time comes from the agent.
 * Ids are the same rows. Routine runs are left out, so a busy routine can't
 * crowd the window.
 */
async function fetchActivity(profile: string): Promise<Activity> {
  const res = await api.get<{ sessions?: Row[] }>(
    `/api/sessions?profile=${encodeURIComponent(profile)}&limit=60&order=recent&exclude_sources=cron`,
  )
  const rows = res.sessions ?? []
  return {
    at: Object.fromEntries(rows.filter((s) => s.last_active).map((s) => [s.id, s.last_active! * 1000])),
    pinned: rows
      .filter((s) => s.pinned === true && s.archived !== true && said(s))
      .map((s) => ({ ...listed(s), pinned: true })),
    filing: rows.some((s) => typeof s.pinned === 'boolean'),
  }
}

const activityKey = (agentId: string) => ['chats', agentId, 'activity'] as const
const archivedKey = (agentId: string) => ['chats', agentId, 'archived'] as const

/** A routine's line goes in front of the first conversation that last moved before it did. */
function merge(conversations: AgentChat[], runs: AgentChat[]): AgentChat[] {
  const out: AgentChat[] = []
  let r = 0
  for (const c of conversations) {
    while (r < runs.length && runs[r].at >= c.at) out.push(runs[r++])
    out.push(c)
  }
  return [...out, ...runs.slice(r)]
}

/**
 * Takes the agent, or just its id (its main chat's time then comes from the
 * roster). `results: false` leaves the routines' results out, for a page that
 * shows them with the routines.
 */
export function useAgentChatList(of: Agent | string | undefined, { results = true } = {}) {
  const agentId = typeof of === 'string' ? of : of?.id
  const roster = useAgents().data
  const conversations = useAgentChats(agentId)
  const runs = useContinuedRuns(agentId)
  const news = useRoutineNews(results ? agentId : undefined)
  // Under ['chats', id], so whatever refreshes the list refreshes this too.
  const activity = useQuery({
    queryKey: activityKey(agentId ?? ''),
    enabled: Boolean(agentId),
    queryFn: () => fetchActivity(agentId!),
    staleTime: 10_000,
  })
  const gone = useGone((s) => s.ids)
  const mainAt = (typeof of === 'string' ? roster?.find((a) => a.id === of) : of)?.mainChatAt
  const data = useMemo(() => {
    if (!conversations.data) return undefined
    const seen = activity.data?.at ?? {}
    const pins = activity.data?.pinned ?? []
    const pinned = new Set(pins.map((c) => c.id))
    const chats: AgentChat[] = conversations.data.map((c) => ({
      ...c,
      at: (c.main ? mainAt : seen[c.id]) || c.startedAt,
      ...(pinned.has(c.id) && { pinned: true }),
    }))
    // Pins older than the window, where they'd have been. (With every chat's last move known,
    // that's the list's own order, so one moved back from Archived lands in its place too.)
    for (const pin of pins) if (!chats.some((c) => c.id === pin.id)) chats.push(pin)
    if (activity.data) chats.sort((a, b) => b.at - a.at)
    const line = (run: RoutineRun, found?: string): AgentChat => ({
      id: run.id,
      title: run.routineName,
      preview: found ? resultLine(found) : '',
      startedAt: run.at,
      at: run.lastAt,
      messageCount: run.messageCount,
      source: 'routine',
      routine: true,
      result: found !== undefined,
    })
    const continued = runs.data ?? []
    const newest = (news.data ?? []).flatMap((n) => (n.latest ? [n.latest] : []))
    const standing = new Set(standingResults(newest.map((n) => n.run), continued))
    const lines = [
      ...continued.map((run) => line(run)),
      ...newest.filter((n) => standing.has(n.run)).map((n) => line(n.run, n.text)),
    ].sort((a, b) => b.at - a.at)
    // A chat just deleted stays gone while its Undo is offered.
    return merge(chats, lines).filter((c) => !gone.has(c.id))
  }, [conversations.data, runs.data, news.data, activity.data, mainAt, gone])
  // The first time, wait for the routines too, so their lines don't push the chats down a beat later.
  const waiting = results && !news.data && news.isPending
  return {
    data: waiting ? undefined : data,
    isPending: conversations.isPending || waiting,
    isError: conversations.isError,
    refetch: conversations.refetch,
    /** Whether chats can be pinned and archived here. */
    filing: activity.data?.filing ?? false,
  }
}

/** The agent's archived chats, newest first. */
export function useArchivedChats(agentId: string | undefined) {
  const gone = useGone((s) => s.ids)
  const query = useQuery({
    queryKey: archivedKey(agentId ?? ''),
    enabled: Boolean(agentId),
    staleTime: 10_000,
    queryFn: async () => {
      const res = await api.get<{ sessions?: Row[] }>(
        `/api/sessions?profile=${encodeURIComponent(agentId!)}&archived=only&limit=100&order=recent&exclude_sources=cron`,
      )
      // Only what Hermes says is archived (one that predates archiving would list everything),
      // and none of the hidden ones: the main chat and groups' plumbing are never in a list.
      return (res.sessions ?? [])
        .filter((s) => s.archived === true && !s.hidden && said(s))
        .map((s): AgentChat => ({ ...listed(s), archived: true }))
    },
  })
  const data = useMemo(() => query.data?.filter((c) => !gone.has(c.id)), [query.data, gone])
  return { ...query, data }
}

/**
 * Is this chat in the list new to you? Hermes only says when an agent's newest
 * conversation last moved, so that's the one that can be; a routine's result
 * knows its own time.
 */
export function useUnread(agent: Agent, chat: AgentChat) {
  const known = chat.result || agent.lastChat?.id === chat.id
  return useChatUnread(known ? chat.id : undefined, chat.result ? chat.at : agent.lastChat?.at)
}

// ── What you can do to a chat ────────────────────────────────────────────────

/** How long Undo is offered after a delete, before it's for good. */
const UNDO_MS = 5000

/** Chats deleted a moment ago: out of every list while their Undo is offered. */
const useGone = create<{ ids: ReadonlySet<string> }>(() => ({ ids: new Set() }))
const setGone = (id: string, on: boolean) =>
  useGone.setState(({ ids }) => {
    const next = new Set(ids)
    if (on) next.add(id)
    else next.delete(id)
    return { ids: next }
  })

/** Deletes waiting out their Undo, by chat id. Leaving the page makes them final straight away. */
const waiting = new Map<string, () => void>()
let flushing = false
function flushOnLeave() {
  if (flushing || typeof window === 'undefined') return
  flushing = true
  const flush = () => [...waiting.values()].forEach((commit) => commit())
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
}

/** One change at a time per chat, so an Undo can't overtake what it undoes. */
const lanes = new Map<string, Promise<unknown>>()
function inLane<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (lanes.get(id) ?? Promise.resolve()).catch(() => {}).then(fn)
  lanes.set(id, next)
  return next
}

/**
 * Pin, rename, archive and delete an agent's chats. Each shows at once in
 * every list of them and settles with Hermes behind; Archive and Delete offer
 * Undo, and Delete is only for good once its Undo has gone.
 */
export function useChatActions(agentId: string) {
  const qc = useQueryClient()
  const list = ['chats', agentId] as const
  const settle = () =>
    Promise.all([qc.invalidateQueries({ queryKey: list }), qc.invalidateQueries({ queryKey: ['agents'] })])
  const lane = (chat: AgentChat, fn: () => Promise<void>) => inLane(chat.id, fn)
  const change = (chat: AgentChat, c: ChatChange) => updateChat(chat.id, agentId, c)
  /** Where to go from a chat that's leaving the list: the agent's main chat, or Home. */
  const away = (chat: AgentChat) => {
    const main = qc.getQueryData<ChatSummary[]>(list)?.find((c) => c.main && c.id !== chat.id)
    return main ? `/chat/${agentId}/${main.id}` : '/'
  }

  const pin = (chat: AgentChat, on = !chat.pinned) =>
    lane(chat, async () => {
      const undo = snapshot(qc, agentId)
      qc.setQueryData<Activity>(
        activityKey(agentId),
        (a) =>
          a && {
            ...a,
            pinned: [...(on ? [{ ...chat, pinned: true }] : []), ...a.pinned.filter((p) => p.id !== chat.id)],
          },
      )
      try {
        await change(chat, { pinned: on })
      } catch {
        undo()
        toast.error(on ? 'Couldn’t pin that chat. Try again.' : 'Couldn’t unpin that chat. Try again.')
      }
    })

  /** Archiving a pinned chat unpins it: out of the way and kept at the top can't both be. */
  const archive = (chat: AgentChat) =>
    lane(chat, async () => {
      const undo = snapshot(qc, agentId)
      qc.setQueryData<ChatSummary[]>(list, (l) => l?.filter((c) => c.id !== chat.id))
      qc.setQueryData<Activity>(
        activityKey(agentId),
        (a) => a && { ...a, pinned: a.pinned.filter((p) => p.id !== chat.id) },
      )
      qc.setQueryData<AgentChat[]>(archivedKey(agentId), (l) => [
        { ...chat, pinned: undefined, archived: true },
        ...(l ?? []).filter((c) => c.id !== chat.id),
      ])
      const id = `archived-${chat.id}`
      toast('Chat archived', { id, action: { label: 'Undo', onClick: () => void unarchive(chat, chat.pinned) } })
      try {
        await change(chat, { archived: true, ...(chat.pinned && { pinned: false }) })
      } catch {
        undo()
        toast.error('Couldn’t archive that chat. Try again.', { id })
      }
      void settle()
    })

  /** Back among the chats, where it was; `repin` puts back a pin that archiving took. */
  const unarchive = (chat: AgentChat, repin?: boolean) =>
    lane(chat, async () => {
      const undo = snapshot(qc, agentId)
      const back: AgentChat = { ...chat, archived: undefined, pinned: repin || undefined }
      qc.setQueryData<AgentChat[]>(archivedKey(agentId), (l) => l?.filter((c) => c.id !== chat.id))
      qc.setQueryData<ChatSummary[]>(list, (l) => l && [back, ...l.filter((c) => c.id !== chat.id)])
      qc.setQueryData<Activity>(
        activityKey(agentId),
        (a) => a && { ...a, at: { ...a.at, [chat.id]: chat.at }, pinned: repin ? [back, ...a.pinned] : a.pinned },
      )
      try {
        await change(chat, { archived: false, ...(repin && { pinned: true }) })
      } catch {
        undo()
        toast.error('Couldn’t move that chat back. Try again.')
      }
      void settle()
    })

  /** Throws `titleTaken` for a name another of the agent's chats has, for the sheet to say so. */
  const rename = (chat: AgentChat, title: string) =>
    lane(chat, async () => {
      await change(chat, { title })
      const named = <T extends ChatSummary>(c: T) => (c.id === chat.id ? { ...c, title } : c)
      qc.setQueryData<ChatSummary[]>(list, (l) => l?.map(named))
      qc.setQueryData<AgentChat[]>(archivedKey(agentId), (l) => l?.map(named))
      qc.setQueryData<Activity>(activityKey(agentId), (a) => a && { ...a, pinned: a.pinned.map(named) })
      void settle()
    })

  const remove = (chat: AgentChat) => {
    flushOnLeave()
    setGone(chat.id, true)
    const id = `deleted-${chat.id}`
    let timer: ReturnType<typeof setTimeout>
    const commit = () => {
      clearTimeout(timer)
      if (waiting.get(chat.id) !== commit) return
      waiting.delete(chat.id)
      toast.dismiss(id)
      void lane(chat, async () => {
        try {
          await deleteChat(chat.id, agentId)
        } catch {
          setGone(chat.id, false)
          toast.error('Couldn’t delete that chat. Try again.')
          return
        }
        // If it's the chat you came here from, Back goes to the main chat (or Home) instead.
        const to = away(chat)
        for (const path of new Set([
          `/chat/${agentId}/${chat.id}`,
          `/chat/${encodeURIComponent(agentId)}/${encodeURIComponent(chat.id)}`,
        ]))
          replaceGone(path, to)
        await Promise.all([
          settle(),
          chat.routine ? qc.invalidateQueries({ queryKey: routineRunsKey(agentId) }) : undefined,
        ])
        setGone(chat.id, false)
      })
    }
    const restore = () => {
      clearTimeout(timer)
      if (waiting.get(chat.id) !== commit) return
      waiting.delete(chat.id)
      setGone(chat.id, false)
    }
    waiting.set(chat.id, commit)
    timer = setTimeout(commit, UNDO_MS)
    toast('Chat deleted', { id, duration: UNDO_MS, action: { label: 'Undo', onClick: restore } })
  }

  return { pin, archive, unarchive, rename, remove, away }
}

/** The lists as they are, to put back if Hermes says no. */
function snapshot(qc: QueryClient, agentId: string) {
  const keys = [['chats', agentId], activityKey(agentId), archivedKey(agentId)] as const
  const was = keys.map((key) => qc.getQueryData(key))
  return () => keys.forEach((key, i) => qc.setQueryData(key, was[i]))
}

export type ChatActions = ReturnType<typeof useChatActions>
