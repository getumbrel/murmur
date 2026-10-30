// Models and the services that provide them: a ChatGPT plan, API keys and
// model servers, at home or online. Hermes keeps these per agent; Murmur
// manages the main agent's, which new agents copy. Spec:
// docs/hermes/models-and-onboarding.md.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, HermesError } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import type { ApiKeyService, ChatGPTFlow } from '@/features/onboarding/connect'
import { addressesFor, hostOf, isPrivateUrl, serverName, ServerProblem, type ModelServer, type ServerModel } from '@/features/onboarding/servers'
import { readinessKey, type RuntimeCheck } from './readiness'
import { freshenModels } from '@/features/model/use-models'
import { planFromAccountLines, planUsage, reportsPlanAsText, type PlanUsage } from './limits'

// ── What's connected ────────────────────────────────────────────────────────

type OptionsRow = {
  slug: string
  name: string
  is_current?: boolean
  is_user_defined?: boolean
  models: string[]
  authenticated?: boolean
  source?: string
  api_url?: string
  aliases?: string[]
  /** Subscription windows, from Hermes's cache (limits.ts). */
  usage?: unknown
  /** Set while it's rate limited (limits.ts). */
  limit?: unknown
}
type Options = { model: string; provider: string; providers: OptionsRow[] }
type OAuthRow = { id: string; status: { logged_in?: boolean } }
type EnvRow = { is_set: boolean; category?: string; provider?: string; redacted_value?: string | null }
type Endpoint = { id: string; name: string; base_url: string; model: string; models?: string[]; has_api_key?: boolean }

export type Service = {
  /** The model/options slug, which is also what /api/model/set wants. */
  slug: string
  name: string
  detail: string
  models: string[]
  current: boolean
  /** How much of its plan is left, when Hermes knows. */
  plan?: PlanUsage | null
  /** Hermes's word on it being rate limited; see restingUntil. */
  limit?: unknown
  /** How to disconnect it; absent when Murmur can't (set up outside Murmur). */
  remove?: { kind: 'oauth'; id: string } | { kind: 'key'; env: string } | { kind: 'endpoint'; id: string }
  /** A model server: where it is, so it can be changed. */
  server?: { id: string; baseUrl: string; hasKey: boolean; model: string }
}

export type Models = { model: string; provider: string; services: Service[] }

const NAMES: Record<string, string> = {
  'openai-codex': 'ChatGPT',
  'openai-api': 'OpenAI',
  gemini: 'Gemini',
  'xai-oauth': 'Grok',
  'minimax-oauth': 'MiniMax',
}

export const modelsKey = ['models'] as const

/** Hermes's own model runtime (local-runtime.ts), in /api/model/options. */
export const LOCAL_SLUG = 'llamacpp'

