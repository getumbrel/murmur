// What a notification says. Pure, so it's easy to test (compose.test.ts).

import { proseOf } from '@/features/media/parse'
import { secretAskText } from '@/features/chat/secret-text'
import type { Chat } from '@/state/chats'
import type { GroupSummary } from '@/state/groups'
import type { ChatMoment } from '@/state/status'

export type Note = {
  title: string
  body: string
  /** One per chat, so a newer note replaces the one before it. */
  tag: string
  /** Where clicking it goes. */
  href: string
}

const LIMIT = 140

const clip = (text: string) => (text.length > LIMIT ? `${text.slice(0, LIMIT - 1).trimEnd()}…` : text)

/** A reply's first line, as plain words: no files, code, markdown or rules. */
export function firstLine(markdown: string) {
  const prose = proseOf(markdown).replace(/```[\s\S]*?(?:```|$)/g, '\n')
  for (const raw of prose.split('\n')) {
    const line = raw
      .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|__|~~|`/g, '')
      .replace(/(^|[\s(])[*_](\S(?:[^*_]*\S)?)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    // Table rules and horizontal rules say nothing.
    if (line && !/^[-*_=:\s]+$/.test(line)) return clip(line)
  }
  return ''
}

export const chatHref = (chat: Pick<Chat, 'id' | 'profile'>) =>
  `/chat/${encodeURIComponent(chat.profile)}/${encodeURIComponent(chat.id)}`

/**
 * An agent finished a reply, or needs the person: titled with the agent's
 * name. Nothing for a reply that was stopped or failed, which the person
 * either did themselves or will see when they look.
 */
export function chatNote({ kind, chat }: ChatMoment, name: string): Note | null {
  const base = { title: name, tag: `murmur:chat:${chat.id}`, href: chatHref(chat) }
  if (kind === 'needs-you') {
    const ask = chat.items.findLast(
      (i) => (i.kind === 'approval' || i.kind === 'clarify' || i.kind === 'secret') && i.status === 'pending',
    )
    const question = ask?.kind === 'clarify' ? clip(ask.questions[0]?.question?.trim() ?? '') : ''
    return { ...base, body: question || (ask?.kind === 'secret' ? secretAskText(ask) : 'Needs your OK') }
  }
  const tail = chat.items.at(-1)
  if (!tail || tail.kind === 'notice' || tail.kind === 'error') return null
  const asked = chat.items.findLastIndex((i) => i.kind === 'user')
  const reply = chat.items.slice(asked + 1).findLast((i) => i.kind === 'assistant')
  return { ...base, body: (reply?.kind === 'assistant' && firstLine(reply.text)) || 'Finished' }
}

/** A routine's run found something: titled with the routine, quoting what it found. */
export function runNote({ agentId, runId, routine, text }: { agentId: string; runId: string; routine: string; text: string }): Note | null {
  const body = firstLine(text)
  if (!body) return null
  return { title: routine, body, tag: `murmur:run:${runId}`, href: chatHref({ id: runId, profile: agentId }) }
}

/** A group's round ended with something new from its agents. */
export function groupNote(group: Pick<GroupSummary, 'id' | 'name' | 'lastLine'>): Note | null {
  if (!group.lastLine || group.lastLine.startsWith('You: ')) return null
  return {
    title: group.name,
    body: clip(group.lastLine),
    tag: `murmur:group:${group.id}`,
    href: `/group/${encodeURIComponent(group.id)}`,
  }
}
