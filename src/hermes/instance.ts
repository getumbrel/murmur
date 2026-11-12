// Which Hermes each thing is for.
//
// A Murmur can be connected to several Hermes (one on an Umbrel, one on a
// VPS), and the app uses all of them at once: every server's agents sit in one
// list, and each request goes to the Hermes its agent lives on. The server
// sends the list with the page (the `murmur_servers` cookie), so it's known
// here before anything else loads.
//
// An agent's id says where it lives. On the first Hermes it is the profile's
// name, as it always was ("atlas"); on any other it carries that Hermes's id
// ("k3f9~atlas"). So nothing changes for a Murmur with one Hermes, and two
// agents with one name on two servers never mix. Chats and groups keep
// Hermes's own ids, and Murmur remembers which Hermes each came from.
//
// What the browser keeps in local storage stays filed per Hermes, under the
// names it always had (`scoped`), with the plain profile names inside.

export const HERMES_HEADER = 'x-murmur-hermes'
export const HERMES_PARAM = 'hermes'
/** Fired when the server says the first Hermes was removed (in another tab or browser), or the list no longer starts where it did. */
export const HERMES_GONE = 'murmur:hermes-gone'

/** The browser's last choice, as its `murmur_hermes` cookie says now (from before every Hermes was used at once). */
export function browserHermes(): string | null {
  if (typeof document === 'undefined') return null
  const match = /(?:^|;\s*)murmur_hermes=([A-Za-z0-9]+)/.exec(document.cookie)
  return match?.[1] ?? null
}

/** Every Hermes, first one first, as the `murmur_servers` cookie says now. */
export function browserServers(): string[] {
  if (typeof document === 'undefined') return []
  const match = /(?:^|;\s*)murmur_servers=([A-Za-z0-9.]+)/.exec(document.cookie)
  return match ? match[1].split('.').filter(Boolean) : []
}

// Where the server didn't send the list with the page (development, where
// Vite serves it): the one the browser was on, until the app has asked.
let servers: string[] = (() => {
  const listed = browserServers()
  if (listed.length) return listed
  const one = browserHermes()
  return one ? [one] : []
})()

/**
 * A notification's link names the Hermes it's from (?hermes=<id>) and the
 * agent as that Hermes knows it. The address becomes the agent's own here
 * (`hrefOn`), before anything reads it.
 */
export const linkedHermes: string | null =
  typeof location !== 'undefined' ? new URLSearchParams(location.search).get(HERMES_PARAM) : null

/** Every Hermes this app is using, first one first. */
export const hermesIds = (): readonly string[] => servers

/** The first Hermes: its agents keep their plain names, and anything that names no agent goes to it. Null until the server has named one (a first visit in development). */
export const firstHermes = (): string | null => servers[0] ?? null

/**
 * The list as the server has it now. False when the first one changed: ids
 * made before would mean another Hermes's agents, so the app has to start over.
 */
export function setHermesIds(ids: readonly string[]) {
  if (!ids.length || ids.join() === servers.join()) return true
  if (ids[0] !== servers[0]) {
    // Carry on only where nothing made so far would change its meaning: none was known and the first
    // files things where the app has been looking, or a first run's default became the Hermes just set up.
    if (servers.length > 1 || scopeOf(ids[0]) !== scopeOf(servers[0])) return false
  }
  servers = [...ids]
  for (const heard of [...listeners]) heard()
  return true
}

const listeners = new Set<() => void>()

/** Hear when the list changes (a Hermes added or removed). Returns a function that stops listening. */
export function onHermesIds(heard: () => void) {
  listeners.add(heard)
  return () => void listeners.delete(heard)
}

// ── Whose is it ─────────────────────────────────────────────────────────────

const SEP = '~'

/** An agent's id: its profile's name on the first Hermes, `<hermes>~<profile>` on any other. */
export function agentIdOn(hermes: string | null | undefined, profile: string) {
  return !hermes || hermes === servers[0] ? profile : `${hermes}${SEP}${profile}`
}

/** Where an agent lives and what Hermes calls it. A name with no server in it is on the first. */
export function placeOf(agentId: string): { hermes: string | null; profile: string } {
  const at = agentId.indexOf(SEP)
  if (at > 0) {
    const hermes = agentId.slice(0, at)
    if (servers.includes(hermes)) return { hermes, profile: agentId.slice(at + 1) }
  }
  return { hermes: servers[0] ?? null, profile: agentId }
}

/** The Hermes an agent lives on. */
export const hermesOf = (agentId: string) => placeOf(agentId).hermes

/** What Hermes calls an agent: its profile's name. */
export const profileOf = (agentId: string) => placeOf(agentId).profile

/** An agent's id on its own Hermes turned into its id here: 'atlas' from Hermes k3f9 is 'k3f9~atlas' unless k3f9 is the first. */
const fromHermes = (hermes: string, profile: string) => (servers.includes(hermes) ? agentIdOn(hermes, profile) : profile)

