// An agent's name, the way Murmur shows it everywhere: what Bot Mode titled
// it, else the name it was given, else "Hermes" for the main one, else its
// profile's name, readably.

/** As Hermes lists an agent (REST /api/profiles, or profiles.list). */
export type NamedProfile = {
  name: string
  is_default?: boolean
  display_name?: string
  /** REST only: ui_meta['hermes-bots'].title. */
  bot_title?: string
  ui_meta?: Record<string, unknown> | null
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const record = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)

export const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** What Bot Mode called it, if it did. */
export const botTitle = (p: NamedProfile) => text(record(p.ui_meta?.['hermes-bots'])?.title) || text(p.bot_title)

export function agentName(p: NamedProfile) {
  return botTitle(p) || text(p.display_name) || (p.is_default ? 'Hermes' : titleCase(p.name))
}