export function useModels() {
  const qc = useQueryClient()
  return useQuery({
    queryKey: modelsKey,
    queryFn: async (): Promise<Models> => {
      // A first look can be an hour old (see freshenModels): fetch them fresh too, then show those.
      freshenModels('/api/model/options', () => void qc.invalidateQueries({ queryKey: modelsKey }))
      const [options, oauth, env, custom] = await Promise.all([
        api.get<Options>('/api/model/options'),
        api.get<{ providers: OAuthRow[] }>('/api/providers/oauth').catch(() => ({ providers: [] })),
        api.get<Record<string, EnvRow>>('/api/env').catch(() => ({}) as Record<string, EnvRow>),
        api.get<{ endpoints: Endpoint[] }>('/api/providers/custom-endpoints').catch(() => ({ endpoints: [] })),
      ])
      const services = options.providers
        .filter((p) => p.authenticated && p.slug !== 'moa' && p.models.length)
        .map<Service>((p) => {
          // ChatGPT is only ever a sign-in, even when the sign-in list is slow to answer.
          const signedIn = p.slug === 'openai-codex' || oauth.providers.some((o) => o.id === p.slug && o.status.logged_in)
          const endpoint = custom.endpoints.find((e) => e.id === p.slug || p.aliases?.includes(e.id))
          const key = Object.entries(env).find(([, v]) => v.is_set && v.category === 'provider' && v.provider === p.slug)
          const base = {
            slug: p.slug,
            name: NAMES[p.slug] ?? p.name,
            models: p.models,
            current: !!p.is_current,
            plan: planUsage(p.usage),
            limit: p.limit,
          }
          if (signedIn)
            return { ...base, detail: p.slug === 'openai-codex' ? 'Your ChatGPT plan' : 'Signed in', remove: { kind: 'oauth', id: p.slug } }
          if (endpoint)
            return {
              ...base,
              name: endpoint.name,
              // Named for where it is already: say what it offers instead.
              detail: endpoint.name === hostOf(endpoint.base_url) ? plural(p.models.length, 'model') : hostOf(endpoint.base_url),
              remove: { kind: 'endpoint', id: endpoint.id },
              server: { id: endpoint.id, baseUrl: endpoint.base_url, hasKey: !!endpoint.has_api_key, model: endpoint.model },
            }
          if (key) return { ...base, detail: keyHint(key[1].redacted_value), remove: { kind: 'key', env: key[0] } }
          // Hermes runs it itself (local-runtime.ts).
          if (p.slug === LOCAL_SLUG) return { ...base, detail: 'Runs privately' }
          return { ...base, detail: 'Connected' }
        })
        // The one in use first.
        .sort((a, b) => Number(b.current) - Number(a.current))
      return { model: options.model, provider: options.provider, services }
    },
    staleTime: 30_000,
    // A read asks Hermes to check the plan in the background: a ChatGPT plan with nothing to say yet gets a few more looks.
    refetchInterval: (q) =>
      q.state.data?.services.some((s) => s.slug === 'openai-codex' && !s.plan) && q.state.dataUpdateCount < 4 ? 5000 : false,
  })
}

const plural = (n: number, word: string) => `${n}\u00a0${word}${n === 1 ? '' : 's'}`

/** «redacted:sk-o...1c65» → "Key ending in 1c65" */
function keyHint(redacted?: string | null) {
  const tail = redacted?.match(/\.\.\.(\w{2,6})»?$/)?.[1]
  return tail ? `Key ending in ${tail}` : 'API key'
}

/** How a model's id reads to people. (One formatter, so a model never has two names.) */
export { prettyModel as modelName } from '@/features/model/names'

// ── Changing the main model ─────────────────────────────────────────────────

/** Asked when Hermes wants a yes before switching to a pricier model. */
export type Confirm = (message: string) => Promise<boolean>

type SetResult = { ok: boolean; confirm_required?: boolean; confirm_message?: string }

/** Sets the main agent's model, or another agent's when `profile` says which. */
export async function setMainModel(provider: string, model: string, confirm?: Confirm, profile?: string) {
  const body = { scope: 'main', provider, model, ...(profile && { profile }) }
  let res = await api.post<SetResult>('/api/model/set', body)
  if (!res.ok && res.confirm_required) {
    if (!(await (confirm?.(res.confirm_message || 'This model costs more to use.') ?? true))) return false
    res = await api.post<SetResult>('/api/model/set', { ...body, confirm_expensive_model: true })
  }
  if (!res.ok) throw new Error('Hermes couldn’t switch to that model.')
  return true
}

/** After a service is connected, make it the main agent's model (keeping the current pick on a re-login). */
async function adopt(slug: string, confirm?: Confirm) {
  await rpc('reload.env', {}, 10_000).catch(() => {})
  const options = await api.get<Options>('/api/model/options')
  const row = options.providers.find((p) => p.slug === slug || p.aliases?.includes(slug))
  if (row?.is_current && row.models.includes(options.model)) return
  const rec = await api.get<{ model: string }>(`/api/model/recommended-default?provider=${encodeURIComponent(slug)}`)
  const model = rec.model || row?.models[0]
  if (!model) throw new Error('That service has no models Murmur can use yet.')
  await setMainModel(slug, model, confirm)
}