/**
 * A link as one Hermes would write it (a notification's: "/chat/atlas/…"),
 * as it reads here, where every Hermes's agents are side by side.
 */
export function hrefOn(href: string, hermes: string | null | undefined) {
  if (!hermes) return href
  const group = /^\/group\/([^/?#]+)/.exec(href)
  if (group) noteHome(decodeURIComponent(group[1]), hermes)
  return href.replace(/^(\/(?:chat|chats|agent)\/)([^/?#]+)(?:\/([^/?#]+))?/, (_, head: string, agent: string, chat?: string) => {
    if (chat && chat !== 'new') noteHome(decodeURIComponent(chat), hermes)
    return head + encodeURIComponent(fromHermes(hermes, decodeURIComponent(agent))) + (chat ? `/${chat}` : '')
  })
}

/** What every Hermes calls its main agent's profile. */
const MAIN = 'default'

/** A Hermes's main agent. */
export const mainOn = (hermes: string | null | undefined) => agentIdOn(hermes, MAIN)

/** The main agent of the Hermes an agent lives on: what's set once per Hermes is set on it. */
export const mainFor = (agentId: string) => mainOn(hermesOf(agentId))

/** Whether an agent is its Hermes's main one. */
export const isMain = (agentId: string) => profileOf(agentId) === MAIN

/** Agents by the Hermes they live on, in the order given. */
export function byHermes(agentIds: readonly string[]) {
  const all = new Map<string | null, string[]>()
  for (const id of agentIds) {
    const hermes = hermesOf(id)
    all.set(hermes, [...(all.get(hermes) ?? []), id])
  }
  return all
}

/** Whether two agents live on the same Hermes. */
export const sameHermes = (a: string, b: string) => hermesOf(a) === hermesOf(b)

// Chats, live sessions and groups keep the ids Hermes gave them. Each is
// noted with the Hermes it came from as it arrives, so a call that names only
// a chat still finds its way.
const homes = new Map<string, string>()

export function noteHome(id: unknown, hermes: string | null | undefined) {
  if (hermes && typeof id === 'string' && id) homes.set(id, hermes)
}

/** The Hermes a chat, live session or group came from, if Murmur has seen it. */
export const homeOf = (id: unknown) => (typeof id === 'string' ? homes.get(id) : undefined)

// Opened from a notification: the address named its Hermes; from here on it names the agent as it is here.
if (linkedHermes !== null && typeof history !== 'undefined') {
  const url = new URL(location.href)
  url.searchParams.delete(HERMES_PARAM)
  history.replaceState(history.state, '', hrefOn(url.pathname, linkedHermes) + url.search + url.hash)
}

// ── What the browser keeps ──────────────────────────────────────────────────

// The original Hermes (the one set by the server, or the first set up in the
// app, or the umbrelOS default before either) keeps the browser's original,
// unprefixed storage, so nothing anyone had before is lost. The server never
// lets two of these exist at once.
const ORIGINAL = new Set(['env', 'main', 'default'])
/** What a Hermes's things are filed under on this device: '' for the original. */
export const scopeOf = (id: string | null | undefined) => (!id || ORIGINAL.has(id) ? '' : id)

/**
 * A local-storage key for one Hermes's things: 'murmur:seen' stays as it is
 * for the original Hermes and becomes 'murmur@<id>:seen' for others. Without
 * a Hermes, the first.
 */
export const scoped = (key: string, hermes: string | null = firstHermes()) => {
  const scope = scopeOf(hermes)
  return scope ? key.replace(/^murmur:/, `murmur@${scope}:`) : key
}

/**
 * Carry on with `id` as the only Hermes without a reload, when it files
 * things in the same place (a first run's default becoming the Hermes just
 * set up). False when a reload is needed.
 */
export function adoptHermes(id: string) {
  if (servers.includes(id)) return true
  if (servers.length > 1 || scopeOf(id) !== scopeOf(servers[0])) return false
  servers = [id]
  return true
}

/** Forget what this browser kept under `key` ('murmur:…') for every Hermes, as signing out of Murmur locks them all. */
export function forgetForEveryHermes(key: string) {
  const name = key.replace(/^murmur:/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const filed = new RegExp(`^murmur(@[A-Za-z0-9]+)?:${name}$`)
  try {
    for (const stored of Object.keys(localStorage)) if (filed.test(stored)) localStorage.removeItem(stored)
  } catch {
    // Private mode: nothing was kept.
  }
}

/** Forget what this browser kept for a removed Hermes. */
export function forgetHermesStorage(id: string) {
  const scope = scopeOf(id)
  if (!scope) return
  try {
    for (const store of [localStorage, sessionStorage]) {
      for (const key of Object.keys(store)) if (key.startsWith(`murmur@${scope}:`)) store.removeItem(key)
    }
  } catch {
    // Private mode: nothing was kept.
  }
}
