// Toolsets Murmur can't show. Hermes 0.22 gives every chat from a desktop app
// (Murmur's chats say they are one) two extra toolsets: `project` (desktop
// projects) and `catalog` (installing plugins and skills through a card only
// Hermes Desktop draws). In Murmur an agent reaching for either would just
// stall, so agents Murmur makes have them switched off in their own config.
// Murmur's server does the same for the built-in Hermes's agents (server/discovery.ts).
//
// The `connections` toolset (Hermes's manage_connections) stays off too until
// the person agrees to apps through Nous (state/hosted-apps-consent.ts): an
// agent using it would create a Nous identity for this Hermes without asking.
// Once they agree it's switched back on for every agent, because Hermes only
// lets an agent reach the apps connected through Nous (through tool_search and
// tool_call) while manage_connections is among its tools.
//
// The `desktop_ui` toolset can't be switched off that way (Hermes keeps it for
// every desktop chat), but its two chattiest tools follow the agent's own
// display settings: tips and tours point at Hermes Desktop's screen, which
// Murmur doesn't have, so they're switched off. Reactions are switched on:
// Murmur shows them (src/features/chat/reactions.tsx). And the agent's steps
// must reach Murmur as they happen: with `tool_progress: off` (a terminal
// setting) Hermes sends none, so a chat shows no steps and nothing found
// until it's reloaded.
//
// And the other way: Hermes hides its plan tool behind its tool search, so an
// agent hardly ever writes a plan Murmur could show. It comes out of every
// agent's tool search (state/tool-search.ts).

import { useEffect } from 'react'
import { api } from '@/hermes/rest'
import { rememberedSet, upkeep } from '@/lib/upkeep'
import { byHermes, hermesOf, scoped } from '@/hermes/instance'
import { hostedAppsAllowed } from './hosted-apps-consent'
import { IMAGE_TOOL, PLAN_TOOL, nextDefer, readDefaultDefer, type ToolSearchConfig } from './tool-search'

export const HIDDEN_TOOLSETS = ['catalog', 'project']
/** Hermes's manage_connections: off until the person agrees to apps through Nous. */
export const HOSTED_TOOLSET = 'connections'

type Display = { in_app_tips?: unknown; in_app_tours?: unknown; message_reactions?: unknown; tool_progress?: unknown }

/**
 * What to change in the agent's display settings for Murmur, or null when
 * nothing. Tips and tours always go; reactions come on unless the agent was
 * set not to react.
 */
export function murmurDisplay(current: Display | undefined): Display | null {
  const next: Display = {}
  if (current?.in_app_tips !== false) next.in_app_tips = false
  if (current?.in_app_tours !== false) next.in_app_tours = false
  if (current?.message_reactions === undefined) next.message_reactions = true
  if (current?.tool_progress === 'off' || current?.tool_progress === false) next.tool_progress = 'all'
  return Object.keys(next).length ? next : null
}

/**
 * The agent's disabled toolsets the way Murmur wants them, or null when
 * they're in step already: Murmur's added, and `connections` off unless apps
 * through Nous are allowed (`hosted`). Leaves anything else it has switched off.
 */
export function withHiddenToolsets(current: unknown, hosted = false): string[] | null {
  const list = Array.isArray(current)
    ? current.map(String)
    : typeof current === 'string' && current.trim()
      ? [current.trim()]
      : []
  const wanted = hosted ? HIDDEN_TOOLSETS : [...HIDDEN_TOOLSETS, HOSTED_TOOLSET]
  const kept = hosted ? list.filter((t) => t !== HOSTED_TOOLSET) : list
  const missing = wanted.filter((t) => !kept.includes(t))
  return missing.length || kept.length !== list.length ? [...kept, ...missing] : null
}

/**
 * The agent's tool-search list with the plan tool to hand, or null when it
 * already is. `current` is the agent's own list (none: Hermes's default). The
 * image tool stays out once pictures took it out (state/pictures.ts).
 */
export function murmurDefer(current: unknown, defaults: unknown): string[] | null {
  const drawing = Array.isArray(current) && !current.includes(IMAGE_TOOL)
  return nextDefer(current, defaults, drawing ? [PLAN_TOOL, IMAGE_TOOL] : [PLAN_TOOL])
}

/**
 * Switch off what Murmur can't show, and keep to hand what it can, for one
 * agent. `hosted`: whether apps through Nous are allowed, asked of Hermes when
 * not given.
 */
export async function hideDesktopToolsets(profile: string, hosted?: boolean) {
  const allowed = hosted ?? (await hostedAppsAllowed(hermesOf(profile)))
  const q = `profile=${encodeURIComponent(profile)}`
  const [config, defaults] = await Promise.all([
    api.get<{ agent?: { disabled_toolsets?: unknown }; display?: Display } & ToolSearchConfig>(
      `/api/config?${q}&include_defaults=false`,
    ),
    readDefaultDefer(hermesOf(profile)),
  ])
  const next = withHiddenToolsets(config?.agent?.disabled_toolsets, allowed)
  const display = murmurDisplay(config?.display)
  const defer = murmurDefer(config?.tools?.tool_search?.defer, defaults)
  // PUT deep-merges into the file, so only these keys change.
  if (next || display || defer)
    await api.put(`/api/config?${q}`, {
      config: {
        ...(next && { agent: { disabled_toolsets: next } }),
        ...(display && { display }),
        ...(defer && { tools: { tool_search: { defer } } }),
      },
    })
  synced(allowed).add(profile)
}

// Agents known to be in step, remembered across reloads (for a day) so most
// page loads have nothing to do. One list for each answer about apps through
// Nous, so agreeing puts every agent through again.
const syncedOff = rememberedSet(scoped('murmur:desktop-tools:4'))
const syncedOn = rememberedSet(scoped('murmur:desktop-tools:hosted:4'))
const synced = (hosted: boolean) => (hosted ? syncedOn : syncedOff)

/**
 * Keeps every agent's desktop-only tools in step with what Murmur can show,
 * catching agents made in other apps too. Mount once. Quiet: idle-time
 * requests, one at a time, and nothing at all once every agent is in step.
 */
export function useDesktopToolsSync(agentIds: readonly string[] | undefined) {
  const key = agentIds?.join('\n') ?? ''
  useEffect(() => {
    // Each Hermes has its own answer about apps through Nous.
    for (const [hermes, ids] of byHermes(key ? key.split('\n') : [])) {
      // Every agent is in step for one answer: nothing to ask. The answer only
      // changes by agreeing, and the tab that agrees puts every agent through.
      if (ids.every((id) => syncedOn.has(id)) || ids.every((id) => syncedOff.has(id))) continue
      // Unreadable: left for the next load.
      void upkeep(async () => {
        const allowed = await hostedAppsAllowed(hermes)
        for (const id of ids.filter((id) => !synced(allowed).has(id)))
          await hideDesktopToolsets(id, allowed).catch(() => {})
      }).catch(() => {})
    }
  }, [key])
}

/**
 * Puts a Hermes's agents in step after the person agreed to apps through Nous
 * there. One that can't be reached now is caught up on a later load.
 */
export async function allowHostedApps(agentIds: readonly string[]) {
  for (const id of agentIds) syncedOff.delete(id)
  for (const id of agentIds) await hideDesktopToolsets(id, true).catch(() => {})
}