/** Picks something else when the service in use goes away. */
async function adoptAnother(except: string) {
  const options = await api.get<Options>('/api/model/options')
  const next = options.providers.find((p) => p.authenticated && p.slug !== 'moa' && p.slug !== except && p.models.length)
  if (next) await adopt(next.slug)
}

/**
 * Moves an agent off models that are about to be deleted (local-runtime.ts):
 * to another model on the same machine when there is one, so private stays
 * private; else to another connected service; else to none, so Murmur asks for
 * a model again instead of pointing at a file that's gone. `profile` is
 * omitted for the main agent.
 */
export async function moveOff(gone: ReadonlySet<string>, profile?: string) {
  const query = profile ? `?profile=${encodeURIComponent(profile)}` : ''
  const options = await api.get<Options>(`/api/model/options${query}`)
  const rows = options.providers
    .filter((p) => p.authenticated && p.slug !== 'moa')
    .map((p) => (p.slug === LOCAL_SLUG ? { ...p, models: p.models.filter((m) => !gone.has(m)) } : p))
    .filter((p) => p.models.length)
  const next = rows.find((p) => p.slug === LOCAL_SLUG) ?? rows[0]
  if (!next) {
    // What Hermes does itself when the endpoint in use is deleted: no provider, so it isn't ready.
    await api.put(`/api/config${query}`, { config: { model: { provider: '', base_url: '' } } })
    return
  }
  let model = next.slug === LOCAL_SLUG ? next.models[0] : ''
  if (!model) {
    const params = `provider=${encodeURIComponent(next.slug)}${profile ? `&profile=${encodeURIComponent(profile)}` : ''}`
    const rec = await api.get<{ model: string }>(`/api/model/recommended-default?${params}`).catch(() => ({ model: '' }))
    model = rec.model || next.models[0]
  }
  await setMainModel(next.slug, model, undefined, profile)
}

export async function disconnect(service: Service) {
  const r = service.remove
  if (!r) return
  if (r.kind === 'oauth') await api.delete(`/api/providers/oauth/${r.id}`)
  if (r.kind === 'key') await api.delete('/api/env', { key: r.env })
  if (r.kind === 'endpoint') await api.delete(`/api/providers/custom-endpoints/${r.id}`)
  if (service.current) await adoptAnother(service.slug)
}

/** Everything that depends on which model is connected. */
export function useRefreshModels() {
  const qc = useQueryClient()
  return useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: modelsKey }),
        qc.invalidateQueries({ queryKey: ['readiness'] }),
        qc.invalidateQueries({ queryKey: ['agents'] }),
        // Each agent's own picker.
        qc.invalidateQueries({ queryKey: ['model-options'] }),
      ]),
    [qc],
  )
}

/** A fresh answer to "can the main agent think now?". */
export function useCheckReady() {
  const qc = useQueryClient()
  return useCallback(
    () => qc.fetchQuery({ queryKey: readinessKey(), queryFn: () => rpc<RuntimeCheck>('setup.runtime_check', {}, 20_000), staleTime: 0 }),
    [qc],
  )
}

// ── API keys ────────────────────────────────────────────────────────────────

const KEYS: Record<ApiKeyService, { env: string; slug: string }> = {
  openrouter: { env: 'OPENROUTER_API_KEY', slug: 'openrouter' },
  openai: { env: 'OPENAI_API_KEY', slug: 'openai-api' },
  anthropic: { env: 'ANTHROPIC_API_KEY', slug: 'anthropic' },
  gemini: { env: 'GEMINI_API_KEY', slug: 'gemini' },
  xai: { env: 'XAI_API_KEY', slug: 'xai' },
}

type Validation = { ok: boolean; reachable: boolean; message?: string; models?: string[]; resolved_base_url?: string }

