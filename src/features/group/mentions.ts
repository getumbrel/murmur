// @mentions. People write names ("@Atlas"); Hermes routes on handles
// ("@atlas", or "@hermes" for the main agent). Text is converted on the way
// out and back, so nobody ever has to know a handle.

export type Mentionable = { id: string; name: string; handle: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A mention ends where the word does. */
const END = '(?![\\p{L}\\p{N}_-])'
const EVERYONE = /@(everyone|all)(?![\p{L}\p{N}_-])/iu

function pattern(words: string[]) {
  // Longest first, so "@Research Bot" wins over "@Research".
  const sorted = [...new Set(words.filter(Boolean))].sort((a, b) => b.length - a.length)
  return sorted.length ? new RegExp(`@(${sorted.map(escape).join('|')})${END}`, 'giu') : null
}

function lookup(members: Mentionable[], key: 'name' | 'handle') {
  const map = new Map<string, Mentionable>()
  for (const m of members) map.set(m[key].toLowerCase(), m)
  return map
}

/** "@Atlas, thoughts?" → "@atlas, thoughts?" */
export function toHandles(text: string, members: Mentionable[]) {
  const re = pattern(members.map((m) => m.name))
  if (!re) return text
  const byName = lookup(members, 'name')
  return text.replace(re, (whole, name: string) => {
    const m = byName.get(name.toLowerCase())
    return m ? `@${m.handle}` : whole
  })
}

/** "@atlas, thoughts?" → "@Atlas, thoughts?" */
export function toNames(text: string, members: Mentionable[]) {
  const re = pattern(members.map((m) => m.handle))
  if (!re) return text
  const byHandle = lookup(members, 'handle')
  return text.replace(re, (whole, handle: string) => {
    const m = byHandle.get(handle.toLowerCase())
    return m ? `@${m.name}` : whole
  })
}

export type MentionRange<M extends Mentionable = Mentionable> = { start: number; end: number; member?: M }

// The matcher for a roster is built once: thread text is scanned on every streamed token.
const matchers = new WeakMap<Mentionable[], { re: RegExp | null; byName: Map<string, Mentionable>; byHandle: Map<string, Mentionable> }>()
function matcher(members: Mentionable[]) {
  let m = matchers.get(members)
  if (!m) {
    const words = [...members.map((x) => x.name), ...members.map((x) => x.handle), 'everyone', 'all']
    m = { re: pattern(words), byName: lookup(members, 'name'), byHandle: lookup(members, 'handle') }
    matchers.set(members, m)
  }
  return m
}

/** Where the mentions are, for tinting them (as you type, and in the thread). */
export function mentionRanges<M extends Mentionable>(text: string, members: M[]): MentionRange<M>[] {
  if (!text.includes('@')) return []
  const { re, byName, byHandle } = matcher(members)
  if (!re) return []
  const out: MentionRange<M>[] = []
  for (const match of text.matchAll(re)) {
    const word = match[1].toLowerCase()
    const start = match.index ?? 0
    // Only at the start of a word ("me@atlas" is an address, not a mention), or right after a dash: "done—@Atlas".
    if (start > 0 && !/\s|[(\["'“‘—–]/u.test(text[start - 1])) continue
    const member = (byName.get(word) ?? byHandle.get(word)) as M | undefined
    out.push({ start, end: start + match[0].length, member })
  }
  return out
}

/** Who a message is addressed to. Nobody named (or @everyone) means everyone. */
export function mentionedIds(text: string, members: Mentionable[]): string[] {
  if (EVERYONE.test(text)) return members.map((m) => m.id)
  const ids = new Set(mentionRanges(text, members).flatMap((r) => (r.member ? [r.member.id] : [])))
  return members.filter((m) => ids.has(m.id)).map((m) => m.id)
}

/** The "@que" being typed right before the caret, if any. */
export function activeQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = before.match(/(?:^|[\s(])@([\p{L}\p{N}_-]{0,32})$/u)
  if (!m) return null
  return { start: caret - m[1].length - 1, query: m[1] }
}
