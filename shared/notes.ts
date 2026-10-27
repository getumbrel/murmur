// What a notification says. Murmur's server notices what agents do and tells
// the person's devices (server/watch.ts); the wording lives here, pure, so it
// reads the same everywhere and is easy to test (notes.test.ts).

import { proseOf } from './message.ts'

export type Note = {
  title: string
  body: string
  /** One per chat or group, so a newer note replaces the one before it. */
  tag: string
  /** Where clicking it goes. */
  href: string
}

/** Lines a phone shows whole, and a push carries easily (a routine's title can be its whole prompt). */
const LIMIT = { title: 60, body: 140 }

export const clip = (text: string, limit = LIMIT.body) => (text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text)
const title = (text: string) => clip(text.replace(/\s+/g, ' ').trim(), LIMIT.title)

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

// ── Where a note goes ───────────────────────────────────────────────────────

/** A chat's tag, which is also how a tab says it's looking at that chat. A routine's run is a chat too. */
export const chatTag = (chatId: string) => `murmur:chat:${chatId}`
export const groupTag = (groupId: string) => `murmur:group:${groupId}`

export const chatHref = (chat: { id: string; profile: string }) =>
  `/chat/${encodeURIComponent(chat.profile)}/${encodeURIComponent(chat.id)}`
export const groupHref = (groupId: string) => `/group/${encodeURIComponent(groupId)}`

// ── Replies ─────────────────────────────────────────────────────────────────

/** A message as Hermes stores it. */
export type StoredMessage = { role?: string | null; content?: string | null }

/**
 * An agent finished replying in a chat: titled with its name, quoting the
 * reply's first line. Nothing when it never answered the last message (it was
 * stopped, or failed), which the person either did themselves or will see.
 * `messages` are oldest first.
 */
export function replyNote(name: string, chat: { id: string; profile: string }, messages: StoredMessage[]): Note | null {
  const asked = messages.findLastIndex((m) => m.role === 'user')
  const answer = messages.slice(asked + 1).filter((m) => m.role === 'assistant')
  if (!answer.length) return null
  const said = answer.findLast((m) => m.content?.trim())?.content ?? ''
  return { title: title(name), body: firstLine(said) || 'Finished', tag: chatTag(chat.id), href: chatHref(chat) }
}

// ── Asks ────────────────────────────────────────────────────────────────────

export type SecretAsk = 'login' | 'code' | 'key'

/** One line for a masked ask, where the card itself isn't shown: a notification, the agent's status. */
export function secretAskText(item: { ask: SecretAsk; site?: string; skill?: string }) {
  switch (item.ask) {
    case 'login':
      return item.site ? `Needs your login for ${item.site}` : 'Needs a login'
    case 'code':
      return item.site ? `Needs a code for ${item.site}` : 'Needs a sign-in code'
    case 'key':
      return item.skill ? `Needs a key for ${item.skill}` : 'Needs a key'
  }
}

/** Hermes's masked asks, by the method it asks with. */
export const SECRET_ASKS: Record<string, SecretAsk> = { 'vault.save_login': 'login', 'vault.code': 'code', secret: 'key' }

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const record = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/**
 * What Hermes is asking, in a line: a question, an OK, a login. Undefined for
 * requests Murmur can't answer (a terminal read, a theme pick), which aren't
 * the person's to be told about.
 */
export function askText(method: string, params: Record<string, unknown>): string | undefined {
  if (method === 'approval') return 'Needs your OK'
  if (method === 'clarify') {
    const first = Array.isArray(params.questions) ? record(params.questions[0]).question : params.question
    return clip(text(first) ?? '') || 'Has a question for you'
  }
  const ask = SECRET_ASKS[method]
  if (!ask) return undefined
  return secretAskText({ ask, site: text(params.site), skill: text(record(params.metadata).skill_name) })
}

/** An agent needs the person in a chat. */
export function askNote(name: string, chat: { id: string; profile: string }, ask: string): Note {
  return { title: title(name), body: ask, tag: chatTag(chat.id), href: chatHref(chat) }
}

// ── Routines and groups ─────────────────────────────────────────────────────

/** A routine's run found something: titled with the routine, quoting what it found. */
export function runNote({ agentId, runId, routine, text }: { agentId: string; runId: string; routine: string; text: string }): Note | null {
  const body = firstLine(text)
  if (!body) return null
  return { title: title(routine), body, tag: chatTag(runId), href: chatHref({ id: runId, profile: agentId }) }
}

/** A group's round ended with something new from its agents. */
export function groupNote(group: { id: string; name: string; lastLine: string }): Note | null {
  if (!group.lastLine || group.lastLine.startsWith('You: ')) return null
  return { title: title(group.name), body: clip(group.lastLine), tag: groupTag(group.id), href: groupHref(group.id) }
}

/** One of a group's agents needs the person's OK. */
export function groupAskNote(group: { id: string; name: string }, who: string): Note {
  return { title: title(group.name), body: `${who} needs your OK`, tag: groupTag(group.id), href: groupHref(group.id) }
}
