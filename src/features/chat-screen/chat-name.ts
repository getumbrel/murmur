import { useEffect, useState } from 'react'
import { BOT_CHAT, MAIN_CHAT, readable, useAgentChats } from '@/state/agents'
import type { Chat } from '@/state/chats'
import { useRoutines, useRunOf } from '@/state/routines'
import { runTitle } from '@/features/routines/runs'

/** How long a chat started here waits for its proper title once the first reply is in. */
const TITLE_WAIT = 6000

const squash = (s: string) => s.split(/\s+/).join(' ').trim()

/** Hermes's stand-in title: your opening words, cut short with "…", until its model names the chat. */
const isOpening = (title: string, opening: string) => {
  const stem = squash(title).replace(/…$/, '')
  return !!stem && squash(opening).startsWith(stem)
}

/**
 * What a chat is called, the way its line in the lists says it: the title
 * Hermes gave it (or you did), or else what you first asked. A routine's run
 * goes by the routine's name. Empty until there's something to go on.
 *
 * A chat started here (`fresh`) stays a new chat until it's properly named,
 * so its name arrives once rather than as your opening words first.
 */
export function useChatName(agentId: string, id: string | undefined, chat: Chat | undefined, { fresh = false } = {}) {
  const run = useRunOf(agentId, id)
  const listed = useAgentChats(id && !run ? agentId : undefined).data?.find((c) => c.id === id)
  const routine = useRoutines(run ? agentId : undefined).data?.find((r) => r.id === run?.routineId)
  // Said live (a rename, or Hermes titling it as you watch), it's newer than the list.
  const live = chat?.title === BOT_CHAT ? MAIN_CHAT : readable(chat?.title, { files: false })
  const first = chat?.items.find((i) => i.kind === 'user')
  const opening = first?.kind === 'user' ? readable(first.text) : ''

  // If Hermes's model never names it, the stand-in will do, a moment after the first reply.
  const settled = chat?.status === 'idle' || chat?.status === 'error'
  const [waitedFor, setWaitedFor] = useState<string>()
  const waited = !!id && waitedFor === id
  useEffect(() => {
    if (!fresh || !id || !settled || waited) return
    const t = setTimeout(() => setWaitedFor(id), TITLE_WAIT)
    return () => clearTimeout(t)
  }, [fresh, id, settled, waited])

  if (!id) return ''
  if (run) return routine?.name ?? runTitle(chat?.title ?? '')
  if (fresh && !waited && (!live || isOpening(live, opening))) return 'New chat'
  // Until it's known not to be a run, a run's dated title could show.
  if (run === undefined) return ''
  return live || listed?.title || opening
}
