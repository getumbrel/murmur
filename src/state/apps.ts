// Apps an agent can use: Hermes's catalog of MCP servers (Notion, Linear,
// Todoist…), each hosted by the app's maker and mostly signed into with
// OAuth. MCP servers are per agent (each profile keeps its own list and its
// own sign-ins), so everything here is for one agent.
//
// Connecting one: Murmur adds it from the catalog, then asks Hermes to start
// the sign-in. Hermes would send the app back to its own address, which the
// browser can't reach, so Murmur first sets the server's oauth.redirect_uri to
// its own relay for it (server/oauth-return.ts). The sign-in opens in a new
// tab, and this tab asks Hermes how it's going until the app's keys are saved.

import { create } from 'zustand'
import { useQueries, useQuery, type QueryClient } from '@tanstack/react-query'
import { api, HermesError } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import { isDesktop } from '@/lib/desktop'

export type CatalogApp = {
  name: string
  description: string
  auth_type: string
  required_env: { name: string; prompt: string; required: boolean }[]
  url: string | null
  needs_install: boolean
}

export type AppServer = { name: string; url?: string | null; auth?: string | null; enabled: boolean; source?: string }

type Flow = {
  flow_id: string
  status: 'starting' | 'authorization_required' | 'approved' | 'error'
  authorization_url?: string | null
  error?: string | null
}

const q = (profile: string) => `profile=${encodeURIComponent(profile)}`
const path = (name: string) => encodeURIComponent(name)

// ── The catalog ─────────────────────────────────────────────────────────────

// Can't start a sign-in through Hermes (checked against 0.22): they only take
// apps they've approved (Algolia, Dropbox, Strava), want a developer app of
// your own (Asana, Hugging Face), or turn down Hermes's request (Indeed, Semgrep).
const UNAVAILABLE = new Set(['algolia', 'asana', 'dropbox', 'hugging_face', 'indeed', 'semgrep', 'strava'])

// Everyday apps lead, roughly by how many people use them; developer tools follow.
const EVERYDAY = [
  'notion',
  'todoist',
  'canva',
  'figma',
  'linear',
  'airtable',
  'calendly',
  'miro',
  'clickup',
  'monday',
  'atlassian',
  'gamma',
  'craft',
  'fireflies',
  'wordpress-com',
  'webflow',
  'paypal',
  'square',
  'stripe',
  'robinhood',
  'twelve-data',
  'wolfram',
  'kiwi',
  'trivago',
  'alltrails',
  'intercom',
  'attio',
  'close',
  'klaviyo',
  'comfy-cloud',
]

/** What's worth offering, split into everyday apps (in order) and developer tools. */
export function arrange(apps: CatalogApp[], nameOf: (name: string) => string) {
  const shown = apps.filter((a) => !UNAVAILABLE.has(a.name) && !a.needs_install)
  const rank = (a: CatalogApp) => EVERYDAY.indexOf(a.name)
  return {
    everyday: shown.filter((a) => rank(a) >= 0).sort((a, b) => rank(a) - rank(b)),
    developer: shown.filter((a) => rank(a) < 0).sort((a, b) => nameOf(a.name).localeCompare(nameOf(b.name))),
  }
}

/** Hermes's catalog. The same for every agent, so it's fetched once. */
export function useCatalog(enabled = true) {
  return useQuery({
    queryKey: ['apps-catalog'],
    enabled,
    queryFn: async () => (await api.get<{ entries: CatalogApp[] }>('/api/mcp/catalog')).entries,
    staleTime: 30 * 60_000,
  })
}

export const appsKey = (profile: string) => ['apps', profile] as const

/** The apps (MCP servers) an agent has. Ones a plugin brings along aren't the person's to change. */
export function useAgentApps(profile: string, enabled = true) {
  return useQuery({
    queryKey: appsKey(profile),
    enabled,
    queryFn: async () => {
      const { servers } = await api.get<{ servers: AppServer[] }>(`/api/mcp/servers?${q(profile)}`)
      return servers.filter((s) => s.source !== 'plugin')
    },
    staleTime: 30_000,
  })
}

// ── Whether each one works ──────────────────────────────────────────────────

export type Health = 'ok' | 'signin' | 'down'

export function healthOf(server: Pick<AppServer, 'auth'>, probe: { ok: boolean; error?: string }): Health {
  if (probe.ok) return 'ok'
  if (server.auth === 'oauth' && /oauth|token|authori[sz]|regist|redirect/i.test(probe.error ?? '')) return 'signin'
  return 'down'
}

// Hermes's test connects to the app for real, and stumbles when several run at once: one at a time.
let line: Promise<unknown> = Promise.resolve()
function inLine<T>(run: () => Promise<T>): Promise<T> {
  const next = line.then(run, run)
  line = next.catch(() => {})
  return next
}

