// Texting an agent from Telegram. Hermes's setup service (Telegram managed
// bots) makes the agent its own bot: Murmur shows a link and QR code, the
// person taps Start in Telegram, and once Telegram confirms who they are
// Hermes saves the bot, allows only that person, and restarts messaging.
//
// A pairing lives here, not in the sheet, so it survives the sheet closing
// (or the person switching to Telegram on the same phone) and finishes on
// its own when they come back. Hermes doesn't keep the bot's @username, so
// Murmur stores it in the agent's ui_meta under 'murmur-telegram'.

import { useEffect } from 'react'
import { create } from 'zustand'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, HermesError } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import { scoped } from '@/hermes/instance'
import { listProfiles } from '@/hermes/compat'

// Each agent's bot @username on this Hermes, cached beside ui_meta.
const TELEGRAM_KEY = scoped('murmur:telegram')

// ── Status ──────────────────────────────────────────────────────────────────

export type TelegramState =
  /** Not set up. */
  | 'off'
  /** Saved; messaging is starting up or reconnecting. */
  | 'starting'
  | 'connected'
  /** Set up, but not working. */
  | 'problem'

export type TelegramStatus = { state: TelegramState; username?: string; problem?: string }

type Platform = {
  id: string
  enabled: boolean
  configured: boolean
  gateway_running: boolean
  state: string | null
  error_message?: string | null
}

const META_KEY = 'murmur-telegram'
const q = (profile: string) => `?profile=${encodeURIComponent(profile)}`
export const telegramKey = (agentId: string) => ['telegram', agentId] as const

const local = {
  get(agentId: string): string | undefined {
    try {
      return JSON.parse(localStorage.getItem(TELEGRAM_KEY) ?? '{}')[agentId]
    } catch {
      return undefined
    }
  },
  set(agentId: string, username: string | null) {
    try {
      const all = JSON.parse(localStorage.getItem(TELEGRAM_KEY) ?? '{}')
      if (username) all[agentId] = username
      else delete all[agentId]
      localStorage.setItem(TELEGRAM_KEY, JSON.stringify(all))
    } catch {
      // Private mode: ui_meta still has it.
    }
  },
}

async function storedUsername(agentId: string) {
  try {
    const profiles = await listProfiles<{ name: string; is_default: boolean; ui_meta?: Record<string, unknown> | null }>()
    const meta = profiles.find((p) => p.name === agentId)?.ui_meta?.[META_KEY] as { username?: unknown } | undefined
    if (typeof meta?.username === 'string' && meta.username) return meta.username
  } catch {
    // Fall back to this browser's copy.
  }
  return local.get(agentId)
}

async function readTelegram(agentId: string): Promise<TelegramStatus> {
  const [{ platforms }, username] = await Promise.all([
    api.get<{ platforms: Platform[] }>(`/api/messaging/platforms${q(agentId)}`),
    storedUsername(agentId),
  ])
  const p = platforms.find((x) => x.id === 'telegram')
  if (!p?.enabled || !p.configured) return { state: 'off' }
  const base = { username }
  switch (p.state) {
    case 'connected':
      return { ...base, state: 'connected' }
    case 'pending_restart':
    case 'connecting':
    case 'starting':
    case 'retrying':
    case null:
    case undefined:
      return { ...base, state: 'starting' }
    case 'gateway_stopped':
      return { ...base, state: 'problem', problem: 'Messaging is switched off in Hermes.' }
    default:
      return { ...base, state: 'problem', problem: 'Telegram isn’t answering right now.' }
  }
}

/** Telegram status for one agent. Re-checks every few seconds while it settles. */
export function useTelegram(agentId: string, { enabled = true } = {}) {
  const qc = useQueryClient()
  const phase = usePairings((s) => s.byAgent[agentId]?.phase)
  // A finished pairing changes what Hermes reports.
  useEffect(() => {
    if (phase === 'done') void qc.invalidateQueries({ queryKey: telegramKey(agentId) })
  }, [phase, agentId, qc])
  return useQuery({
    queryKey: telegramKey(agentId),
    queryFn: () => readTelegram(agentId),
    enabled,
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.data?.state === 'starting' ? 3_000 : false),
  })
}

// ── Pairing ─────────────────────────────────────────────────────────────────

export type PairingPhase =
  /** Asking Hermes for a code. */
  | 'starting'
  /** Code on screen; waiting for the person to tap Start in Telegram. */
  | 'waiting'
  /** Telegram confirmed; saving the bot. */
  | 'saving'
  | 'done'
  | 'expired'
  | 'error'

export type Pairing = {
  phase: PairingPhase
  id?: string
  link?: string
  qr?: string
  /** ms since epoch. */
  expiresAt?: number
  username?: string
  error?: string
}

type Store = { byAgent: Record<string, Pairing> }

export const usePairings = create<Store>(() => ({ byAgent: restore() }))

const SAVE_KEY = scoped('murmur:telegram-pairing')

function restore(): Record<string, Pairing> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SAVE_KEY) ?? '{}') as Record<string, Pairing>
    // Only codes still on screen are worth resuming.
    return Object.fromEntries(
      Object.entries(saved).filter(([, p]) => p.phase === 'waiting' && (p.expiresAt ?? 0) > Date.now()),
    )
  } catch {
    return {}
  }
}

