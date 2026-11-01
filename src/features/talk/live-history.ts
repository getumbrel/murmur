// What a live voice is told of the chat it's picking up. It starts with nothing of its own: Hermes
// has the whole chat for what's handed to it, but small talk and "what were we saying?" never
// reach Hermes, so the session is started with the chat's recent words. Text only, because that's
// all a live session takes: what was said, not the tools behind it or anything meant for the model.

import { splitMessage } from '@shared/message.ts'
import type { ChatItem } from '@/features/chat/types'

export type LiveMessage = {
  type: 'message'
  role: 'developer' | 'user' | 'assistant'
  content: [{ type: 'input_text' | 'output_text'; text: string }]
}

/** For the voice to know, ahead of what was said. It's never spoken or saved. */
export const developerMessage = (text: string): LiveMessage => ({
  type: 'message',
  role: 'developer',
  content: [{ type: 'input_text', text }],
})

const CONTINUING = developerMessage(
  'This call carries on the chat below, which you are already having with this person. ' +
    'Talk as someone who remembers it, and answer anything about what was said yourself, without going to the backend.',
)

/** About 20 turns: a live session has a small window, and takes 128 messages and 8,192 tokens at most. */
const MAX_MESSAGES = 40
const MAX_TOKENS = 4_000
/** One long answer shouldn't push out everything before it. */
const MAX_MESSAGE_TOKENS = 600

/** Near enough, and on the safe side: about four letters a token, and a token each for anything else. */
const tokens = (text: string) => {
  const ascii = text.replace(/[^\x00-\x7f]/gu, '').length
  return Math.ceil(ascii / 4) + [...text].length - ascii
}

const clipped = (text: string, most: number) => {
  if (tokens(text) <= most) return text
  const out: string[] = []
  let used = 0
  for (const word of text.split(/(?<=\s)/)) {
    used += tokens(word)
    if (used > most) break
    out.push(word)
  }
  return `${out.join('').trimEnd()}…`
}

/** What was said, the way it reads aloud: no code, no files or widgets. */
const words = (item: ChatItem) => {
  if (item.kind === 'user') return item.text.trim()
  if (item.kind !== 'assistant' || item.streaming) return ''
  const prose = splitMessage(item.text).flatMap((s) => (s.kind === 'md' ? [s.text] : []))
  return prose.join('\n').replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

/** The end of a chat as a live session's opening history, oldest first. */
export function liveHistory(items: ChatItem[]) {
  const said: LiveMessage[] = []
  let left = MAX_TOKENS
  for (const item of [...items].reverse()) {
    if (said.length === MAX_MESSAGES) break
    const text = words(item)
    if (!text) continue
    const kept = clipped(text, Math.min(MAX_MESSAGE_TOKENS, left))
    if (kept === '…') break
    left -= tokens(kept)
    const user = item.kind === 'user'
    said.push({ type: 'message', role: user ? 'user' : 'assistant', content: [{ type: user ? 'input_text' : 'output_text', text: kept }] })
    if (left <= 0) break
  }
  return said.length ? [CONTINUING, ...said.reverse()] : said
}