export async function connectApiKey(service: ApiKeyService, key: string, confirm?: Confirm) {
  const { env, slug } = KEYS[service]
  const check = await api.post<Validation>('/api/providers/validate', { key: env, value: key })
  // Unreachable means "couldn't verify": save it anyway.
  if (!check.ok && check.reachable) throw new Error('That key didn’t work. Check it and try again.')
  await api.put('/api/env', { key: env, value: key })
  await adopt(slug, confirm)
}

// ── Model servers ───────────────────────────────────────────────────────────

/**
 * Where Ollama and LM Studio answer on the computer Hermes runs on: Hermes
 * itself, or, from inside Docker, the computer around it.
 */
const NEARBY = ['localhost', 'host.docker.internal'].flatMap((host) =>
  ['11434', '1234'].map((port) => `http://${host}:${port}/v1`),
)

/**
 * Model servers Hermes can use without being told where: Ollama or LocalAI
 * beside it on an Umbrel (which Murmur's server finds, with their models'
 * sizes), and Ollama or LM Studio on the computer it runs on. Every one is
 * asked of Hermes, since it's Hermes that will use them: Ollama on an Umbrel
 * is no use to a Hermes on a laptop.
 */
export function useLocalServers(enabled = true) {
  return useQuery({ queryKey: ['local-servers'], enabled, queryFn: findLocalServers, staleTime: 15_000 })
}

export async function findLocalServers(): Promise<ModelServer[]> {
  const beside = await fetch('/murmur/local')
    .then(async (res) => (res.ok ? ((await res.json()) as { servers: ModelServer[] }).servers : []))
    .catch(() => [] as ModelServer[])
  const urls = [...beside.map((s) => s.baseUrl), ...NEARBY]
  const asked = await Promise.all(
    urls.map((url) => api.post<Validation>('/api/providers/validate', { key: 'OPENAI_BASE_URL', value: url }).catch(() => null)),
  )
  const servers: ModelServer[] = []
  asked.forEach((res, i) => {
    if (!res?.ok) return
    const server: ModelServer = beside[i] ?? {
      name: serverName(urls[i]),
      baseUrl: res.resolved_base_url ?? urls[i],
      models: (res.models ?? []).map((id) => ({ id, size: null, parameters: null })),
    }
    // The same server by two ways in (localhost, and the computer around a container): once.
    if (!servers.some((s) => s.name === server.name)) servers.push(server)
  })
  return servers
}

/** Asks Hermes, from its side of the network, what answers at an address: each likely scheme in turn. */
async function probe(input: string, apiKey?: string) {
  const { urls, host } = addressesFor(input)
  let url = urls[0]
  let res!: Validation
  for (url of urls) {
    res = await api.post<Validation>('/api/providers/validate', { key: 'OPENAI_BASE_URL', value: url, ...(apiKey && { api_key: apiKey }) })
    // Nothing there, or plain http on a host that only redirects: the next one, if any.
    if (res.reachable && !/HTTP 30\d\b/.test(res.message ?? '')) break
  }
  return { url, host, res }
}

/**
 * What's at an address, as Hermes sees it: the server and its models, or a
 * ServerProblem saying which field would fix it. The key goes with the asking.
 */
export async function findServer(input: string, apiKey?: string): Promise<ModelServer> {
  const key = apiKey?.trim() || undefined
  const { url, host, res } = await probe(input, key)
  const name = serverName(url)
  if (!res.reachable) throw new ServerProblem(`Couldn’t reach ${host}. Check the address and that the server is running.`, 'unreachable')
  if (!res.ok && /HTTP 40[13]\b/.test(res.message ?? ''))
    throw key
      ? new ServerProblem(`${name} didn’t accept that key. Check it and try again.`, 'bad-key')
      : new ServerProblem(`${name} needs an API key.`, 'needs-key')
  if (!res.ok)
    throw new ServerProblem(`${host} answered, but isn’t serving models there. Check the full address, which often ends in /v1.`, 'not-a-server')
  if (!res.models?.length)
    // Online, an empty list is usually a missing key.
    throw !key && !isPrivateUrl(url)
      ? new ServerProblem(`${name} didn’t list any models. It may need an API key.`, 'needs-key')
      : new ServerProblem(`${name} is running but has no models yet.`, 'no-models')
  return {
    name,
    baseUrl: res.resolved_base_url ?? url,
    models: res.models.map((id) => ({ id, size: null, parameters: null })),
    ...(key && { apiKey: key }),
  }
}

