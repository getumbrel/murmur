// Toolsets Murmur can't show. Hermes 0.22 gives every chat from a desktop app
// (Murmur's chats say they are one) two extra toolsets: `project` (desktop
// projects) and `catalog` (installing plugins and skills through a card only
// Hermes Desktop draws). In Murmur an agent reaching for either would just
// stall, so agents Murmur makes have them switched off in their own config.
// Murmur's server does the same for the built-in Hermes's agents (server/discovery.ts).
//
// The `desktop_ui` toolset can't be switched off that way (Hermes keeps it for
// every desktop chat), but its two chattiest tools follow the agent's own
// display settings: tips and tours point at Hermes Desktop's screen, which
// Murmur doesn't have, so they're switched off. Reactions are switched on:
// Murmur shows them (src/features/chat/reactions.tsx).

import { useEffect } from 'react'
import { api } from '@/hermes/rest'
import { rememberedSet, upkeep } from '@/lib/upkeep'
import { scoped } from '@/hermes/instance'

export const HIDDEN_TOOLSETS = ['catalog', 'project']

type Display = { in_app_tips?: unknown; in_app_tours?: unknown; message_reactions?: unknown }

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
  return Object.keys(next).length ? next : null
}

/** The agent's disabled toolsets with Murmur's added, or null when they're there already. */
export function withHiddenToolsets(current: unknown): string[] | null {
  const list = Array.isArray(current)
    ? current.map(String)
    : typeof current === 'string' && current.trim()
      ? [current.trim()]
      : []
  const missing = HIDDEN_TOOLSETS.filter((t) => !list.includes(t))
  return missing.length ? [...list, ...missing] : null
}

/** Switch off what Murmur can't show, for one agent. Leaves anything else it has switched off. */
export async function hideDesktopToolsets(profile: string) {
  const q = `profile=${encodeURIComponent(profile)}`
  const config = await api.get<{ agent?: { disabled_toolsets?: unknown }; display?: Display }>(
    `/api/config?${q}&include_defaults=false`,
  )
  const next = withHiddenToolsets(config?.agent?.disabled_toolsets)
  const display = murmurDisplay(config?.display)
  // PUT deep-merges into the file, so only these keys change.
  if (next || display)
    await api.put(`/api/config?${q}`, {
      config: { ...(next && { agent: { disabled_toolsets: next } }), ...(display && { display }) },
    })
  synced.add(profile)
}

// Agents known to be in step, remembered across reloads (for a day) so most
// page loads have nothing to do.
const synced = rememberedSet(scoped('murmur:desktop-tools'))

/**
 * Keeps every agent's desktop-only tools in step with what Murmur can show,
 * catching agents made in other apps too. Mount once. Quiet: idle-time
 * requests, one at a time, and nothing at all once every agent is in step.
 */
export function useDesktopToolsSync(agentIds: readonly string[] | undefined) {
  const key = agentIds?.join('\n') ?? ''
  useEffect(() => {
    const missing = (key ? key.split('\n') : []).filter((id) => !synced.has(id))
    if (!missing.length) return
    // Unreadable: left for the next load.
    void upkeep(async () => {
      for (const id of missing) await hideDesktopToolsets(id).catch(() => {})
    }).catch(() => {})
  }, [key])
}
