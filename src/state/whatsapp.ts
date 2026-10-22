// Texting an agent on WhatsApp. Hermes links a WhatsApp account to the agent
// the way WhatsApp Web does: it runs a small bridge that shows a QR code, the
// person scans it from Linked devices on their phone, and Hermes saves the
// link and turns WhatsApp on for that agent.
//
// Two ways to use it:
//   self-chat  Your own WhatsApp. You talk to the agent in your "Message
//              yourself" chat; nobody else can reach it.
//   bot        A spare number just for the agent. Anyone can message it; new
//              people wait for your OK (Hermes's pairing, see state/access.ts).
//
// Unlike Telegram, this tab sees the setup through itself. Hermes keeps the
// link on disk the moment the phone scans, and a fresh start reports an
// account that's already linked straight away, so a tab that sleeps or
// reloads loses nothing: it just asks again. Hermes doesn't keep the linked
// account's name or number where Murmur can read it, so the agent's ui_meta
// does, under 'murmur-whatsapp'.

import { useEffect } from 'react'
import { create } from 'zustand'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, HermesError, within } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import { listProfiles } from '@/hermes/compat'

export type WhatsAppMode = 'self-chat' | 'bot'

// ── Status ──────────────────────────────────────────────────────────────────

export type WhatsAppState = 'off' | 'starting' | 'connected' | 'problem'

/** Who the agent is on WhatsApp, as Murmur saw it when it was linked. */
export type WhatsAppAccount = { name?: string; phone?: string }

export type WhatsAppStatus = { state: WhatsAppState; mode?: WhatsAppMode; account?: WhatsAppAccount; problem?: string }

export type Platform = {
  id: string
  enabled: boolean
  configured: boolean
  gateway_running: boolean
  state: string | null
  error_message?: string | null
  whatsapp_setup?: { mode?: string } | null
}

type Runtime = { state?: string | null; error_message?: string | null } | null | undefined

const META_KEY = 'murmur-whatsapp'
/** Hermes's messaging routes can take 15s or more to answer; past this, they're not going to. */
const SLOW_MS = 45_000
const q = (profile: string) => `?profile=${encodeURIComponent(profile)}`
export const whatsappKey = (agentId: string) => ['whatsapp', agentId] as const

const modeOf = (raw?: string | null): WhatsAppMode | undefined =>
  raw === 'bot' || raw === 'self-chat' ? raw : undefined

/**
 * Where WhatsApp stands, from Hermes's platform list. For an agent other than
 * the main one Hermes calls WhatsApp "not configured" even once it's linked
 * (it has no required keys to look for), so its mode says it's set up and the
 * agent's own messaging status says how it's doing.
 */
export function statusFrom(p: Platform | undefined, runtime?: Runtime): WhatsAppStatus {
  const mode = modeOf(p?.whatsapp_setup?.mode)
  if (!p?.enabled || (!p.configured && !mode)) return { state: 'off' }
  const state =
    p.state === 'not_configured' ? (runtime?.state ?? (p.gateway_running ? null : 'gateway_stopped')) : p.state
  switch (state) {
    case 'connected':
      return { state: 'connected', mode }
    case 'pending_restart':
    case 'connecting':
    case 'starting':
    case 'retrying':
    case null:
    case undefined:
      return { state: 'starting', mode }
    case 'gateway_stopped':
      return { state: 'problem', mode, problem: 'Messaging is switched off in Hermes.' }
    default:
      return { state: 'problem', mode, problem: 'WhatsApp isn’t answering right now.' }
  }
}

async function storedAccount(agentId: string): Promise<WhatsAppAccount | undefined> {
  try {
    const profiles = await listProfiles<{
      name: string
      is_default: boolean
      ui_meta?: Record<string, unknown> | null
    }>()
    const meta = profiles.find((p) => p.name === agentId)?.ui_meta?.[META_KEY] as WhatsAppAccount | undefined
    if (meta && (meta.name || meta.phone)) return { name: meta.name || undefined, phone: meta.phone || undefined }
  } catch {
    // Nice to have: the status stands without it.
  }
  return undefined
}