/**
 * Hermes keys a server by its id, and some ids are its own services
 * ("openrouter", "xai"): a new one is keyed by where it is instead, and named
 * so it reads apart from any other ("Ollama", then "Ollama on 192.168.1.20").
 */
function newEndpoint(server: ModelServer, baseUrl: string, endpoints: Endpoint[]) {
  const host = hostOf(baseUrl)
  const slug = host.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '') || 'server'
  let id = slug
  for (let n = 2; endpoints.some((e) => e.id === id); n++) id = `${slug}-${n}`
  const taken = (name: string) => endpoints.some((e) => e.name.toLowerCase() === name.toLowerCase())
  const tries = server.name === host ? [server.name] : [server.name, `${server.name} on ${host}`]
  let name = tries.find((n) => !taken(n))
  for (let n = 2; !name; n++) if (!taken(`${server.name} ${n}`)) name = `${server.name} ${n}`
  return { id, name }
}

/** Saves a server in Hermes (once, however often it's picked) and makes `model` the main agent's. */
export async function connectServer(server: ModelServer, model: ServerModel) {
  const key = server.apiKey
  const check = await api.post<Validation>('/api/providers/validate', { key: 'OPENAI_BASE_URL', value: server.baseUrl, ...(key && { api_key: key }) })
  if (!check.reachable) throw new Error(`Hermes can’t reach ${server.name}. Make sure it’s running, then try again.`)
  const base_url = check.resolved_base_url ?? server.baseUrl
  const { endpoints } = await api.get<{ endpoints: Endpoint[] }>('/api/providers/custom-endpoints')
  const saved = endpoints.find((e) => e.base_url === base_url)
  await api.post('/api/providers/custom-endpoints', {
    ...(saved ? { id: saved.id, name: saved.name } : newEndpoint(server, base_url, endpoints)),
    base_url,
    model: model.id,
    models: check.models?.length ? check.models : server.models.map((m) => m.id),
    make_default: true,
    // Only a key typed just now replaces one already saved.
    ...(key && { api_key: key }),
  })
  // Hermes reads keys from its environment.
  if (key) await rpc('reload.env', {}, 10_000).catch(() => {})
}

/**
 * Moves a saved server, or changes its key: `apiKey` left out keeps the saved
 * one (only ever at the same address), '' removes it. Checked first, with the
 * key it will have. `main` is the main agent's model, kept if it's still there.
 */
export async function updateServer(service: Service, change: { address: string; apiKey?: string }, main?: string) {
  const saved = service.server
  if (!saved) return
  const found = await findServer(change.address, change.apiKey)
  const ids = found.models.map((m) => m.id)
  const want = service.current && main ? main : saved.model
  await api.post('/api/providers/custom-endpoints', {
    id: saved.id,
    name: service.name,
    base_url: found.baseUrl,
    model: ids.includes(want) ? want : ids[0],
    models: ids,
    // The main agent keeps its own copy of where its model is.
    make_default: service.current,
    ...(change.apiKey !== undefined && { api_key: change.apiKey.trim() }),
  })
  if (change.apiKey !== undefined) await rpc('reload.env', {}, 10_000).catch(() => {})
}

// ── ChatGPT sign-in (device code) ───────────────────────────────────────────

type Start = { session_id: string; user_code: string; verification_url: string; expires_in: number; poll_interval: number }
type Poll = { status: 'pending' | 'approved' | 'denied' | 'expired' | 'error' | 'cancelled'; error_message?: string | null }

const CODEX = '/api/providers/oauth/openai-codex'
const EXPIRED: ChatGPTFlow = { status: 'error', kind: 'expired', message: 'The code expired.' }