/** How each switched-on app is doing; undefined while checking, or when Hermes couldn't say. */
export function useAppHealth(profile: string, servers: AppServer[] | undefined, enabled = true) {
  const on = (servers ?? []).filter((s) => s.enabled && s.name !== 'umbrel')
  const results = useQueries({
    queries: on.map((s) => ({
      queryKey: ['apps-health', profile, s.name, s.url] as const,
      enabled,
      queryFn: () =>
        inLine(async () => {
          const probe = await api.post<{ ok: boolean; error?: string }>(
            `/api/mcp/servers/${path(s.name)}/test?${q(profile)}`,
          )
          return healthOf(s, probe)
        }),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  })
  return Object.fromEntries(on.map((s, i) => [s.name, results[i]?.data])) as Record<string, Health | undefined>
}

// ── Connecting ──────────────────────────────────────────────────────────────

export type Phase =
  /** Adding it to the agent and starting the sign-in. */
  | 'adding'
  /** The sign-in is open in another tab. */
  | 'signing-in'
  /** The browser wouldn't open the tab: it takes a tap. */
  | 'blocked'
  | 'done'
  | 'failed'

export type Connection = { phase: Phase; url?: string; flowId?: string; message?: string; added?: boolean }

type Store = Record<string, Connection>
export const useConnections = create<Store>(() => ({}))
const keyOf = (profile: string, app: string) => `${profile}\n${app}`
const patch = (key: string, next: Connection | null) =>
  useConnections.setState((all) => {
    const copy = { ...all }
    if (next) copy[key] = next
    else delete copy[key]
    return copy
  }, true)

export const useConnection = (profile: string, app: string | undefined) =>
  useConnections((all) => (app ? all[keyOf(profile, app)] : undefined))

/** Where the app sends the browser back: Murmur's relay to Hermes. */
export const returnUrl = (origin: string, app: string) => `${origin}/hermes/api/mcp/oauth/callback/${path(app)}`

/** What went wrong, in a sentence for the person. `secure`: Murmur is on https or this computer. */
export function friendlyError(name: string, raw: string, secure: boolean) {
  if (/pre-approved|manually-registered|registration \(403\)/i.test(raw))
    return `${name} doesn’t let Hermes sign in to it yet.`
  if (/https|redirect.?uri/i.test(raw))
    return secure
      ? `${name} didn’t accept Murmur’s address.`
      : `${name} only signs in on a secure address. Open Murmur over https to connect it.`
  if (/expired|timed? ?out|not found/i.test(raw)) return 'The sign-in took too long. Try again.'
  return `Couldn’t connect ${name}. Try again in a moment.`
}

const secureHere = () => location.protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)

/**
 * A tab opened in the tap itself, since browsers block ones opened later. It
 * says "Opening Notion…" until the sign-in is ready. The desktop app opens
 * sign-ins in the person's browser instead, so there's none.
 */
export function openSignInTab(name: string): Window | null {
  if (isDesktop) return null
  const tab = window.open('', '_blank')
  if (!tab) return null
  try {
    tab.opener = null
    const doc = tab.document
    doc.title = name
    doc.documentElement.style.colorScheme = 'light dark'
    doc.body.style.cssText =
      'margin:0;height:100vh;display:grid;place-items:center;font:15px -apple-system,system-ui,sans-serif;color:GrayText;background:Canvas'
    doc.body.textContent = `Opening ${name}…`
  } catch {
    // It still opens the sign-in.
  }
  return tab
}

/** Shows the sign-in: in the tab opened for it, else a new one. False when the browser refused. */
export function showSignIn(url: string, tab?: Window | null) {
  if (tab && !tab.closed) {
    tab.location.replace(url)
    return true
  }
  const opened = window.open(url, '_blank')
  if (opened) opened.opener = null
  // The desktop app hands it to the browser and says no window opened.
  return !!opened || isDesktop
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function startSignIn(profile: string, app: string): Promise<Flow> {
  // A sign-in just cancelled holds its place for a moment.
  for (let i = 0; ; i++) {
    try {
      return await api.post<Flow>(`/api/mcp/servers/${path(app)}/auth?${q(profile)}`)
    } catch (e) {
      if (!(e instanceof HermesError && e.status === 409 && /in progress/i.test(e.message)) || i >= 4) throw e
      await wait(1200)
    }
  }
}

async function removeServer(profile: string, app: string) {
  try {
    await api.delete(`/api/mcp/servers/${path(app)}?${q(profile)}`)
  } catch (e) {
    if (!(e instanceof HermesError && e.status === 404)) throw e
  }
}

/** Running chats pick up the change now rather than on their next start. */
const reload = () => rpc('reload.mcp', { confirm: true }).catch(() => {})

const refresh = (qc: QueryClient, profile: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: appsKey(profile) }),
    qc.invalidateQueries({ queryKey: ['apps-health', profile] }),
  ])

