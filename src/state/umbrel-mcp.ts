// Connecting agents to their Umbrel. umbrelOS runs an MCP server that lets
// agents manage apps, files and more (Settings → AI agents (MCP)); it hands out
// a key, and Hermes needs that key added to each agent, since its MCP servers
// are per agent. Asking an agent to add it itself is unreliable (Hermes's own
// tools forbid editing that config) and sends the key to the model provider.
// So Murmur adds it through Hermes's MCP API: the key goes to each agent's
// .env, its config only refers to it, and no chat ever sees it.
//
// Only offered where Hermes runs on an Umbrel, which its main agent's Umbrel
// context says (umbrel-context.ts). Agents made later get it from the main
// agent's copy of the key. With several Hermes, it's the one on an Umbrel
// whose agents this is about: each agent takes after its own Hermes's main.
//
// Other Umbrels (one at the office, reached over Tailscale) connect the same
// way, at the address you give, each as a server of its own ("umbrel_office"),
// so its tools, cards and links say which Umbrel they're from.

import { useEffect, useMemo } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, HermesError } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import { byHermes, firstHermes, hermesOf, isMain, mainFor, mainOn, scoped } from '@/hermes/instance'
import { safariLink, umbrelApp } from '@/lib/device'
import { rememberedSet, upkeep } from '@/lib/upkeep'
import { useHermesIds, useServer } from '@/state/connection'
import { umbrelContextOf } from './umbrel-context'

/** The main agent of the Hermes these agents live on (the first Hermes's, with none to go by). */
const mainOf = (ids: readonly string[]) => (ids.length ? mainFor(ids[0]) : mainOn(firstHermes()))
export const UMBREL_SERVER = 'umbrel'
/** Where app containers reach umbrelOS (umbrel.local doesn't resolve inside one). */
export const UMBREL_MCP_URL = 'http://10.21.0.1/mcp'
/** Where Hermes keeps a server's key (mcp_config._env_key_for_server). */
const envKeyOf = (name: string) => `MCP_${name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_API_KEY`
const KEY_ENV = envKeyOf('umbrel')
const KEY = /umbrelmcp_[0-9a-f]{32}_[0-9a-f]{64}/

/** The key in whatever umbrelOS showed (a message, a snippet, the key alone), or null. */
export function findUmbrelKey(text: string): string | null {
  return text.match(KEY)?.[0] ?? null
}

