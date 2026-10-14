import type { Element, ElementContent, Root, RootContent } from 'hast'
import { mentionRanges, type Mentionable } from '@/features/group/mentions'

// @mentions in prose become <mention> elements that markdown.tsx renders as
// chips, each spelled the way its agent is named. It runs after sanitising, on
// the finished tree, so code, links (and the addresses GFM turns into links)
// are never touched.

/** Where a mention is never a mention. */
const SKIP = new Set(['code', 'pre', 'a', 'kbd', 'samp', 'mention', 'svg', 'math'])

type Options = { members: Mentionable[] }

export function rehypeMentions({ members }: Options) {
  const split = (value: string): ElementContent[] | null => {
    const ranges = mentionRanges(value, members)
    if (!ranges.length) return null
    const out: ElementContent[] = []
    let at = 0
    for (const r of ranges) {
      if (r.start > at) out.push({ type: 'text', value: value.slice(at, r.start) })
      out.push({
        type: 'element',
        tagName: 'mention',
        // An agent's id, or nothing for @everyone / @all.
        properties: { dataAgent: r.member?.id ?? '' },
        // A handle reads as the name it stands for: "@murmur-iris" → "@Iris".
        children: [{ type: 'text', value: r.member ? `@${r.member.name}` : value.slice(r.start, r.end) }],
      })
      at = r.end
    }
    if (at < value.length) out.push({ type: 'text', value: value.slice(at) })
    return out
  }

  const walk = (node: Root | Element) => {
    const next: RootContent[] = []
    let changed = false
    for (const child of node.children) {
      if (child.type === 'text') {
        const parts = split(child.value)
        if (parts) {
          next.push(...parts)
          changed = true
          continue
        }
      } else if (child.type === 'element' && !SKIP.has(child.tagName)) walk(child)
      next.push(child)
    }
    if (changed) node.children = next as typeof node.children
  }

  return (tree: Root) => {
    if (members.length) walk(tree)
  }
}
