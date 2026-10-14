// Models and the services that provide them: a ChatGPT plan, API keys and
// model servers on the local network. Hermes keeps these per agent; Murmur
// manages the main agent's, which new agents copy. Spec:
// docs/hermes/models-and-onboarding.md.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, HermesError } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import type { ApiKeyService, ChatGPTFlow, LocalModel, LocalServer } from '@/features/onboarding/connect'
import { readinessKey, type RuntimeCheck } from './readiness'

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
}
type Options = { model: string; provider: string; providers: OptionsRow[] }
type OAuthRow = { id: string; status: { logged_in?: boolean } }
type EnvRow = { is_set: boolean; category?: string; provider?: string; redacted_value?: string | null }
type Endpoint = { id: string; name: string; base_url: string; model: string }

export type Service = {
  /** The model/options slug, which is also what /api/model/set wants. */
  slug: string
  name: string
  detail: string
  models: string[]
  current: boolean
  /** How to disconnect it; absent when Murmur can't (set up outside Murmur). */
  remove?: { kind: 'oauth'; id: string } | { kind: 'key'; env: string } | { kind: 'endpoint'; id: string }
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

export function useModels() {
  return useQuery({
    queryKey: modelsKey,
    queryFn: async (): Promise<Models> => {
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
          const base = { slug: p.slug, name: NAMES[p.slug] ?? p.name, models: p.models, current: !!p.is_current }
          if (signedIn)
            return { ...base, detail: p.slug === 'openai-codex' ? 'Your ChatGPT plan' : 'Signed in', remove: { kind: 'oauth', id: p.slug } }
          if (endpoint) return { ...base, name: endpoint.name, detail: hostOf(endpoint.base_url), remove: { kind: 'endpoint', id: endpoint.id } }
          if (key) return { ...base, detail: keyHint(key[1].redacted_value), remove: { kind: 'key', env: key[0] } }
          return { ...base, detail: 'Connected' }
        })
        // The one in use first.
        .sort((a, b) => Number(b.current) - Number(a.current))
      return { model: options.model, provider: options.provider, services }
    },
    staleTime: 30_000,
  })
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

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

