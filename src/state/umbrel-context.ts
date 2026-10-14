// What every agent on an Umbrel should know about where it runs. Umbrel's
// Hermes images ship an `umbrel-runtime` plugin (a short note on every turn:
// paths, persistence, updates) and an `umbrel` skill folder, and switch both on
// in the main agent's config. Hermes plugins and extra skill folders are
// per-agent, though, so an agent made later (here, in Hermes's dashboard or in
// a terminal) starts without them. Murmur copies them over from the main agent.
//
// It only ever copies what the main agent already has, so on a Hermes that
// isn't on an Umbrel there's nothing to copy and nothing happens. An agent that
// switched the plugin off itself keeps it off.

import { useEffect } from 'react'
import { api } from '@/hermes/rest'
import { rememberedSet, upkeep } from '@/lib/upkeep'
import { scoped } from '@/hermes/instance'

const MAIN = 'default'
export const UMBREL_PLUGIN = 'umbrel-runtime'
/** Umbrel's skill folders, wherever an image version keeps them. */
const isUmbrelSkills = (dir: string) => /umbrel/i.test(dir)

type Config = {
  plugins?: { enabled?: unknown; disabled?: unknown }
  skills?: { external_dirs?: unknown }
}

export type UmbrelContext = { plugin: boolean; skills: string[] }

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : typeof value === 'string' && value.trim() ? [value.trim()] : []

/** The Umbrel context the main agent has switched on (none off an Umbrel). */
export function umbrelContextOf(main: Config | undefined): UmbrelContext {
  return {
    plugin: list(main?.plugins?.enabled).includes(UMBREL_PLUGIN),
    skills: list(main?.skills?.external_dirs).filter(isUmbrelSkills),
  }
}

/**
 * The config to merge into an agent so it has `context` too, or null when it
 * already has it (or there's nothing to add). Its own plugins and skill folders
 * are kept, and a plugin it switched off stays off.
 */
export function umbrelContextPatch(context: UmbrelContext, agent: Config | undefined): Config | null {
  const patch: Config = {}
  const enabled = list(agent?.plugins?.enabled)
  const disabled = list(agent?.plugins?.disabled)
  if (context.plugin && !enabled.includes(UMBREL_PLUGIN) && !disabled.includes(UMBREL_PLUGIN))
    patch.plugins = { enabled: [...enabled, UMBREL_PLUGIN] }
  const dirs = list(agent?.skills?.external_dirs)
  const missing = context.skills.filter((d) => !dirs.includes(d))
  if (missing.length) patch.skills = { external_dirs: [...dirs, ...missing] }
  return patch.plugins || patch.skills ? patch : null
}

const q = (profile: string) => `profile=${encodeURIComponent(profile)}`
const read = (profile: string) => api.get<Config>(`/api/config?${q(profile)}&include_defaults=false`)

// Agents known to be in step, remembered across reloads (for a day) so most
// page loads have nothing to do.
const synced = rememberedSet(scoped('murmur:umbrel-context'))

async function bring(profile: string, context: UmbrelContext) {
  const patch = umbrelContextPatch(context, await read(profile))
  // PUT deep-merges into the agent's file, so only these keys change.
  if (patch) await api.put(`/api/config?${q(profile)}`, { config: patch })
  synced.add(profile)
}

/** Gives one agent the main agent's Umbrel context. Call after creating an agent. */
export async function ensureUmbrelContext(profile: string) {
  if (profile === MAIN) return
  const context = umbrelContextOf(await read(MAIN))
  if (context.plugin || context.skills.length) await bring(profile, context)
  else synced.add(profile)
}

async function catchUp(ids: string[]) {
  const missing = ids.filter((id) => id !== MAIN && !synced.has(id))
  if (!missing.length) return
  const context = umbrelContextOf(await read(MAIN))
  for (const id of missing) {
    if (!context.plugin && !context.skills.length) {
      synced.add(id)
      continue
    }
    // Unreadable: left for the next load.
    await bring(id, context).catch(() => {})
  }
}

/**
 * Keeps every agent's Umbrel context in step with the main agent's, catching
 * agents made since (here or in another app). Mount once. Quiet: idle-time
 * requests, one at a time, and nothing at all once every agent is in step.
 */
export function useUmbrelContextSync(agentIds: readonly string[] | undefined) {
  const key = agentIds?.join('\n') ?? ''
  useEffect(() => {
    const ids = key ? key.split('\n') : []
    if (ids.some((id) => id !== MAIN && !synced.has(id))) void upkeep(() => catchUp(ids)).catch(() => {})
  }, [key])
}
