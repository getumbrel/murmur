import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/hermes/rest'
import { useAgentChats, useAgents, type Agent, type ChatSummary } from '@/state/agents'
import { replaceGone } from '@/lib/transitions'
import { routineRunsKey, useRoutineRuns } from '@/state/routines'
import { deleteChat } from '@/state/chats'

// One agent's chats as people think of them: its conversations, most recently
// active first, with what its routines wrote slotted in among them and labelled.

export type AgentChat = ChatSummary & {
  routine?: boolean
  /** When it last moved, or when it began where Hermes doesn't say. */
  at: number
}

/**
 * Hermes's chat list is in order of last activity but only says when each
 * began; its REST listing says when each last moved. Hidden chats (the main
 * one) aren't in it, so that time comes from the agent. Ids are the same rows.
 */
async function fetchActivity(profile: string): Promise<Record<string, number>> {
  const res = await api.get<{ sessions?: { id: string; last_active?: number }[] }>(
    `/api/sessions?profile=${encodeURIComponent(profile)}&limit=60&order=recent`,
  )
  return Object.fromEntries((res.sessions ?? []).filter((s) => s.last_active).map((s) => [s.id, s.last_active! * 1000]))
}

/** A routine's result goes in front of the first conversation that last moved before it ran. */
function merge(conversations: AgentChat[], runs: AgentChat[]): AgentChat[] {
  const out: AgentChat[] = []
  let r = 0
  for (const c of conversations) {
    while (r < runs.length && runs[r].at >= c.at) out.push(runs[r++])
    out.push(c)
  }
  return [...out, ...runs.slice(r)]
}

/** Takes the agent, or just its id (its main chat's time then comes from the roster). */
export function useAgentChatList(of: Agent | string | undefined) {
  const agentId = typeof of === 'string' ? of : of?.id
  const roster = useAgents().data
  const conversations = useAgentChats(agentId)
  const runs = useRoutineRuns(agentId)
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
    const results: AgentChat[] = (runs.data ?? [])
      .map((r) => ({
        id: r.id,
        title: r.routineName,
        preview: '',
        startedAt: r.at,
        at: r.at,
        messageCount: r.messageCount,
        source: 'routine',
        routine: true,
      }))
      .sort((a, b) => b.at - a.at)
    return merge(chats, results)
  }, [conversations.data, runs.data, activity.data, mainAt])
  return { data, isPending: conversations.isPending, isError: conversations.isError, refetch: conversations.refetch }
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