/**
 * Drives the ChatGPT device-code sign-in. `onApproved` runs once ChatGPT says
 * yes (Hermes has already saved the login by then). Leaving cancels the code.
 */
export function useChatGPTSignIn(onApproved: () => Promise<void>) {
  const [flow, setFlow] = useState<ChatGPTFlow>({ status: 'idle' })
  const session = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const approved = useRef(onApproved)
  approved.current = onApproved

  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    const sid = session.current
    session.current = null
    if (sid) void api.delete(`/api/providers/oauth/sessions/${sid}`).catch(() => {})
  }, [])

  useEffect(() => cancel, [cancel])

  const start = useCallback(async () => {
    cancel()
    setFlow({ status: 'starting' })
    let res: Start
    try {
      res = await api.post<Start>(`${CODEX}/start`)
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      const disabled = /device[- ]code/i.test(message) && /authori|enable/i.test(message)
      return setFlow({
        status: 'error',
        kind: disabled ? 'device_login_disabled' : 'other',
        message: e instanceof HermesError && e.status === 0 ? message : 'ChatGPT didn’t respond. Check your connection, then try again.',
      })
    }
    const sid = res.session_id
    session.current = sid
    const code = { userCode: res.user_code, verificationUrl: res.verification_url, expiresAt: Date.now() + res.expires_in * 1000 }
    const every = Math.max(2, res.poll_interval || 5) * 1000
    setFlow({ status: 'waiting', ...code })

    const poll = async () => {
      if (session.current !== sid) return
      if (Date.now() > code.expiresAt) return cancel(), setFlow(EXPIRED)
      let p: Poll
      try {
        p = await api.get<Poll>(`${CODEX}/poll/${sid}`)
      } catch (e) {
        // Hermes forgets codes on restart; anything else is worth another try.
        if (e instanceof HermesError && e.status === 404) return (session.current = null), setFlow(EXPIRED)
        timer.current = setTimeout(poll, every)
        return
      }
      if (session.current !== sid) return
      if (p.status === 'pending') return void (timer.current = setTimeout(poll, every))
      session.current = null
      if (p.status === 'expired') return setFlow(EXPIRED)
      if (p.status !== 'approved')
        return setFlow({ status: 'error', kind: 'other', message: p.status === 'denied' ? 'The sign-in was declined.' : 'ChatGPT didn’t finish signing you in. Try again.' })
      try {
        await approved.current()
        setFlow({ status: 'success' })
      } catch (e) {
        setFlow({ status: 'error', kind: 'other', message: e instanceof Error ? e.message : 'Something went wrong.' })
      }
    }
    timer.current = setTimeout(poll, every)
  }, [cancel])

  return { flow, start, cancel }
}

export const adoptChatGPT = (confirm?: Confirm) => adopt('openai-codex', confirm)

// ── How much of the ChatGPT plan is left ────────────────────────────────────

// Hermes reports it with the services themselves now (limits.ts).
export { planUsageLine, type PlanUsage, type PlanWindow } from './limits'

/**
 * The ChatGPT plan on a Hermes older than 0.22, which only says it per chat:
 * a fresh, never-used chat answers too (and is never saved), so this opens
 * one, asks, and closes it. Null whenever anything doesn't line up.
 */
export function useOlderPlanUsage(enabled: boolean) {
  const version = useQuery({
    queryKey: ['hermes-status'],
    queryFn: () => api.get<{ version?: string }>('/api/status'),
    staleTime: 5 * 60_000,
    enabled,
  }).data?.version
  return useQuery({
    queryKey: ['plan-usage'],
    enabled: enabled && reportsPlanAsText(version),
    queryFn: async () => {
      const { session_id } = await rpc<{ session_id: string }>('session.create', {}, 15_000)
      try {
        const usage = await rpc<{ account_lines?: unknown }>('session.usage', { session_id }, 15_000)
        return planFromAccountLines(usage.account_lines)
      } finally {
        void rpc('session.close', { session_id }).catch(() => {})
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  }).data
}
