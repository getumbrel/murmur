// What the browser keeps per Hermes, read and written by agent id.
//
// Each Hermes's things stay filed under its own key (`scoped`), with the
// plain profile names Hermes uses inside, exactly as they were kept when the
// app used one Hermes at a time. In memory they're one record by agent id.

import { agentIdOn, firstHermes, hermesIds, homeOf, placeOf, scoped } from './instance'

const every = (): (string | null)[] => (hermesIds().length ? [...hermesIds()] : [null])

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? undefined : (JSON.parse(raw) as T)
  } catch {
    return undefined
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode: kept for this page load only.
  }
}

/** One Hermes's value under `key` ('murmur:…'). */
export const keptOn = <T>(key: string, hermes: string | null = firstHermes()) => read<T>(scoped(key, hermes))

/** Keep (or, with undefined, forget) one Hermes's value under `key`. */
export const keepOn = (key: string, hermes: string | null, value: unknown) => write(scoped(key, hermes), value)

/**
 * A record by agent id, kept per Hermes: `all()` is every Hermes's as one,
 * `set(agentId, value)` writes to the agent's own Hermes (undefined forgets).
 */
export function keptByAgent<T>(key: string) {
  const of = (hermes: string | null) => {
    const kept = keptOn<Record<string, T>>(key, hermes)
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {}
  }
  return {
    all(): Record<string, T> {
      const out: Record<string, T> = {}
      for (const hermes of every()) for (const [name, value] of Object.entries(of(hermes))) out[agentIdOn(hermes, name)] = value
      return out
    },
    get: (agentId: string): T | undefined => {
      const { hermes, profile } = placeOf(agentId)
      return of(hermes)[profile]
    },
    set(agentId: string, value: T | undefined) {
      const { hermes, profile } = placeOf(agentId)
      const next = { ...of(hermes) }
      if (value === undefined) delete next[profile]
      else next[profile] = value
      keepOn(key, hermes, next)
    },
  }
}

/**
 * A record by chat or group id (Hermes's own ids), kept per Hermes: `all()`
 * is every Hermes's as one, `set(id, value)` writes to the Hermes the chat or
 * group came from (the first, while that isn't known).
 */
export function keptByHome<T>(key: string) {
  const of = (hermes: string | null) => {
    const kept = keptOn<Record<string, T>>(key, hermes)
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {}
  }
  return {
    all(): Record<string, T> {
      const all = every()
      return all.length === 1 ? of(all[0]) : Object.assign({}, ...all.map(of).reverse())
    },
    set(id: string, value: T | undefined) {
      const hermes = homeOf(id) ?? firstHermes()
      const next = { ...of(hermes) }
      if (value === undefined) delete next[id]
      else next[id] = value
      keepOn(key, hermes, next)
    },
  }
}

/**
 * The storage key for one chat's or group's thing (`prefix` then `name`), with
 * the Hermes that chat or group (`id`) came from. While that isn't known (a
 * link straight to a chat, before any list is in): wherever it's kept already,
 * else the first.
 */
export function keyForChat(prefix: string, id: string, name = id) {
  const home = homeOf(id)
  if (home || hermesIds().length < 2) return scoped(prefix, home ?? firstHermes()) + name
  try {
    for (const hermes of hermesIds()) {
      const key = scoped(prefix, hermes) + name
      if (localStorage.getItem(key) !== null) return key
    }
  } catch {
    // Private mode: nothing is kept anywhere.
  }
  return scoped(prefix) + name
}

/** The storage key for one agent's thing (`prefix`, its profile's name, then `rest`), with its own Hermes. */
export function keyForAgent(prefix: string, agentId: string, rest = '') {
  const { hermes, profile } = placeOf(agentId)
  return scoped(prefix, hermes) + profile + rest
}

/** Every Hermes the app has (one null where the server hasn't named any yet). */
export const everyHermes = every
