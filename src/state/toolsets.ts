// Toolsets Murmur can't show. Hermes 0.22 gives every chat from a desktop app
// (Murmur's chats say they are one) two extra toolsets: `project` (desktop
// projects) and `catalog` (installing plugins and skills through a card only
// Hermes Desktop draws). In Murmur an agent reaching for either would just
// stall, so agents Murmur makes have them switched off in their own config.
// Murmur's server does the same for the built-in Hermes's agents (server/discovery.ts).

import { api } from '@/hermes/rest'

export const HIDDEN_TOOLSETS = ['catalog', 'project']

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
  const config = await api.get<{ agent?: { disabled_toolsets?: unknown } }>(`/api/config?${q}&include_defaults=false`)
  const next = withHiddenToolsets(config?.agent?.disabled_toolsets)
  // PUT deep-merges into the file, so only this key changes.
  if (next) await api.put(`/api/config?${q}`, { config: { agent: { disabled_toolsets: next } } })
}