async function readWhatsApp(agentId: string): Promise<WhatsAppStatus> {
  const [{ platforms }, account] = await Promise.all([
    api.get<{ platforms: Platform[] }>(`/api/messaging/platforms${q(agentId)}`, within(SLOW_MS)),
    storedAccount(agentId),
  ])
  const p = platforms.find((x) => x.id === 'whatsapp')
  let runtime: Runtime
  if (p?.enabled && p.state === 'not_configured' && p.gateway_running) {
    runtime = await api
      .get<{ gateway_platforms?: Record<string, Runtime> }>(`/api/status${q(agentId)}`, within(SLOW_MS))
      .then((s) => s.gateway_platforms?.whatsapp)
      .catch(() => undefined)
  }
  const status = statusFrom(p, runtime)
  return status.state === 'off' ? status : { ...status, account }
}

/** WhatsApp status for one agent. Re-checks every few seconds while it settles. */
export function useWhatsApp(agentId: string, { enabled = true } = {}) {
  const qc = useQueryClient()
  const phase = useLinks((s) => s.byAgent[agentId]?.phase)
  // A finished link changes what Hermes reports.
  useEffect(() => {
    if (phase === 'done') void qc.invalidateQueries({ queryKey: whatsappKey(agentId) })
  }, [phase, agentId, qc])
  return useQuery({
    queryKey: whatsappKey(agentId),
    queryFn: () => readWhatsApp(agentId),
    enabled,
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.data?.state === 'starting' ? 3_000 : false),
  })
}

// ── Linking ─────────────────────────────────────────────────────────────────

export type LinkPhase =
  /** Asking Hermes to begin. */
  | 'starting'
  /** Hermes is getting its WhatsApp bridge ready (the first time, a download). */
  | 'installing'
  /** QR code on screen; waiting for the phone to scan it. */
  | 'waiting'
  /** Scanned; Hermes is saving the link and turning WhatsApp on. */
  | 'saving'
  | 'done'
  | 'expired'
  /** Didn't finish; `message` says why. */
  | 'failed'

export type Link = {
  phase: LinkPhase
  mode: WhatsAppMode
  /** Hermes's id for this setup. */
  id?: string
  qr?: string
  /** ms since epoch. */
  expiresAt?: number
  account?: WhatsAppAccount
  message?: string
}

/** What Hermes says about a setup (GET/POST …/whatsapp/onboarding). */
export type Onboarding = {
  pairing_id?: string
  status?: string
  qr_payload?: string | null
  expires_at?: string | null
  account_name?: string | null
  account_phone?: string | null
  error?: string | null
}

/** Still going: worth watching closely, and worth stopping when nobody's looking. */
export const linkActive = (phase?: LinkPhase) => phase === 'starting' || phase === 'installing' || phase === 'waiting'

const COPY = {
  unreachable: 'Can’t reach Hermes. Check that it’s running, then try again.',
  install: 'Hermes couldn’t get WhatsApp ready. Check its internet connection, then try again.',
  loggedOut: 'WhatsApp turned the link down. Try again with a fresh code.',
  elsewhere: 'WhatsApp setup was started again somewhere else.',
  unknown: 'Something went wrong linking WhatsApp. Try again.',
  notSaved: 'Hermes couldn’t save WhatsApp. Try again.',
}

/** Hermes's reasons, in words a person can act on. */
function failure(error?: string | null) {
  const e = error ?? ''
  if (/npm|install|node\.js|dependenc/i.test(e)) return COPY.install
  if (/logged_out|logged out/i.test(e)) return COPY.loggedOut
  if (/superseded/i.test(e)) return COPY.elsewhere
  return COPY.unknown
}

/** The next step of a setup, from what Hermes just said about it. */
export function linkFrom(body: Onboarding, prev: Link): Link {
  const expiresAt = Date.parse(String(body.expires_at))
  const next: Link = {
    ...prev,
    id: body.pairing_id ?? prev.id,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : prev.expiresAt,
  }
  switch (body.status) {
    case 'installing':
    case 'starting':
      // Once it's downloading, it stays "getting ready" until there's a code to show.
      return { ...next, phase: body.status === 'installing' || prev.phase === 'installing' ? 'installing' : 'starting' }
    case 'waiting':
      return { ...next, phase: 'waiting', qr: body.qr_payload || prev.qr }
    case 'connected':
      return {
        ...next,
        phase: 'saving',
        qr: undefined,
        account: { name: body.account_name || undefined, phone: body.account_phone || undefined },
      }
    case 'expired':
      return { ...next, phase: 'expired' }
    case 'cancelled':
      return { ...next, phase: 'failed', message: COPY.elsewhere }
    case 'error':
      return { ...next, phase: 'failed', message: failure(body.error) }
    default:
      return next
  }
}

