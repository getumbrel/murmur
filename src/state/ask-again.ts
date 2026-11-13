// Questions Murmur's server is keeping, to ask again when a model that hit
// its limit is back (server/ask-again.ts). The server holds them so they
// survive closed tabs and sleeping phones; here is only what it says it has,
// so every device shows the same thing on a chat's resting note.

import { create } from 'zustand'
import { HERMES_GONE, hermesOf, profileOf } from '@/hermes/instance'
import { SESSION_CHECK, hermesHeaders } from '@/hermes/rest'

type Held = { profile: string; chat: string; at: number; row?: number }

/** A kept question: when it'll be asked (ms), and which message it is (Hermes's row) when the server said. */
export type Kept = { at: number; row?: number }

/** Each chat's kept question, by chat id. */
export const useAskAgain = create<{ held: Record<string, Kept> }>(() => ({ held: {} }))

/** Whether the question kept for a chat is this message: a later one that stopped the same way isn't. */
export const isKept = (kept: Kept | undefined, row: number | undefined) => !!kept && (kept.row == null || kept.row === row)

async function murmur<T>(hermes: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
    headers: hermesHeaders(body ? { 'content-type': 'application/json' } : {}, hermes),
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null
  if (data?.error === 'hermes_gone') window.dispatchEvent(new Event(HERMES_GONE))
  if (res.status === 401 && data?.error === 'signed_out') window.dispatchEvent(new Event(SESSION_CHECK))
  if (!res.ok) throw new Error('ask-again')
  return data as T
}

/**
 * How many times each chat's question was kept or let go from here. What the
 * server said it had before one of those began, or while it was on its way,
 * is older than what's shown: a look that crosses one leaves that chat alone.
 */
const changes = new Map<string, number>()
const unsettled = new Set<string>()
async function settling<T>(chat: string, change: () => Promise<T>) {
  changes.set(chat, (changes.get(chat) ?? 0) + 1)
  unsettled.add(chat)
  try {
    return await change()
  } finally {
    changes.set(chat, (changes.get(chat) ?? 0) + 1)
    unsettled.delete(chat)
  }
}

/** What the server is keeping for the Hermes an agent lives on. A blip leaves what's shown as it is. */
export async function refreshAskAgain(agentId: string, chats: string[]) {
  const before = new Map(chats.map((chat) => [chat, changes.get(chat) ?? 0]))
  try {
    const { held } = await murmur<{ held: Held[] }>(hermesOf(agentId), 'GET', '/murmur/ask-again')
    const now: Record<string, Kept> = Object.fromEntries(held.map((h) => [h.chat, { at: h.at, row: h.row }]))
    // Only these chats are known to be on that Hermes: the rest stay as they were.
    useAskAgain.setState((s) => {
      const next = { ...s.held }
      for (const chat of chats) {
        if (unsettled.has(chat) || (changes.get(chat) ?? 0) !== before.get(chat)) continue
        if (now[chat]) next[chat] = now[chat]
        else delete next[chat]
      }
      return { held: next }
    })
  } catch {
    // The next look will tell.
  }
}

/** Keep this chat's last question, to ask again once the limit lifts at `at`. Throws when the server didn't take it. */
export async function askAgainAt(agentId: string, chat: string, at: number, row?: number) {
  useAskAgain.setState((s) => ({ held: { ...s.held, [chat]: { at, row } } }))
  await settling(chat, async () => {
    try {
      await murmur(hermesOf(agentId), 'POST', '/murmur/ask-again', { profile: profileOf(agentId), chat, at })
    } catch (error) {
      forget(chat)
      throw error
    }
  })
}

/** Don't ask again after all. */
export async function dontAskAgain(agentId: string, chat: string) {
  const was = useAskAgain.getState().held[chat]
  if (!was) return
  forget(chat)
  await settling(chat, async () => {
    try {
      await murmur(hermesOf(agentId), 'POST', '/murmur/ask-again/cancel', { chat })
    } catch (error) {
      useAskAgain.setState((s) => ({ held: { ...s.held, [chat]: was } }))
      throw error
    }
  })
}

function forget(chat: string) {
  useAskAgain.setState((s) => {
    const { [chat]: _, ...held } = s.held
    return { held }
  })
}
