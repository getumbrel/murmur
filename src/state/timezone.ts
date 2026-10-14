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
import { rememberedSet, upkeep } from '@/lib/upkeep'
import { scoped } from '@/hermes/instance'
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
  if (stale) markStale()
}

// ── Refreshing the routine runner ───────────────────────────────────────────

// Remembered across reloads, so a refresh cut short by closing the tab
// happens the next time Murmur starts.
const STALE_KEY = scoped('murmur:routine-runner-stale')

function markStale() {
  try {
    localStorage.setItem(STALE_KEY, '1')
  } catch {
    // Private mode: this page load still refreshes it.
  }
}

function isStale() {
  try {
    return localStorage.getItem(STALE_KEY) === '1'
  } catch {
    return false
  }
}

function clearStale() {
  try {
    localStorage.removeItem(STALE_KEY)
  } catch {
    // Nothing to clear.
  }
}

type Status = { gateway_running?: boolean; gateway_busy?: boolean }

let restartTimer: ReturnType<typeof setTimeout> | undefined
let restarting = false

/** Restart the routine runner so it re-reads timezones, waiting until it's idle. */
async function refreshRunner(attempt = 0) {
  clearTimeout(restartTimer)
  if (restarting) return
  try {
    const status = await api.get<Status>('/api/status')
    // Nothing running (a desktop backend ticks in-process): nothing to refresh.
    if (!status?.gateway_running) return clearStale()
    if (status.gateway_busy) {
      // Someone's mid-conversation on another app: try again shortly.
      if (attempt < 20) restartTimer = setTimeout(() => void refreshRunner(attempt + 1), 30_000)
      return
    }
    restarting = true
    await api.post('/api/gateway/restart')
    clearStale()
  } catch {
    // Best effort: it's retried on the next start, and Hermes's own restart fixes it too.
  } finally {
    restarting = false
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
 * Give one agent a timezone if it has none: the main agent's when it has one,
 * else this browser's. Returns the zone the agent schedules in.
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
  const main = profile === 'default' ? '' : await agentZone('default').catch(() => '')
  const zone = main || browserTimeZone()
  await writeTimezone(profile, zone, { stale: restart })
  checked.add(profile)
  if (restart) void refreshRunner()
  return zone
}

let once: Promise<string[]> | undefined

/**
 * Call once at app start, after Hermes is reachable. Fills in a timezone for
 * every agent that has none (the main agent from this browser, the rest from
 * the main agent), never overwriting a chosen one, then refreshes the routine
 * runner if anything changed. Quiet: it only looks at agents this browser
 * hasn't checked lately, one at a time when the page is idle. Returns the
 * agents it updated. Safe to call repeatedly: it runs once per load.
 */
export function ensureTimezone(options: Options = {}) {
  once ??= upkeep(async () => {
    const { restart = true } = options
    const profiles = await listProfiles()
    // The main agent first: the others take its zone.
    const names = ['default', ...profiles.map((p) => p.name).filter((n) => n !== 'default')]
    const updated: string[] = []
    for (const name of names.filter((n) => !checked.has(n))) {
      // Unreadable: leave it alone rather than guess (and look again next time).
      const own = await agentZone(name).catch(() => undefined)
      if (own === undefined) continue
      if (!own) {
        const main = name === 'default' ? '' : await agentZone('default').catch(() => '')
        await writeTimezone(name, main || browserTimeZone())
        updated.push(name)
      }
      checked.add(name)
    }
    if (restart && isStale()) void refreshRunner()
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