type Store = { byAgent: Record<string, Link> }

export const useLinks = create<Store>(() => ({ byAgent: {} }))

const set = (agentId: string, link: Link | null) =>
  useLinks.setState((s) => {
    const { [agentId]: _, ...rest } = s.byAgent
    return { byAgent: link ? { ...s.byAgent, [agentId]: link } : rest }
  })

const POLL_MS = 1_500
const onboarding = (id: string) => `/api/messaging/whatsapp/onboarding/${encodeURIComponent(id)}`
const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** Each start, numbered per agent, so a slow answer to an older one is let go. */
const attempts = new Map<string, number>()
/** Network blips in a row, per agent. */
const blips = new Map<string, number>()
/** Since when each agent's setup has waited for an earlier one to let go. */
const waits = new Map<string, number>()
/** Hermes gives up on a setup after ten minutes, so an earlier one has let go by then. */
const SETUP_MS = 10 * 60_000

function schedule(agentId: string, delay = POLL_MS, step: (agentId: string) => Promise<void> = tick) {
  clearTimeout(timers.get(agentId))
  timers.set(
    agentId,
    setTimeout(() => void step(agentId), delay),
  )
}

/**
 * From Hermes 0.22.4 one setup runs at a time. One put away while its bridge
 * was still downloading, or still open in another tab, holds on until it's done.
 */
const earlierSetup = (e: unknown) => e instanceof HermesError && e.status === 409 && /still active/i.test(e.message)

const current = (agentId: string, id?: string) => {
  const link = useLinks.getState().byAgent[agentId]
  // Cancelled, or replaced by a newer setup, while Hermes was answering.
  return link && (!id || link.id === id) ? link : null
}

/** Show a QR code for linking `agentId` to WhatsApp, and see it through. */
export async function startLink(agentId: string, mode: WhatsAppMode, { again = false } = {}): Promise<void> {
  const prev = current(agentId)
  if (!again && prev?.id && linkActive(prev.phase)) void release(prev.id)
  if (!again) {
    set(agentId, { phase: 'starting', mode })
    waits.delete(agentId)
  }
  const attempt = (attempts.get(agentId) ?? 0) + 1
  attempts.set(agentId, attempt)
  const mine = () => attempts.get(agentId) === attempt && current(agentId)
  let body: Onboarding
  try {
    body = await api.post<Onboarding>(
      '/api/messaging/whatsapp/onboarding/start',
      { mode, profile: agentId },
      within(30_000),
    )
  } catch (e) {
    const link = mine()
    if (!link) return
    const since = waits.get(agentId) ?? Date.now()
    if (earlierSetup(e) && Date.now() - since < SETUP_MS) {
      // Still getting a code, as far as anyone looking can tell: ask again in a moment.
      waits.set(agentId, since)
      return schedule(agentId, POLL_MS, (id) => startLink(id, mode, { again: true }))
    }
    set(agentId, {
      ...link,
      phase: 'failed',
      message: e instanceof HermesError && e.status ? failure(e.message) : COPY.unreachable,
    })
    return
  }
  const link = mine()
  // Cancelled (or started over) while Hermes was answering: let its bridge go.
  if (!link) return void (body.pairing_id && release(body.pairing_id))
  advance(agentId, linkFrom(body, link))
}

function advance(agentId: string, next: Link) {
  set(agentId, next)
  blips.delete(agentId)
  waits.delete(agentId)
  if (next.phase === 'saving') void apply(agentId, next)
  else if (linkActive(next.phase)) schedule(agentId)
}

async function tick(agentId: string) {
  timers.delete(agentId)
  const link = current(agentId)
  if (!link?.id || !linkActive(link.phase)) return
  let body: Onboarding
  try {
    body = await api.get<Onboarding>(onboarding(link.id), within(15_000))
  } catch (e) {
    if (!current(agentId, link.id)) return
    const status = e instanceof HermesError ? e.status : 0
    // Hermes forgot it (it restarted, say): start again. A phone that already
    // scanned comes straight back as linked.
    if (status === 404) return void startLink(agentId, link.mode, { again: true })
    if (status === 410) return void set(agentId, { ...link, phase: 'expired' })
    const n = (blips.get(agentId) ?? 0) + 1
    blips.set(agentId, n)
    return schedule(agentId, Math.min(POLL_MS * 2 ** n, 15_000))
  }
  if (current(agentId, link.id)) advance(agentId, linkFrom(body, link))
}