function set(agentId: string, next: Pairing | null) {
  usePairings.setState((s) => {
    const byAgent = { ...s.byAgent }
    if (next) byAgent[agentId] = next
    else delete byAgent[agentId]
    try {
      sessionStorage.setItem(SAVE_KEY, JSON.stringify(byAgent))
    } catch {
      // Resuming after a reload is a nicety.
    }
    return { byAgent }
  })
  if (next?.phase === 'waiting') schedule(0)
}

const patch = (agentId: string, changes: Partial<Pairing>) => {
  const current = usePairings.getState().byAgent[agentId]
  if (current) set(agentId, { ...current, ...changes })
}

function problem(error: unknown): string {
  const status = error instanceof HermesError ? error.status : -1
  if (status === 0) return 'Can’t reach Hermes. Check that it’s running, then try again.'
  if (status === 502 || status === 503) return 'Telegram setup isn’t reachable right now. Try again in a moment.'
  return 'Something went wrong setting up Telegram. Try again.'
}

/** Get a fresh code for `agentId`; the bot will be called `name`. */
export async function startPairing(agentId: string, name: string) {
  set(agentId, { phase: 'starting' })
  try {
    const res = await api.post<{ pairing_id: string; deep_link: string; qr_payload?: string; expires_at: string }>(
      '/api/messaging/telegram/onboarding/start',
      { bot_name: name },
    )
    const expiresAt = Date.parse(res.expires_at)
    set(agentId, {
      phase: 'waiting',
      id: res.pairing_id,
      link: res.deep_link,
      qr: res.qr_payload || res.deep_link,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 10 * 60_000,
    })
  } catch (error) {
    set(agentId, { phase: 'error', error: problem(error) })
  }
}

/** Stop waiting and let the code go. */
export function cancelPairing(agentId: string) {
  const pairing = usePairings.getState().byAgent[agentId]
  set(agentId, null)
  if (pairing?.id && pairing.phase === 'waiting') {
    api.delete(`/api/messaging/telegram/onboarding/${encodeURIComponent(pairing.id)}`).catch(() => {})
  }
}

/** Forget a finished, expired or failed pairing. */
export const clearPairing = (agentId: string) => set(agentId, null)

async function check(agentId: string, pairing: Pairing) {
  if (!pairing.id) return
  if ((pairing.expiresAt ?? 0) <= Date.now()) return patch(agentId, { phase: 'expired' })
  let res: { status: string; bot_username?: string | null; owner_user_id?: string | null }
  try {
    res = await api.get(`/api/messaging/telegram/onboarding/${encodeURIComponent(pairing.id)}`)
  } catch (error) {
    const status = error instanceof HermesError ? error.status : -1
    // Gone for good (expired, used, or Hermes restarted): offer a new code.
    if (status === 410 || status === 404) return patch(agentId, { phase: 'expired' })
    return // A blip; keep waiting.
  }
  if (res.status !== 'ready' || usePairings.getState().byAgent[agentId]?.id !== pairing.id) return
  if (!res.owner_user_id) {
    return patch(agentId, { phase: 'error', error: 'Telegram didn’t say who you are. Get a new code and try again.' })
  }
  await save(agentId, pairing.id, res.owner_user_id, res.bot_username ?? undefined)
}

async function save(agentId: string, pairingId: string, owner: string, username?: string) {
  patch(agentId, { phase: 'saving', username })
  try {
    const res = await api.post<{ bot_username?: string | null }>(
      `/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}/apply${q(agentId)}`,
      // Only the person who paired can talk to the bot.
      { allowed_user_ids: [owner], profile: agentId },
    )
    const name = res.bot_username || username
    if (name) await remember(agentId, name)
    patch(agentId, { phase: 'done', username: name })
  } catch (error) {
    patch(agentId, { phase: 'error', error: problem(error) })
  }
}

async function remember(agentId: string, username: string | null) {
  local.set(agentId, username)
  await rpc('profiles.configure', {
    name: agentId,
    ui_meta: { [META_KEY]: username ? { username, since: Date.now() } : null },
  }).catch(() => {})
}

// One poller for every waiting pairing; quiet while the page is hidden.
let timer: ReturnType<typeof setTimeout> | undefined
let running = false

function schedule(delay = 2000) {
  clearTimeout(timer)
  timer = setTimeout(tick, delay)
}

async function tick() {
  if (running) return
  const waiting = Object.entries(usePairings.getState().byAgent).filter(([, p]) => p.phase === 'waiting')
  if (!waiting.length) return
  if (document.visibilityState === 'visible') {
    running = true
    await Promise.all(waiting.map(([agentId, p]) => check(agentId, p))).finally(() => (running = false))
  }
  schedule()
}

if (typeof document !== 'undefined') {
  // Back from Telegram: look straight away.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && schedule(0))
  if (Object.keys(usePairings.getState().byAgent).length) schedule(0)
}

// ── Disconnecting ───────────────────────────────────────────────────────────

/** Turn Telegram off for this agent and remove its bot from Hermes. */
export async function disconnectTelegram(agentId: string) {
  const res = await api.put<{ hot_served?: boolean }>(`/api/messaging/platforms/telegram${q(agentId)}`, {
    enabled: false,
    clear_env: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USERS'],
    profile: agentId,
  })
  // A shared messaging process picks the change up by itself; otherwise
  // restart it, the way Hermes does after setting Telegram up.
  if (!res.hot_served) await api.post(`/api/gateway/restart${q(agentId)}`).catch(() => {})
  await remember(agentId, null)
  clearPairing(agentId)
}

/** A t.me link to the agent's bot. */
export const botLink = (username: string) => `https://t.me/${username.replace(/^@/, '')}`