export async function setMainModel(provider: string, model: string, confirm?: Confirm) {
  const body = { scope: 'main', provider, model }
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

// ── Local model servers ─────────────────────────────────────────────────────

/** Ollama or LocalAI on this Umbrel, found by the Murmur server. */
export function useLocalServers(enabled = true) {
  return useQuery({
    queryKey: ['local-servers'],
    enabled,
    queryFn: async () => {
      const res = await fetch('/murmur/local')
      if (!res.ok) return []
      return ((await res.json()) as { servers: LocalServer[] }).servers
    },
    staleTime: 15_000,
  })
}

/** Checks an address from Hermes' side of the network and lists its models. */
export async function findServer(input: string): Promise<LocalServer> {
  const url = /^https?:\/\//i.test(input.trim()) ? input.trim() : `http://${input.trim()}`
  let host: string
  try {
    host = new URL(url).host
  } catch {
    throw new Error('That doesn’t look like an address. Try something like 192.168.1.20:11434.')
  }
  const res = await api.post<Validation>('/api/providers/validate', { key: 'OPENAI_BASE_URL', value: url })
  if (!res.reachable) throw new Error(`Couldn’t reach ${host}. Check the address and that the server is running.`)
  if (!res.ok) throw new Error(res.message || `${host} answered, but not like a model server.`)
  if (!res.models?.length) throw new Error(`${host} is running but has no models yet.`)
  return {
    name: host,
    baseUrl: res.resolved_base_url ?? url,
    models: res.models.map((id) => ({ id, size: null, parameters: null })),
  }
}

export async function connectLocal(server: LocalServer, model: LocalModel) {
  const check = await api.post<Validation>('/api/providers/validate', { key: 'OPENAI_BASE_URL', value: server.baseUrl })
  if (!check.reachable) throw new Error(`Hermes can’t reach ${server.name}. Make sure it’s running, then try again.`)
  const base_url = check.resolved_base_url ?? server.baseUrl
  const existing = await api.get<{ endpoints: Endpoint[] }>('/api/providers/custom-endpoints')
  await api.post('/api/providers/custom-endpoints', {
    id: existing.endpoints.find((e) => e.base_url === base_url)?.id ?? '',
    name: server.name,
    base_url,
    model: model.id,
    models: check.models?.length ? check.models : server.models.map((m) => m.id),
    make_default: true,
  })
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

export type PlanWindow = {
  /** Hermes' label, e.g. "Weekly" or "5h". */
  label: string
  /** Percent remaining, 0–100. */
  left: number
  resetsAt?: Date
}
export type PlanUsage = { plan?: string; windows: PlanWindow[] }

// "Weekly: 96% remaining (4% used) • resets in 6d 15h (2026-10-20 05:01 UTC)"
const WINDOW = /^(.+?): (\d+)% remaining.*?resets in (.+?) \(/

/** Parses session.usage's account_lines; null when nothing in them reads as a quota. */
export function parsePlanUsage(lines: unknown, now = Date.now()): PlanUsage | null {
  if (!Array.isArray(lines)) return null
  const windows: PlanWindow[] = []
  let plan: string | undefined
  for (const line of lines) {
    if (typeof line !== 'string') continue
    const provider = line.match(/^Provider: (\S+)(?: \((.+)\))?$/)
    // Only the ChatGPT plan (the main agent may be thinking with something else).
    if (provider && provider[1] !== 'openai-codex') return null
    plan ??= provider?.[2]
    const m = line.match(WINDOW)
    if (!m) continue
    // The relative part is timezone-proof; the stamp is in the container's zone.
    const span = m[3]
    const n = (u: string) => Number(span.match(new RegExp(`(\\d+)${u}`))?.[1] ?? 0)
    const ms = ((n('d') * 24 + n('h')) * 60 + n('m')) * 60_000
    windows.push({ label: m[1].trim(), left: Math.max(0, Math.min(100, Number(m[2]))), resetsAt: ms ? new Date(now + ms) : undefined })
  }
  return windows.length ? { plan, windows } : null
}

/**
 * The ChatGPT plan's remaining quota. Hermes reports it per chat, but a fresh,
 * never-used chat answers too (and is never saved), so this opens one, asks,
 * and closes it. Hidden (null) whenever anything doesn't line up.
 */
export function usePlanUsage(enabled: boolean) {
  return useQuery({
    queryKey: ['plan-usage'],
    enabled,
    queryFn: async () => {
      const { session_id } = await rpc<{ session_id: string }>('session.create', {}, 15_000)
      try {
        const usage = await rpc<{ account_lines?: unknown }>('session.usage', { session_id }, 15_000)
        return parsePlanUsage(usage.account_lines)
      } finally {
        void rpc('session.close', { session_id }).catch(() => {})
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
}

/**
 * "Plenty left this week · resets Tue", "Running low · 12% left · resets 5 PM".
 * Also in parts, so a narrow row can drop the scope ("this week").
 */
export function planUsageLine(usage: PlanUsage, now = new Date()) {
  // The tightest window is the one that matters.
  const w = usage.windows.reduce((a, b) => (b.left < a.left ? b : a))
  const scope = /week/i.test(w.label) ? 'this week' : /month/i.test(w.label) ? 'this month' : /day/i.test(w.label) ? 'today' : ''
  const low = w.left < 20
  const lead = low ? `Running low · ${w.left}% left` : w.left >= 50 ? 'Plenty left' : `${w.left}% left`
  const reset = w.resetsAt ? resetText(w.resetsAt, now) : ''
  const parts = { lead, scope: low ? '' : scope, reset }
  const text = [[parts.lead, parts.scope].filter(Boolean).join(' '), reset].filter(Boolean).join(' · ')
  return { text, low, parts }
}

function resetText(at: Date, now: Date) {
  const ms = at.getTime() - now.getTime()
  if (ms < 60 * 60_000) return `resets in ${Math.max(1, Math.round(ms / 60_000))} min`
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(at) - day(now)) / 86_400_000)
  if (days === 0) return `resets at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: at.getMinutes() ? '2-digit' : undefined })}`
  if (days === 1) return 'resets tomorrow'
  if (days <= 7) return `resets ${at.toLocaleDateString(undefined, { weekday: 'short' })}`
  return `resets ${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}
