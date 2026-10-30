// Opening a search result at the message it was found in. Hermes's search
// names the chat and quotes the words around the match, but not which message
// holds them, so the chat's messages are read against that quote: the one
// holding the longest run of its words, the match among them, is the one.

import { create } from 'zustand'
import type { ChatItem } from '@/features/chat/types'
import { getChat, loadOlder } from '@/state/chats'
import type { SearchResult } from '@/state/search'

/** Where a result was found: Hermes's quote (the match marked >>>like this<<<), and who said it. */
export type Found = { snippet: string; role: 'user' | 'assistant' }

const useWanted = create<Record<string, Found | undefined>>(() => ({}))

/** On opening a result: its chat opens at the match. */
export function seek(result: SearchResult) {
  useWanted.setState({ [result.chatId]: result.found })
}

/** Where a chat was asked to open, until it has. */
export const useSeek = (chatId?: string) => useWanted((s) => (chatId ? s[chatId] : undefined))

export const doneSeeking = (chatId: string) => useWanted.setState({ [chatId]: undefined })

// ── Reading a message against the quote ────────────────────────────────────

type Needle = { words: string[]; marked: boolean[] }

const WORD = /[\p{L}\p{N}]+/gu
const wordsOf = (text: string) => text.toLowerCase().match(WORD) ?? []

/** The quote's words, each marked if it's part of the match. */
export function needleOf(snippet: string): Needle | undefined {
  const words: string[] = []
  const marked: boolean[] = []
  for (const part of snippet.split(/(>>>[\s\S]*?<<<)/)) {
    const match = part.startsWith('>>>') && part.endsWith('<<<')
    for (const word of wordsOf(match ? part.slice(3, -3) : part)) {
      words.push(word)
      marked.push(match)
    }
  }
  return marked.includes(true) ? { words, marked } : undefined
}

/** The words a result was found by, to mark in the message it opens at. */
export function matchOf(found: Found): string[] {
  const needle = needleOf(found.snippet)
  return needle ? [...new Set(needle.words.filter((_, i) => needle.marked[i]))] : []
}

/** The longest run of the quote's words, in order and with the match among them, that `text` holds. */
export function fit(needle: Needle, text: string): number {
  const hay = wordsOf(text)
  const at = new Map<string, number[]>()
  for (const [i, word] of hay.entries()) {
    const seen = at.get(word)
    if (seen) seen.push(i)
    else at.set(word, [i])
  }
  const { words, marked } = needle
  let best = 0
  for (let i = 0; i < words.length; i++) {
    for (const p of at.get(words[i]) ?? []) {
      // Counted from where a run starts, not again from inside it.
      if (i > 0 && p > 0 && hay[p - 1] === words[i - 1]) continue
      let n = 0
      let match = false
      for (; i + n < words.length && hay[p + n] === words[i + n]; n++) if (marked[i + n]) match = true
      if (match) best = Math.max(best, n)
    }
  }
  return best
}

/** What of a message the quote could come from: its words, and the files it carries by where they are. */
function textOf(item: ChatItem, role: Found['role']) {
  if (role === 'user' && item.kind === 'user')
    return [...(item.attachments ?? []).map((a) => a.path ?? a.name), item.text].join(' ')
  if (role === 'assistant' && item.kind === 'assistant') return item.text
}

// A run this long is the message, not a coincidence; a shorter one does when nothing holds more.
const SURE = 5
const ENOUGH = 3
/** How far back to read for it: pages of 500 rows. */
const PAGES = 20

type Best = { id: string; fit: number }

function search(chatId: string, needle: Needle, role: Found['role'], looked: Set<string>, best?: Best) {
  const keys = needle.words.filter((_, i) => needle.marked[i])
  // Newest first, so of two that hold as much, the newer one wins.
  for (const item of [...(getChat(chatId)?.items ?? [])].reverse()) {
    if (looked.has(item.id)) continue
    looked.add(item.id)
    const text = textOf(item, role)
    if (!text || !keys.some((k) => text.toLowerCase().includes(k))) continue
    const n = fit(needle, text)
    if (n > (best?.fit ?? 0)) best = { id: item.id, fit: n }
  }
  return best
}

const sure = (needle: Needle, best?: Best) => !!best && best.fit >= Math.min(needle.words.length, SURE)
const enough = (needle: Needle, best?: Best) => !!best && best.fit >= Math.min(needle.words.length, ENOUGH)

/**
 * The message, among what's been read of the chat: `id` once it's certain,
 * or once nothing older is left to read; `more` when older pages could hold it.
 */
export function findRead(chatId: string, found: Found): { id?: string; more: boolean } {
  const needle = needleOf(found.snippet)
  if (!needle) return { more: false }
  const best = search(chatId, needle, found.role, new Set())
  if (sure(needle, best)) return { id: best!.id, more: false }
  if (getChat(chatId)?.older) return { more: true }
  return { id: enough(needle, best) ? best!.id : undefined, more: false }
}

/** The message, reading back through the chat's older pages for it as far as it takes (within reason). */
export async function findOlder(chatId: string, found: Found): Promise<string | undefined> {
  const needle = needleOf(found.snippet)
  if (!needle) return
  const looked = new Set<string>()
  let best = search(chatId, needle, found.role, looked)
  for (let page = 0; !sure(needle, best) && getChat(chatId)?.older && page < PAGES; page++) {
    try {
      await loadOlder(chatId)
    } catch {
      break
    }
    best = search(chatId, needle, found.role, looked, best)
  }
  return enough(needle, best) ? best!.id : undefined
}