// umbrelOS's "Connect in Murmur" opens /settings/umbrel#token=…: a fragment,
// so the key never reaches a server or a log. It's taken the moment Murmur
// loads (before anything redirects) and wiped from the address bar at once;
// Settings → Umbrel then offers it, and connecting is the person's own tap.
// Only the key is used: the server is always umbrelOS's own address, so a
// crafted link can't point agents anywhere else.
let handoff: string | null = null
if (typeof location !== 'undefined' && /(^#|&)token=/.test(location.hash)) {
  const key = new URLSearchParams(location.hash.slice(1)).get('token')
  handoff = key && /^umbrelmcp_[0-9a-f]{32}_[0-9a-f]{64}$/.test(key) ? key : null
  history.replaceState(history.state, '', location.pathname + location.search)
}

/**
 * The key umbrelOS handed over, if it hasn't been used. Reading leaves it in
 * place: React can render (and throw away) a screen more than once before it
 * shows, so the screen that does show clears it, with `clearHandoffKey`.
 */
export const handoffKey = () => handoff

export function clearHandoffKey() {
  handoff = null
}

/** "umbrelmcp_9831…cd96a": enough to recognise, not enough to use. */
export const maskKey = (key: string) => `${key.slice(0, 14)}…${key.slice(-5)}`

export type UmbrelPlace = {
  /** "this Umbrel" when Murmur runs on it too, else "your Umbrel". */
  name: 'this Umbrel' | 'your Umbrel'
  /** umbrelOS's own page for this, on that Umbrel. */
  settingsUrl: string
}

/**
 * The Umbrel a Hermes runs on, from Murmur's address for it. A container's
 * name (an underscore, which no real host name has) is Hermes beside Murmur,
 * on the Umbrel this page came from. Any other address means Murmur runs
 * somewhere else (the desktop app, or Murmur on its own) and reaches that
 * Umbrel over the network, where umbrelOS answers on the same host.
 */
export function umbrelOf(hermesUrl: string | undefined, page: Pick<Location, 'protocol' | 'hostname'> = location): UmbrelPlace {
  let url: URL | null = null
  try {
    url = hermesUrl ? new URL(hermesUrl) : null
  } catch {
    // Unreadable: taken as beside Murmur.
  }
  const beside = !url || url.hostname.includes('_')
  const { protocol, hostname } = beside ? page : url!
  return { name: beside ? 'this Umbrel' : 'your Umbrel', settingsUrl: `${protocol}//${hostname}/settings/mcp` }
}

/**
 * Opens a page of umbrelOS. The umbrelOS iPhone app means to close Murmur and
 * show it, but for now it only changes umbrelOS behind Murmur's page, so a new
 * window there seems to do nothing: from the app, it's Safari until that's
 * fixed. A click on a link, since the app asks first when a page goes to
 * another app by itself.
 */
export function openUmbrelPage(url: string) {
  if (!umbrelApp) return void window.open(url, '_blank', 'noopener')
  const link = document.createElement('a')
  link.href = safariLink(url)
  link.click()
}

/** The Umbrel a Hermes runs on: an agent's (`hermesOf(agentId)`), or the one that's on an Umbrel. */
export function useUmbrel(hermes?: string | null) {
  const onUmbrel = useUmbrelHermes()
  return umbrelOf(useServer(hermes === undefined ? onUmbrel : hermes)?.url)
}

const q = (profile: string) => `profile=${encodeURIComponent(profile)}`

type Server = { name: string; enabled?: boolean; source?: string; url?: string | null }

const serversOf = async (profile: string) => (await api.get<{ servers: Server[] }>(`/api/mcp/servers?${q(profile)}`)).servers

async function hasUmbrel(profile: string) {
  return (await serversOf(profile)).some((s) => s.name === UMBREL_SERVER && s.enabled !== false)
}

// ── Other Umbrels ───────────────────────────────────────────────────────────

/** Another Umbrel the agents use, by its server's name ("umbrel_office") and address. */
export type OtherUmbrel = { name: string; label: string; url: string; origin: string }

const OTHER = /^umbrel_[a-z0-9_]+$/
export const isOtherUmbrel = (name: string) => OTHER.test(name)

/** "umbrel_office" → "Umbrel Office". */
export const otherLabel = (name: string) =>
  `Umbrel ${name.replace(/^umbrel_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`

/**
 * What you typed, as umbrelOS's MCP address: "100.64.0.5", "umbrel-pro.local",
 * or a full URL. Null when it isn't an address at all.
 */
export function otherUmbrelUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`)
    if (!/^https?:$/.test(url.protocol) || !url.hostname) return null
    if (url.pathname === '/' || !url.pathname) url.pathname = '/mcp'
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

/** A server name for an Umbrel at that address, unless you name it: "umbrel-pro.local" → "umbrel_pro". */
export function otherUmbrelName(url: string, named?: string) {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const host = new URL(url).hostname
  // An IP says nothing about which Umbrel it is.
  const fromHost = /^[\d.]+$|:/.test(host) ? 'other' : slug(host.replace(/\.(local|ts\.net|lan|home)$/i, '').split('.')[0])
  const base = named?.trim() ? slug(named) : fromHost
  const rest = base.replace(/^umbrel(_|$)/, '')
  return `umbrel_${rest || 'other'}`
}

/** The other Umbrels, from the main agent's servers: of the Hermes on an Umbrel, or of one agent's (`hermesOf(agentId)`). */
export function useOtherUmbrels(enabled = true, hermes?: string | null) {
  const onUmbrel = useUmbrelHermes()
  const of = hermes === undefined ? onUmbrel : hermes
  return useQuery({
    queryKey: ['other-umbrels', of ?? ''],
    enabled: enabled && of !== undefined,
    queryFn: async (): Promise<OtherUmbrel[]> =>
      (await serversOf(mainOn(of))).flatMap((s) =>
        isOtherUmbrel(s.name) && s.url ? [{ name: s.name, label: otherLabel(s.name), url: s.url, origin: new URL(s.url).origin }] : [],
      ),
    staleTime: 60_000,
  })
}

/** Every Hermes that runs on an Umbrel: its main agent has the Umbrel context. ('' is a Hermes the server hasn't named yet.) Undefined until the first has answered. */
function useUmbrelHermeses(): string[] | undefined {
  const ids = useHermesIds()
  const asked = useQueries({
    queries: (ids.length ? ids : [null]).map((hermes) => ({
      queryKey: ['hermes-on-umbrel', hermes ?? ''],
      queryFn: async () => {
        const main = await api.get<Parameters<typeof umbrelContextOf>[0]>(`/api/config?${q(mainOn(hermes))}&include_defaults=false`)
        const context = umbrelContextOf(main)
        return context.plugin || context.skills.length > 0
      },
      staleTime: 10 * 60_000,
    })),
  })
  const key = asked.map((a) => (a.data === undefined ? '?' : a.data ? '1' : '0')).join('')
  return useMemo(
    // One that can't be asked right now doesn't hold up the rest; the first is waited for, as it always was.
    () => (key[0] === '?' && !asked[0]?.isError ? undefined : (ids.length ? ids : ['']).filter((_, i) => key[i] === '1')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, ids, asked[0]?.isError],
  )
}

/** The Hermes that runs on an Umbrel (the first that does): null when none does, undefined until that's known. */
export function useUmbrelHermes(): string | null | undefined {
  const on = useUmbrelHermeses()
  return on === undefined ? undefined : on.length ? on[0] || firstHermes() : null
}

/** Whether a Hermes runs on an Umbrel: an agent's (`hermesOf(agentId)`), or any of them. */
export function useHermesOnUmbrel(hermes?: string | null) {
  const on = useUmbrelHermeses()
  return { data: on === undefined ? undefined : hermes === undefined ? on.length > 0 : on.includes(hermes ?? '') }
}

export const umbrelMcpKey = (ids: readonly string[]) => ['umbrel-mcp', ...ids] as const

/** Which agents can use the Umbrel. */
export function useUmbrelMcp(ids: readonly string[] | undefined, enabled = true) {
  return useQuery({
    queryKey: umbrelMcpKey(ids ?? []),
    enabled: enabled && !!ids?.length,
    queryFn: async () => {
      const on = await Promise.all(ids!.map((id) => hasUmbrel(id).catch(() => false)))
      return { connected: ids!.filter((_, i) => on[i]) }
    },
    staleTime: 30_000,
  })
}

async function add(profile: string, key: string, name = UMBREL_SERVER, url = UMBREL_MCP_URL) {
  const body = { name, url, auth: 'header', bearer_token: key, profile }
  try {
    await api.post(`/api/mcp/servers?${q(profile)}`, body)
  } catch (e) {
    // Already there (an older key): replace it.
    if (!(e instanceof HermesError && e.status === 409)) throw e
    await remove(profile, name)
    await api.post(`/api/mcp/servers?${q(profile)}`, body)
  }
}

type ServersConfig = { mcp_servers?: Record<string, { trust?: unknown } | undefined> }

/**
 * Agents use the Umbrel without asking first. Hermes's only way to ask is
 * marking the server 'trust: untrusted', and then it asks before every call
 * that isn't read-only, each on its own with no "always": a tap for every key
 * an agent presses with umbrelOS's control_machine. Murmur 0.5.1 to 0.7 set
 * that mark; this takes it off, once per agent, so one set on purpose stays.
 */
export async function stopAskingFirst(profile: string) {
  const config = await api.get<ServersConfig>(`/api/config?${q(profile)}&include_defaults=false`)
  if (config.mcp_servers?.[UMBREL_SERVER]?.trust !== 'untrusted') return false
  // Deep-merged into the agent's config, so the server keeps its address and
  // key. 'full' is Hermes's default: a merge can't drop the key, and null
  // would leave a bare 'trust:' behind.
  await api.put(`/api/config?${q(profile)}`, { config: { mcp_servers: { [UMBREL_SERVER]: { trust: 'full' } } } })
  return true
}

/** Takes the server away, and its key with it: Hermes leaves the key in .env otherwise. */
async function remove(profile: string, name = UMBREL_SERVER) {
  try {
    await api.delete(`/api/mcp/servers/${name}?${q(profile)}`)
  } catch (e) {
    if (!(e instanceof HermesError && e.status === 404)) throw e
  }
  await api.delete(`/api/env?${q(profile)}`, { key: envKeyOf(name), profile }).catch(() => {})
}

/** Running chats pick up the change now rather than on their next start. On the Hermes these agents live on. */
const reload = (ids: readonly string[]) => rpc('reload.mcp', { confirm: true }, undefined, hermesOf(mainOf(ids))).catch(() => {})

export class UmbrelKeyError extends Error {}
/** Hermes couldn't reach the Umbrel at all: the address, not the key. */
export class UmbrelUnreachableError extends Error {}

/** Tries a key (at an address) under a name of its own, so a bad one never replaces a good one. */
async function check(main: string, key: string, name: string, url: string) {
  const trial = `${name}-check`
  await add(main, key, trial, url)
  let probe: { ok: boolean; error?: string }
  try {
    probe = await api.post<{ ok: boolean; error?: string }>(`/api/mcp/servers/${trial}/test?${q(main)}`, {})
  } finally {
    await remove(main, trial).catch(() => {})
  }
  if (probe.ok) return
  const why = probe.error ?? ''
  if (/connect|resolve|unreachable|refused|timed? ?out|name or service|no route|getaddrinfo|network/i.test(why)) throw new UmbrelUnreachableError(why)
  throw new UmbrelKeyError(why || 'umbrelOS didn’t accept that key.')
}

/** Connects every agent to another Umbrel, once Hermes has reached it with that key. */
export async function connectOtherUmbrel(url: string, key: string, ids: readonly string[], name = otherUmbrelName(url)) {
  const main = mainOf(ids)
  await check(main, key, name, url)
  for (const id of [main, ...ids.filter((id) => id !== main)]) await add(id, key, name, url)
  await reload(ids)
  return name
}

/** Takes another Umbrel away from every agent. */
export async function disconnectOtherUmbrel(name: string, ids: readonly string[]) {
  for (const id of new Set([mainOf(ids), ...ids])) await remove(id, name)
  await reload(ids)
}

/**
 * Checks the key against umbrelOS, then gives it to every agent. `onAgent`
 * hears as each one is done. Throws UmbrelKeyError when umbrelOS turns the key
 * down, before any agent's connection changes.
 */
export async function connectUmbrel(key: string, ids: readonly string[], onAgent?: (id: string) => void) {
  const main = mainOf(ids)
  await check(main, key, UMBREL_SERVER, UMBREL_MCP_URL).catch((e) => {
    throw e instanceof UmbrelUnreachableError ? new UmbrelKeyError(e.message) : e
  })
  const order = [main, ...ids.filter((id) => id !== main)]
  for (const id of order) {
    await add(id, key)
    synced.add(id)
    onAgent?.(id)
  }
  await reload(ids)
}

/** Takes the Umbrel away from every agent. */
export async function disconnectUmbrel(ids: readonly string[]) {
  for (const id of ids) await remove(id)
  synced.clear()
  await reload(ids)
}

/** The main agent's key (for this Umbrel, or another), for agents made since. */
async function mainKey(main: string, name = UMBREL_SERVER): Promise<string | null> {
  try {
    const env = name === UMBREL_SERVER ? KEY_ENV : envKeyOf(name)
    const { value } = await api.post<{ value?: string }>(`/api/env/reveal?${q(main)}`, { key: env, profile: main })
    return value ? findUmbrelKey(value) : null
  } catch {
    return null
  }
}

// Agents known to have it (or known not to need it), across reloads for a day.
const synced = rememberedSet(scoped('murmur:umbrel-mcp'))
// Agents whose Umbrel server no longer asks first. Kept for good: it's done once.
const unmarked = rememberedSet(scoped('murmur:umbrel-asks-not'), Infinity)

async function unmarkAll(ids: string[]) {
  let changed = false
  for (const id of ids) {
    if (unmarked.has(id)) continue
    try {
      changed = (await stopAskingFirst(id)) || changed
      unmarked.add(id)
    } catch {
      // Unreadable: tried again on the next load.
    }
  }
  if (changed) await reload(ids)
}

/** Each Hermes's agents catch up with its own main agent. */
async function catchUp(all: string[]) {
  for (const ids of byHermes(all).values()) await catchUpOn(ids).catch(() => {})
}

async function catchUpOn(ids: string[]) {
  const main = mainOf(ids)
  await unmarkAll(ids)
  const missing = ids.filter((id) => !isMain(id) && !synced.has(id))
  if (!missing.length) return
  // This Umbrel and any others the main agent has.
  const shared = (await serversOf(main)).filter((s) => (s.name === UMBREL_SERVER || isOtherUmbrel(s.name)) && s.enabled !== false && s.url)
  // Nothing to share; look again once it's connected.
  if (!shared.length) return
  const keys = new Map<string, string | null>()
  for (const id of missing) {
    const has = new Set((await serversOf(id).catch(() => null))?.map((s) => s.name) ?? shared.map((s) => s.name))
    for (const server of shared) {
      if (has.has(server.name)) continue
      if (!keys.has(server.name)) keys.set(server.name, await mainKey(main, server.name))
      const key = keys.get(server.name)
      if (key) await add(id, key, server.name, server.url!).catch(() => {})
    }
    synced.add(id)
  }
}

/** Gives one new agent the Umbrel, if the main agent has it. Call after creating an agent. */
export async function ensureUmbrelMcp(profile: string) {
  await catchUp([profile])
}

/**
 * Gives agents made since (here or in another app) the main agent's Umbrel
 * connection. Mount once. Quiet: idle-time, one request at a time, and nothing
 * once every agent is known to have it.
 */
export function useUmbrelMcpSync(agentIds: readonly string[] | undefined) {
  const qc = useQueryClient()
  // Only agents on a Hermes that's on an Umbrel have anything to catch up with.
  const onUmbrel = useUmbrelHermeses()
  const key = agentIds?.join('\n') ?? ''
  useEffect(() => {
    const ids = (key ? key.split('\n') : []).filter((id) => onUmbrel?.includes(hermesOf(id) ?? ''))
    if (!ids.some((id) => (!isMain(id) && !synced.has(id)) || !unmarked.has(id))) return
    void upkeep(() => catchUp(ids))
      .then(() => qc.invalidateQueries({ queryKey: ['umbrel-mcp'] }))
      .catch(() => {})
  }, [key, onUmbrel, qc])
}