/** Save the link for this agent and turn WhatsApp on. Hermes restarts messaging itself, mostly. */
async function apply(agentId: string, link: Link) {
  let res: { restart_started?: boolean; needs_restart?: boolean }
  try {
    res = await api.post(`${onboarding(link.id!)}/apply${q(agentId)}`, { profile: agentId }, within(SLOW_MS))
  } catch (e) {
    if (!current(agentId, link.id)) return
    const status = e instanceof HermesError ? e.status : 0
    if (status === 404) return void startLink(agentId, link.mode, { again: true })
    if (status === 409) return void advance(agentId, { ...link, phase: 'waiting' })
    return void set(agentId, { ...link, phase: 'failed', message: status ? COPY.notSaved : COPY.unreachable })
  }
  if (res.restart_started === false || (res.needs_restart && res.restart_started !== true))
    void restartMessaging(agentId)
  await remember(agentId, link.account ?? null, link.mode)
  if (current(agentId, link.id)) set(agentId, { ...link, phase: 'done' })
}

async function restartMessaging(agentId: string) {
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((done) => setTimeout(done, 5_000))
    if (
      await api.post(`/api/gateway/restart${q(agentId)}`, {}, within(SLOW_MS)).then(
        () => true,
        () => false,
      )
    )
      return
  }
}

async function release(id: string) {
  await api.delete(onboarding(id), undefined, within(10_000)).catch(() => {})
}

/** Stop showing a code (Hermes stops its bridge), or put a finished one away. */
export function cancelLink(agentId: string) {
  const link = current(agentId)
  clearTimeout(timers.get(agentId))
  timers.delete(agentId)
  blips.delete(agentId)
  waits.delete(agentId)
  attempts.set(agentId, (attempts.get(agentId) ?? 0) + 1)
  set(agentId, null)
  if (link?.id && linkActive(link.phase)) void release(link.id)
}

if (typeof window !== 'undefined') {
  // A tab closing mid-link lets Hermes's bridge go now rather than in ten minutes.
  window.addEventListener('pagehide', () => {
    for (const link of Object.values(useLinks.getState().byAgent))
      if (link.id && linkActive(link.phase))
        void api.delete(onboarding(link.id), undefined, { keepalive: true }).catch(() => {})
  })
}

// ── Remembering, disconnecting ──────────────────────────────────────────────

async function remember(agentId: string, account: WhatsAppAccount | null, mode?: WhatsAppMode) {
  await rpc('profiles.configure', {
    name: agentId,
    ui_meta: { [META_KEY]: account ? { ...account, mode, since: Date.now() } : null },
  }).catch(() => {})
}

/**
 * Turn WhatsApp off for this agent. Hermes has no way to unlink the device
 * itself, so the phone keeps it under Linked devices until it's removed there.
 */
export async function disconnectWhatsApp(agentId: string) {
  const res = await api.put<{ hot_served?: boolean }>(
    `/api/messaging/platforms/whatsapp${q(agentId)}`,
    {
      enabled: false,
      clear_env: ['WHATSAPP_ENABLED', 'WHATSAPP_MODE', 'WHATSAPP_ALLOWED_USERS', 'WHATSAPP_DM_POLICY'],
      profile: agentId,
    },
    within(SLOW_MS),
  )
  if (!res.hot_served) await api.post(`/api/gateway/restart${q(agentId)}`, {}, within(SLOW_MS)).catch(() => {})
  await remember(agentId, null)
  cancelLink(agentId)
}

// ── Words ───────────────────────────────────────────────────────────────────

/** "+1 555 123 4567" for North American numbers; "+44…" as it comes otherwise. */
export function phoneLabel(phone?: string) {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (!digits) return undefined
  const na = /^1(\d{3})(\d{3})(\d{4})$/.exec(digits)
  return na ? `+1 ${na[1]} ${na[2]} ${na[3]}` : `+${digits}`
}

/** A wa.me link to a chat with `phone`: your own number opens "Message yourself". */
export const chatLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`
