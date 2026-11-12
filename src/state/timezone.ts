// Hermes schedules routines on the wall clock of each agent's configured
// timezone. Out of the box that's blank, so a container on UTC would brief you
// at 8:00 UTC. Murmur fills it in from the browser, per agent, and never
// touches a timezone someone chose.
//
// Hermes reads `timezone` from each agent's own config.yaml (the multiplexed
// background service routes every agent through its own file) and caches it
// for the life of the process. So after filling one in, Murmur restarts the
// background service that runs routines, once, when it's idle. Until it has,
// Murmur pins each routine's next run itself (see state/routines.ts).

import { useQuery } from '@tanstack/react-query'
import { api } from '@/hermes/rest'
import { at } from '@/hermes/at'
import { openSoon } from '@/hermes/gateway'
import { rememberedSet, upkeep } from '@/lib/upkeep'
import { hermesOf, isMain, mainFor, mainOn, scoped } from '@/hermes/instance'
import { everyHermes } from '@/hermes/kept'
import { listProfiles } from '@/hermes/compat'

export const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const q = (profile: string) => `profile=${encodeURIComponent(profile)}`

/** The timezone saved in an agent's own config, or '' when it was never set. */
export async function readTimezone(profile: string): Promise<string> {
  const cfg = await api.get<{ timezone?: unknown }>(`/api/config?${q(profile)}&include_defaults=false`)
  return typeof cfg?.timezone === 'string' ? cfg.timezone.trim() : ''
}

const zones = new Map<string, { zone: string; at: number }>()

/** An agent's saved timezone ('' when none), remembered for a few minutes. */
export async function agentZone(profile: string): Promise<string> {
  const hit = zones.get(profile)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.zone
  const zone = await readTimezone(profile)
  zones.set(profile, { zone, at: Date.now() })
  return zone
}

async function writeTimezone(profile: string, zone: string, { stale = true } = {}) {
  // PUT deep-merges into the file, so only this key changes.
  await api.put(`/api/config?${q(profile)}`, { config: { timezone: zone } })
  zones.set(profile, { zone, at: Date.now() })
  if (stale) markStale(hermesOf(profile))
}

// ── Refreshing the routine runner ───────────────────────────────────────────

// Remembered across reloads, so a refresh cut short by closing the tab
// happens the next time Murmur starts. Each Hermes has its own runner.
const staleKey = (hermes: string | null) => scoped('murmur:routine-runner-stale', hermes)

function markStale(hermes: string | null) {
  try {
    localStorage.setItem(staleKey(hermes), '1')
  } catch {
    // Private mode: this page load still refreshes it.
  }
}

function isStale(hermes: string | null) {
  try {
    return localStorage.getItem(staleKey(hermes)) === '1'
  } catch {
    return false
  }
}

function clearStale(hermes: string | null) {
  try {
    localStorage.removeItem(staleKey(hermes))
  } catch {
    // Nothing to clear.
  }
}

type Status = { gateway_running?: boolean; gateway_busy?: boolean }

const restartTimers = new Map<string | null, ReturnType<typeof setTimeout>>()
const restarting = new Set<string | null>()

/** Restart a Hermes's routine runner so it re-reads timezones, waiting until it's idle. */
async function refreshRunner(hermes: string | null, attempt = 0) {
  clearTimeout(restartTimers.get(hermes))
  if (restarting.has(hermes)) return
  const h = at(hermes)
  try {
    const status = await h.get<Status>('/api/status')
    // Nothing running (a desktop backend ticks in-process): nothing to refresh.
    if (!status?.gateway_running) return clearStale(hermes)
    if (status.gateway_busy) {
      // Someone's mid-conversation on another app: try again shortly.
      if (attempt < 20) restartTimers.set(hermes, setTimeout(() => void refreshRunner(hermes, attempt + 1), 30_000))
      return
    }
    restarting.add(hermes)
    await h.post('/api/gateway/restart')
    clearStale(hermes)
  } catch {
    // Best effort: it's retried on the next start, and Hermes's own restart fixes it too.
  } finally {
    restarting.delete(hermes)
  }
}

// Agents known to have a timezone, remembered across reloads (for a day) so
// app start only looks at agents it hasn't seen.
const checked = rememberedSet(scoped('murmur:timezone-checked'))

type Options = {
  /** Restart the routine runner when anything changed (default true). */
  restart?: boolean
}

/**
 * Give one agent a timezone if it has none: its Hermes's main agent's when it
 * has one, else this browser's. Returns the zone the agent schedules in.
 *
 * Call it with `{ restart: false }` right after creating an agent: the runner
 * hasn't looked at the new agent yet, so no restart is needed.
 */
export async function ensureAgentTimezone(profile: string, { restart = true }: Options = {}): Promise<string> {
  const own = await agentZone(profile)
  if (own) {
    checked.add(profile)
    return own
  }
  const main = isMain(profile) ? '' : await agentZone(mainFor(profile)).catch(() => '')
  const zone = main || browserTimeZone()
  await writeTimezone(profile, zone, { stale: restart })
  checked.add(profile)
  if (restart) void refreshRunner(hermesOf(profile))
  return zone
}

let once: Promise<string[]> | undefined

/** How long a Hermes gets to answer before app start goes on without it (it's looked at on the next start). */
const AWAY_MS = 3500

/**
 * Call once at app start, after Hermes is reachable. Fills in a timezone for
 * every agent that has none (each Hermes's main agent from this browser, the
 * rest from their main agent), never overwriting a chosen one, then refreshes
 * the routine runner if anything changed. Quiet: it only looks at agents this
 * browser hasn't checked lately, one at a time when the page is idle. Returns
 * the agents it updated. Safe to call repeatedly: it runs once per load.
 */
export function ensureTimezone(options: Options = {}) {
  once ??= upkeep(async () => {
    const { restart = true } = options
    const all = everyHermes()
    const updated: string[] = []
    let failure: unknown
    for (const hermes of all) {
      try {
        // Of several, one that's away is left for the next start.
        if (all.length > 1 && !(await openSoon(hermes, AWAY_MS))) continue
        const profiles = await listProfiles({}, hermes)
        // The main agent first: the others take its zone.
        const main = mainOn(hermes)
        const names = [main, ...profiles.map((p) => p.name).filter((n) => n !== main)]
        for (const name of names.filter((n) => !checked.has(n))) {
          // Unreadable: leave it alone rather than guess (and look again next time).
          const own = await agentZone(name).catch(() => undefined)
          if (own === undefined) continue
          if (!own) {
            const zone = name === main ? '' : await agentZone(main).catch(() => '')
            await writeTimezone(name, zone || browserTimeZone())
            updated.push(name)
          }
          checked.add(name)
        }
        if (restart && isStale(hermes)) void refreshRunner(hermes)
      } catch (error) {
        failure = error
      }
    }
    // One Hermes: its failure is the answer, as it always was.
    if (failure && all.length === 1) throw failure
    return updated
  }).catch((err) => {
    once = undefined // try again next time
    throw err
  })
  return once
}

/** The zone an agent's routines run in (filled in on first read). */
export function useAgentTimezone(profile: string | undefined) {
  return useQuery({
    queryKey: ['timezone', profile],
    enabled: Boolean(profile),
    queryFn: () => ensureAgentTimezone(profile!),
    staleTime: 5 * 60_000,
  })
}
