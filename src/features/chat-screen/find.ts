import type { ChatItem } from '@/features/chat/types'
import { proseOf } from '@shared/message.ts'

// Find in a chat: where the words you typed are, among everything said in it.
// A long chat only draws the messages near where you are, so the chat itself
// is read for them (every message, drawn or not), and the page only for the
// ones on screen, where each place is marked.

/**
 * Text as Find reads it: lower case, without accents, every space and quote
 * the plain kind. `at[i]` is where its i-th character came from in `text`,
 * so a match found here can be marked there.
 */
export function fold(text: string): { text: string; at: number[] | null } {
  // Plain English is itself, character for character.
  if (!/[^\t\n\r\x20-\x7e]/.test(text)) return { text: text.toLowerCase().replace(/[\t\n\r]/g, ' '), at: null }
  let out = ''
  const at: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const plain =
      c < '\x7f'
        ? c < ' '
          ? ' '
          : c.toLowerCase()
        : /\s/.test(c)
          ? ' '
          : (QUOTES[c] ?? c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase())
    for (let j = 0; j < plain.length; j++) at.push(i)
    out += plain
  }
  return { text: out, at }
}

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"' }

/** What you typed, as Find looks for it; empty when there's nothing to look for. */
export const needle = (query: string) => fold(query.trim().replace(/\s+/g, ' ')).text

/** Where `needle` is in `text`: each place's start and end, in `text`'s own characters. */
export function placesIn(text: string, needle: string): [start: number, end: number][] {
  if (!needle) return []
  const hay = fold(text)
  const out: [number, number][] = []
  for (let i = hay.text.indexOf(needle); i >= 0; i = hay.text.indexOf(needle, i + needle.length)) {
    const last = i + needle.length - 1
    if (!hay.at) {
      out.push([i, last + 1])
      continue
    }
    // (An accent written as a mark of its own goes with its letter.)
    let end = hay.at[last] + 1
    while (end < text.length && /\p{M}/u.test(text[end])) end++
    out.push([hay.at[i], end])
  }
  return out
}

/** A reply's words about as they read on screen: its markdown's marks gone, its code kept. */
const shown = (markdown: string) =>
  proseOf(markdown)
    // A code block's fences, and the language named on them.
    .replace(/^[^\S\n]*(?:```|~~~).*$/gm, '')
    // Links and pictures: their words.
    .replace(/!?\[([^\]\n]*)\]\([^)\s]+\)/g, '$1')
    // Headings and quotes, where a line starts.
    .replace(/^[^\S\n]*(?:#{1,6}|>)[^\S\n]+/gm, '')
    // Bold, struck and code: what they wrap.
    .replace(/\*\*|~~|`+/g, '')

/** What a message says, for Find; nothing for what isn't a message. */
export function saidIn(item: ChatItem): string | undefined {
  if (item.kind === 'user') return [...(item.attachments ?? []).map((a) => a.name), item.text].join('\n')
  if (item.kind === 'assistant') return shown(item.text)
}

/** A message `needle` is in, and how many times. */
export type Hit = { id: string; count: number }

/** Each message as Find reads it, kept: a chat is read again with every letter typed, and a reply as it grows. */
const read = new WeakMap<ChatItem, string | null>()
function readOf(item: ChatItem) {
  let text = read.get(item)
  if (text === undefined) {
    const said = saidIn(item)
    read.set(item, (text = said === undefined ? null : fold(said).text))
  }
  return text
}

/**
 * Every message the words are in, oldest first. A message on screen has been
 * counted there (`seen`), which is the truth; one that isn't is counted from
 * its text, which is close.
 */
export function hitsIn(items: ChatItem[], needle: string, seen?: ReadonlyMap<string, number>): Hit[] {
  if (!needle) return []
  const out: Hit[] = []
  for (const item of items) {
    const text = readOf(item)
    if (text === null) continue
    let count = seen?.get(item.id)
    if (count === undefined) {
      count = 0
      for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) count++
    }
    if (count) out.push({ id: item.id, count })
  }
  return out
}

