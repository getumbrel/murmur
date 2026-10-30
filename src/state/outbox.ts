// Messages Hermes hasn't taken yet, kept in this browser by chat so a reload
// while it's away doesn't lose them: what never got there goes back in the box.

import { scoped } from '@/hermes/instance'

const KEY = scoped('murmur:outbox:')

export type Held = {
  id: string
  /** The words, as the bubble showed them. */
  text: string
  /** Names of its files, which can't be kept: they're asked for again. */
  files?: string[]
  /** The newest saved message when it was sent, so an older one with the same words isn't taken for it. */
  after?: number
}

export function held(chatId: string): Held[] {
  try {
    return JSON.parse(localStorage.getItem(KEY + chatId) ?? '[]') as Held[]
  } catch {
    return []
  }
}

function keep(chatId: string, messages: Held[]) {
  try {
    if (messages.length) localStorage.setItem(KEY + chatId, JSON.stringify(messages))
    else localStorage.removeItem(KEY + chatId)
  } catch {
    /* storage unavailable: nothing outlives the page */
  }
}

export function hold(chatId: string, message: Held) {
  keep(chatId, [...held(chatId).filter((m) => m.id !== message.id), message])
}

export function release(chatId: string, ids: string[]) {
  const now = held(chatId)
  const left = now.filter((m) => !ids.includes(m.id))
  if (left.length < now.length) keep(chatId, left)
}
