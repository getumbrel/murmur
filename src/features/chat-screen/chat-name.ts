import { BOT_CHAT, MAIN_CHAT, readable, useAgentChats } from '@/state/agents'
import type { Chat } from '@/state/chats'
import { useRoutines } from '@/state/routines'
import { isRunId, routineIdOf, runTitle } from '@/features/routines/runs'

/**
 * What a chat is called, the way its line in the lists says it: the title
 * Hermes gave it (or you did), or else what you first asked. A routine's run
 * goes by the routine's name. Empty until there's something to go on.
 */
export function useChatName(agentId: string, id: string | undefined, chat: Chat | undefined) {
  const run = isRunId(id)
  const listed = useAgentChats(id && !run ? agentId : undefined).data?.find((c) => c.id === id)
  const routine = useRoutines(run ? agentId : undefined).data?.find((r) => r.id === routineIdOf(id!))
  if (!id) return ''
  if (run) return routine?.name ?? runTitle(chat?.title ?? '')
  // Said live (a rename, or Hermes titling it as you watch), it's newer than the list.
  const live = chat?.title === BOT_CHAT ? MAIN_CHAT : readable(chat?.title, { files: false })
  if (live) return live
  if (listed) return listed.title
  const first = chat?.items.find((i) => i.kind === 'user')
  return first?.kind === 'user' ? readable(first.text) : ''
}