/** One place the words are: the message, and which of its places, counted from its top (or its last). */
export type Place = { id: string; nth: number | 'last' }

const nthOf = (place: Place, hit: Hit) => (place.nth === 'last' ? hit.count - 1 : Math.min(place.nth, hit.count - 1))

/**
 * Where a place stands among them all, counted from the newest (1) back, the
 * way you meet them from the end of a chat. 0 when it's no longer one.
 */
export function standing(hits: Hit[], place: Place | undefined) {
  const at = place ? hits.findIndex((h) => h.id === place.id) : -1
  if (!place || at < 0) return 0
  let after = 0
  for (let i = at + 1; i < hits.length; i++) after += hits[i].count
  return after + hits[at].count - nthOf(place, hits[at])
}

/** The place before this one (`older`) or after it, going round at either end. */
export function step(hits: Hit[], place: Place | undefined, older: boolean): Place | undefined {
  if (!hits.length) return undefined
  const at = place ? hits.findIndex((h) => h.id === place.id) : -1
  if (!place || at < 0) return older ? { id: hits.at(-1)!.id, nth: 'last' } : { id: hits[0].id, nth: 0 }
  const nth = nthOf(place, hits[at])
  if (older) {
    if (nth > 0) return { id: place.id, nth: nth - 1 }
    return { id: hits[(at - 1 + hits.length) % hits.length].id, nth: 'last' }
  }
  if (nth < hits[at].count - 1) return { id: place.id, nth: nth + 1 }
  return { id: hits[(at + 1) % hits.length].id, nth: 0 }
}

/**
 * Where to start: the newest place at or before the message you're looking
 * at (`from`), so Find begins where you are and reads back; the newest of
 * all when there's none that far back, or nowhere to start from.
 */
export function nearest(hits: Hit[], items: ChatItem[], from?: string): Place | undefined {
  if (!hits.length) return undefined
  const limit = from ? items.findIndex((i) => i.id === from) : -1
  if (limit >= 0) {
    const order = new Map(items.map((item, i) => [item.id, i]))
    const hit = hits.findLast((h) => (order.get(h.id) ?? Infinity) <= limit)
    if (hit) return { id: hit.id, nth: 'last' }
  }
  return { id: hits.at(-1)!.id, nth: 'last' }
}

// ── On the page ──────────────────────────────────────────────────────────────

/** Elements whose words start on a line of their own, so words either side of one never run together. */
const BLOCK = 'p,div,li,pre,h1,h2,h3,h4,h5,h6,td,th,tr,blockquote,ul,ol,table,figure,figcaption,summary,details,section'

/** Where `needle` is in a message as it's drawn, each place a range over its words (the first `most` of them). */
export function rangesIn(message: HTMLElement, needle: string, most = Infinity): Range[] {
  if (!needle) return []
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  let block: Element | null = null
  const walk = document.createTreeWalker(message, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      // Not a button's label, nor anything drawn for show.
      node.parentElement?.closest('button,[aria-hidden="true"],.sr-only')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  for (let node = walk.nextNode() as Text | null; node; node = walk.nextNode() as Text | null) {
    const within = node.parentElement?.closest(BLOCK) ?? null
    if (nodes.length && within !== block) text += '\n'
    block = within
    nodes.push(node)
    starts.push(text.length)
    text += node.data
  }
  const out: Range[] = []
  let n = 0
  /** The node a character of `text` is in, and where in it. */
  const point = (at: number, end: boolean) => {
    while (n < nodes.length - 1 && starts[n + 1] <= (end ? at - 1 : at)) n++
    return [nodes[n], Math.min(at - starts[n], nodes[n].length)] as const
  }
  for (const [start, end] of placesIn(text, needle)) {
    const range = document.createRange()
    range.setStart(...point(start, false))
    range.setEnd(...point(end, true))
    // Folded away (a collapsed block) is not somewhere to go.
    if (range.getClientRects().length) out.push(range)
    if (out.length >= most) break
  }
  return out
}
