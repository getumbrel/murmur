import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/hermes/rest'
import { useAgentChats, useAgents, type Agent, type ChatSummary } from '@/state/agents'
import { replaceGone } from '@/lib/transitions'
import { routineRunsKey, useContinuedRuns, useRoutineNews, type RoutineRun } from '@/state/routines'
import { deleteChat } from '@/state/chats'
import { useChatUnread } from '@/state/status'
import { resultLine, standingResults } from '@/features/routines/runs'

// One agent's chats as people think of them, most recently active first: its
// conversations, and a line for each routine that has found something, its
// newest result (what Home's row shows, one tap away). A busy routine is still
// one line; its other runs stay with it, and quiet ones never show. A run
// you've replied in is a chat of its own, labelled.

export type AgentChat = ChatSummary & {
  /** A routine's run: its newest result, or one you've replied in. */
  routine?: boolean
  /** A routine's newest result (its line among the chats), with what it found as the preview. */
  result?: boolean
  /** When it last moved, or when it began where Hermes doesn't say. */
  at: number
}

/**
 * Hermes's chat list is in order of last activity but only says when each
 * began; its REST listing says when each last moved. Hidden chats (the main
 * one) aren't in it, so that time comes from the agent. Ids are the same rows.
 * Routine runs are left out, so a busy routine can't crowd the window.
 */
async function fetchActivity(profile: string): Promise<Record<string, number>> {
  const res = await api.get<{ sessions?: { id: string; last_active?: number }[] }>(
    `/api/sessions?profile=${encodeURIComponent(profile)}&limit=60&order=recent&exclude_sources=cron`,
  )
  return Object.fromEntries((res.sessions ?? []).filter((s) => s.last_active).map((s) => [s.id, s.last_active! * 1000]))
}

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
    queryKey: ['chats', agentId, 'activity'],
    enabled: Boolean(agentId),
    queryFn: () => fetchActivity(agentId!),
    staleTime: 10_000,
  })
  const mainAt = (typeof of === 'string' ? roster?.find((a) => a.id === of) : of)?.mainChatAt
  const data = useMemo(() => {
    if (!conversations.data) return undefined
    const seen = activity.data ?? {}
    const chats: AgentChat[] = conversations.data.map((c) => ({
      ...c,
      at: (c.main ? mainAt : seen[c.id]) || c.startedAt,
    }))
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
    return merge(chats, lines)
  }, [conversations.data, runs.data, news.data, activity.data, mainAt])
  // The first time, wait for the routines too, so their lines don't push the chats down a beat later.
  const waiting = results && !news.data && news.isPending
  return {
    data: waiting ? undefined : data,
    isPending: conversations.isPending || waiting,
    isError: conversations.isError,
    refetch: conversations.refetch,
  }
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

/** Delete one of an agent's chats and let every list of them know. */
export function useDeleteChat(agentId: string) {
  const qc = useQueryClient()
  return async (chat: AgentChat) => {
    await deleteChat(chat.id, agentId)
    // If it's the chat you came here from, Back goes to the main chat (or Home) instead.
    const main = qc.getQueryData<ChatSummary[]>(['chats', agentId])?.find((c) => c.main && c.id !== chat.id)
    const to = main ? `/chat/${agentId}/${main.id}` : '/'
    for (const path of new Set([`/chat/${agentId}/${chat.id}`, `/chat/${encodeURIComponent(agentId)}/${encodeURIComponent(chat.id)}`]))
      replaceGone(path, to)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['chats', agentId] }),
      chat.routine ? qc.invalidateQueries({ queryKey: routineRunsKey(agentId) }) : undefined,
      qc.invalidateQueries({ queryKey: ['agents'] }),
    ])
  }
}
