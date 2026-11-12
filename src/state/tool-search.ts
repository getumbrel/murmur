// Tools Murmur keeps to hand. Hermes hides some of its tools behind its tool
// search (config tools.tool_search.defer): the agent sees one line about each
// and has to look it up before it can use it, so in practice it reaches for
// them only when asked outright. Two of them are things Murmur draws:
//
//   todo_list       the plan an agent writes for a bigger job and ticks off
//                   as it goes (features/chat/plan.tsx). Hidden since Hermes
//                   0.21; before that agents always had it.
//   image_generate  pictures, once they're switched on (state/pictures.ts)
//
// An explicit list replaces Hermes's default wholesale, freezing the defaults
// of the Hermes that wrote it, so the list is rebuilt from this Hermes's
// defaults (plus anything the agent added) each time it falls out of step,
// e.g. after a Hermes update.

import { api, on } from '@/hermes/rest'

export const PLAN_TOOL = 'todo_list'
export const IMAGE_TOOL = 'image_generate'

export type ToolSearchConfig = { tools?: { tool_search?: { defer?: unknown } } }

/** Tools an older Hermes deferred by default and a newer one no longer has on the list (or at all). */
const FORMER_DEFAULTS = ['apply_layout']

const names = (list: unknown) => (Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string') : null)

/**
 * The agent's tool-search list with `toHand` out of it: this Hermes's
 * defaults plus whatever else the agent defers. `current` is the agent's own
 * list, or nothing when it has none and Hermes's default applies. Null when
 * there's nothing to change: the list is already that, it's empty (Hermes's
 * way of keeping every tool to hand), or there's no list to start from.
 * Without the defaults (an older Hermes that didn't say), only `toHand` comes out.
 */
export function nextDefer(current: unknown, defaults: unknown, toHand: readonly string[]): string[] | null {
  const own = names(current)
  const base = names(defaults)
  if (own?.length === 0) return null
  const now = own ?? base
  if (!now) return null
  const extras = own && base ? own.filter((n) => !base.includes(n) && !FORMER_DEFAULTS.includes(n)) : []
  const next = (base ? [...base, ...extras] : now).filter((n) => !toHand.includes(n))
  const same = next.length === now.length && next.every((n) => now.includes(n))
  return same ? null : next
}

const defaultDefer = new Map<string | null, Promise<unknown>>()

/** A Hermes's default tool-search list (public, and the same for every agent there). Read once; again after a failed read. */
export function readDefaultDefer(hermes: string | null) {
  let read = defaultDefer.get(hermes)
  if (!read) {
    read = api.get<ToolSearchConfig>('/api/config/defaults', on(hermes)).then(
      (d) => d.tools?.tool_search?.defer,
      () => void defaultDefer.delete(hermes),
    )
    defaultDefer.set(hermes, read)
  }
  return read
}
