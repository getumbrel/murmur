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
// agent's copy of the key.

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, HermesError } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import { scoped } from '@/hermes/instance'
import { rememberedSet, upkeep } from '@/lib/upkeep'
import { useHermesConnection } from '@/state/connection'
import { umbrelContextOf } from './umbrel-context'

const MAIN = 'default'
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

/** The Umbrel this browser's Hermes runs on. */
export const useUmbrel = () => umbrelOf(useHermesConnection().connection?.url)

const q = (profile: string) => `profile=${encodeURIComponent(profile)}`

type Server = { name: string; enabled?: boolean; source?: string }

async function hasUmbrel(profile: string) {
  const { servers } = await api.get<{ servers: Server[] }>(`/api/mcp/servers?${q(profile)}`)
  return servers.some((s) => s.name === UMBREL_SERVER && s.enabled !== false)
}

/** Whether this Hermes runs on an Umbrel: its main agent has the Umbrel context. */
export function useHermesOnUmbrel() {
  return useQuery({
    queryKey: ['hermes-on-umbrel'],
    queryFn: async () => {
      const main = await api.get<Parameters<typeof umbrelContextOf>[0]>(`/api/config?${q(MAIN)}&include_defaults=false`)
      const context = umbrelContextOf(main)
      return context.plugin || context.skills.length > 0
    },
    staleTime: 10 * 60_000,
  })
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

async function add(profile: string, key: string, name = UMBREL_SERVER) {
  const body = { name, url: UMBREL_MCP_URL, auth: 'header', bearer_token: key, profile }
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

/** Running chats pick up the change now rather than on their next start. */
const reload = () => rpc('reload.mcp', { confirm: true }).catch(() => {})

export class UmbrelKeyError extends Error {}

/**
 * Checks the key against umbrelOS, then gives it to every agent. `onAgent`
 * hears as each one is done. Throws UmbrelKeyError when umbrelOS turns the key
 * down, before any agent's connection changes.
 */
export async function connectUmbrel(key: string, ids: readonly string[], onAgent?: (id: string) => void) {
  // Tried under a name of its own first, so a bad key never replaces a good one.
  const trial = `${UMBREL_SERVER}-check`
  await add(MAIN, key, trial)
  let probe: { ok: boolean; error?: string }
  try {
    probe = await api.post<{ ok: boolean; error?: string }>(`/api/mcp/servers/${trial}/test?${q(MAIN)}`, {})
  } finally {
    await remove(MAIN, trial).catch(() => {})
  }
  if (!probe.ok) throw new UmbrelKeyError(probe.error || 'umbrelOS didn’t accept that key.')
  const order = [MAIN, ...ids.filter((id) => id !== MAIN)]
  for (const id of order) {
    await add(id, key)
    synced.add(id)
    onAgent?.(id)
  }
  await reload()
}

/** Takes the Umbrel away from every agent. */
export async function disconnectUmbrel(ids: readonly string[]) {
  for (const id of ids) await remove(id)
  synced.clear()
  await reload()
}

/** The main agent's key, for agents made since. */
async function mainKey(): Promise<string | null> {
  try {
    const { value } = await api.post<{ value?: string }>(`/api/env/reveal?${q(MAIN)}`, { key: KEY_ENV, profile: MAIN })
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
  if (changed) await reload()
}

async function catchUp(ids: string[]) {
  await unmarkAll(ids)
  const missing = ids.filter((id) => id !== MAIN && !synced.has(id))
  if (!missing.length) return
  if (!(await hasUmbrel(MAIN))) {
    // Nothing to share; look again once it's connected.
    return
  }
  let key: string | null | undefined
  for (const id of missing) {
    if (await hasUmbrel(id).catch(() => true)) {
      synced.add(id)
      continue
    }
    key ??= await mainKey()
    if (!key) return
    await add(id, key).catch(() => {})
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
  const onUmbrel = useHermesOnUmbrel().data
  const key = agentIds?.join('\n') ?? ''
  useEffect(() => {
    const ids = key ? key.split('\n') : []
    if (!onUmbrel || !ids.some((id) => (id !== MAIN && !synced.has(id)) || !unmarked.has(id))) return
    void upkeep(() => catchUp(ids))
      .then(() => qc.invalidateQueries({ queryKey: ['umbrel-mcp'] }))
      .catch(() => {})
  }, [key, onUmbrel, qc])
}