/**
 * Connects an app to an agent: adds it (with `env`, for the few that ask for
 * something) and, for one that's signed into, starts the sign-in in `tab`.
 * Progress is in useConnection. If it doesn't work out, an app added here is
 * taken away again, so nothing half-connected stays behind.
 */
export async function connectApp(
  qc: QueryClient,
  profile: string,
  app: CatalogApp,
  { name, tab, env, added: had }: { name: string; tab?: Window | null; env?: Record<string, string>; added: boolean },
) {
  const key = keyOf(profile, app.name)
  // A sign-in left open (its tab closed, say) would hold Hermes's place for this app: let it go.
  const stale = useConnections.getState()[key]?.flowId
  patch(key, { phase: 'adding' })
  if (stale) await api.delete(`/api/mcp/oauth/flows/${encodeURIComponent(stale)}`).catch(() => {})
  let added = false
  try {
    if (!had) {
      await api.post(`/api/mcp/catalog/install?${q(profile)}`, {
        name: app.name,
        env: env ?? {},
        enable: true,
        profile,
      })
      added = true
    }
    if (app.auth_type !== 'oauth') {
      tab?.close()
      await reload()
      await refresh(qc, profile)
      return patch(key, { phase: 'done', added })
    }
    const config = { mcp_servers: { [app.name]: { oauth: { redirect_uri: returnUrl(location.origin, app.name) } } } }
    await api.put(`/api/config?${q(profile)}`, { config, profile })
    const flow = await startSignIn(profile, app.name)
    if (flow.status === 'error' || !flow.authorization_url) throw new Error(flow.error || 'error')
    const shown = showSignIn(flow.authorization_url, tab)
    patch(key, { phase: shown ? 'signing-in' : 'blocked', url: flow.authorization_url, flowId: flow.flow_id, added })
    void watch(qc, profile, app.name, name, flow.flow_id)
  } catch (e) {
    tab?.close()
    if (added) await removeServer(profile, app.name).catch(() => {})
    patch(key, { phase: 'failed', message: friendlyError(name, (e as Error).message ?? '', secureHere()) })
    void refresh(qc, profile)
  }
}

/** Asks Hermes how the sign-in is going until it's done, fails, or is given up on. */
async function watch(qc: QueryClient, profile: string, app: string, name: string, flowId: string) {
  const key = keyOf(profile, app)
  const current = () => useConnections.getState()[key]
  const until = Date.now() + 6 * 60_000
  while (Date.now() < until) {
    await wait(1500)
    if (current()?.flowId !== flowId) return
    let flow: Flow
    try {
      flow = await api.get<Flow>(`/api/mcp/oauth/flows/${encodeURIComponent(flowId)}`)
    } catch (e) {
      if (e instanceof HermesError && e.status === 404) return fail('expired')
      continue
    }
    if (current()?.flowId !== flowId) return
    if (flow.status === 'approved') {
      await reload()
      await refresh(qc, profile)
      return patch(key, { ...current(), phase: 'done' })
    }
    if (flow.status === 'error') return fail(flow.error ?? '')
  }
  void api.delete(`/api/mcp/oauth/flows/${encodeURIComponent(flowId)}`).catch(() => {})
  return fail('expired')

  async function fail(raw: string) {
    const was = current()
    if (was?.added) await removeServer(profile, app).catch(() => {})
    patch(key, { phase: 'failed', message: friendlyError(name, raw, secureHere()) })
    void refresh(qc, profile)
  }
}

/** Stops a sign-in in progress, and takes away the app it was adding. */
export async function cancelConnect(qc: QueryClient, profile: string, app: string) {
  const key = keyOf(profile, app)
  const was = useConnections.getState()[key]
  patch(key, null)
  if (was?.flowId) await api.delete(`/api/mcp/oauth/flows/${encodeURIComponent(was.flowId)}`).catch(() => {})
  if (was?.added) await removeServer(profile, app).catch(() => {})
  void refresh(qc, profile)
}

/** Forgets how a connection went, once the person has seen it. */
export const clearConnection = (profile: string, app: string) => patch(keyOf(profile, app), null)

// ── Managing ────────────────────────────────────────────────────────────────

export async function setAppEnabled(qc: QueryClient, profile: string, app: string, enabled: boolean) {
  qc.setQueryData<AppServer[]>(appsKey(profile), (list) => list?.map((s) => (s.name === app ? { ...s, enabled } : s)))
  try {
    await api.put(`/api/mcp/servers/${path(app)}/enabled?${q(profile)}`, { enabled, profile })
    await reload()
  } finally {
    void refresh(qc, profile)
  }
}

/** Takes an app away from the agent. Hermes keeps its sign-in, so adding it back is quick. */
export async function removeApp(qc: QueryClient, profile: string, app: string) {
  qc.setQueryData<AppServer[]>(appsKey(profile), (list) => list?.filter((s) => s.name !== app))
  try {
    await removeServer(profile, app)
    await reload()
  } finally {
    void refresh(qc, profile)
  }
}
