// Texting an agent from Telegram. Hermes's setup service (Telegram managed
// bots) makes the agent its own bot: Murmur shows a link and QR code, the
// person taps Start in Telegram, and once Telegram confirms who they are
// Hermes saves the bot, allows only that person, and restarts messaging.
//
// Murmur's server sees each setup through (server/telegram.ts): it asks
// Hermes until Telegram is done and saves the bot itself, so a setup finishes
// even when the person completes it on their phone while this tab sleeps, or
// closes it. Every tab and device shows what the server says. Hermes doesn't
// keep the bot's @username, so the agent's ui_meta does, under
// 'murmur-telegram'.

import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, hermesHeaders, SESSION_CHECK, within } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import { HERMES_GONE, scoped } from '@/hermes/instance'
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
/** Hermes's messaging routes can take 15s or more to answer; past this, they're not going to. */
const SLOW_MS = 45_000
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
    api.get<{ platforms: Platform[] }>(`/api/messaging/platforms${q(agentId)}`, within(SLOW_MS)),
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
    if (phase === 'connected') void qc.invalidateQueries({ queryKey: telegramKey(agentId) })
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
  /** Asking for a code (this tab only). */
  | 'starting'
  /** Code on screen; waiting for the person to tap Start in Telegram. */
  | 'waiting'
  /** Telegram confirmed; Murmur is saving the bot. */
  | 'applying'
  | 'connected'
  | 'expired'
  /** Didn't finish; `message` says why. */
  | 'failed'

export type Pairing = {
  phase: PairingPhase
  link?: string
  qr?: string
  /** ms since epoch. */
  expiresAt?: number
  username?: string
  message?: string
}

type ServerPairing = Required<Pick<Pairing, 'link' | 'qr' | 'expiresAt'>> &
  Pick<Pairing, 'username' | 'message'> & { profile: string; phase: Exclude<PairingPhase, 'starting'> }

/** Still going: worth watching closely. */
export const pairingActive = (phase?: PairingPhase) => phase === 'starting' || phase === 'waiting' || phase === 'applying'

/** A code past its time has expired, whatever the last answer said. */
export const effectivePhase = (p: Pairing | undefined, now = Date.now()): PairingPhase | undefined =>
  p?.phase === 'waiting' && (p.expiresAt ?? Infinity) <= now ? 'expired' : p?.phase

type Store = { byAgent: Record<string, Pairing> }

export const usePairings = create<Store>(() => ({ byAgent: {} }))

// What the server said, and what this tab is doing before it can say (a code
// being asked for, or one Hermes couldn't make).
let server: Record<string, Pairing> = {}
const mine: Record<string, Pairing> = {}
const publish = () => usePairings.setState({ byAgent: { ...server, ...mine } })

const TIMEOUT_MS = 15_000
const UNREACHABLE = 'Can’t reach Murmur. Check your connection, then try again.'

async function murmur<T>(method: string, path: string, body?: unknown, timeout = TIMEOUT_MS): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
      // Names this tab's Hermes: setups are per Hermes.
      headers: hermesHeaders(body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error(UNREACHABLE)
  }
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null
  if (data?.error === 'hermes_gone') window.dispatchEvent(new Event(HERMES_GONE))
  if (res.status === 401 && data?.error === 'signed_out') window.dispatchEvent(new Event(SESSION_CHECK))
  if (!res.ok) throw new Error(typeof data?.error === 'string' && res.status !== 409 ? data.error : 'Something went wrong setting up Telegram. Try again.')
  return data as T
}

// ── Watching the server ─────────────────────────────────────────────────────

let watchers = 0
let timer: ReturnType<typeof setTimeout> | undefined
let inflight: Promise<void> | null = null
let lastLook = 0

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

/** Ask again soon while a setup is under way (sooner when this tab is on screen); now and then otherwise. */
function schedule() {
  clearTimeout(timer)
  if (!watchers) return
  const active = Object.values(usePairings.getState().byAgent).some((p) => pairingActive(p.phase))
  const delay = active ? (visible() ? 2_500 : 10_000) : visible() ? 30_000 : null
  if (delay !== null) timer = setTimeout(() => void refreshPairings(), delay)
}

/** What the server knows about this Hermes's setups, now. */
export function refreshPairings() {
  inflight ??= (async () => {
    try {
      const { pairings } = await murmur<{ pairings: ServerPairing[] }>('GET', '/murmur/telegram')
      const next: Record<string, Pairing> = {}
      for (const { profile, ...p } of pairings) {
        next[profile] = p
        // This browser's copy of the bot's name, beside ui_meta.
        if (p.phase === 'connected' && p.username && server[profile]?.phase !== 'connected') local.set(profile, p.username)
      }
      server = next
      lastLook = Date.now()
      publish()
    } catch {
      // A blip: the next look will tell.
    } finally {
      inflight = null
      schedule()
    }
  })()
  return inflight
}

if (typeof document !== 'undefined') {
  // Back on screen: look straight away.
  document.addEventListener('visibilitychange', () => {
    if (watchers && visible()) void refreshPairings()
    else schedule()
  })
}

/**
 * One agent's setup, if there is one, kept up to date with the server. Its
 * phase turns to 'expired' the moment the code runs out.
 */
export function usePairing(agentId: string): Pairing | undefined {
  const pairing = usePairings((s) => s.byAgent[agentId])
  const [, setTick] = useState(0)
  useEffect(() => {
    watchers++
    if (Date.now() - lastLook > 5_000) void refreshPairings()
    else schedule()
    return () => {
      watchers--
      if (!watchers) clearTimeout(timer)
    }
  }, [])
  const expiresAt = pairing?.phase === 'waiting' ? pairing.expiresAt : undefined
  useEffect(() => {
    if (expiresAt === undefined) return
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, expiresAt - Date.now()) + 50)
    return () => clearTimeout(t)
  }, [expiresAt])
  const phase = effectivePhase(pairing)
  return pairing && phase && phase !== pairing.phase ? { ...pairing, phase } : pairing
}

/** Get a fresh code for `agentId`; the bot will be called `name`. Murmur's server takes it from there. */
export async function startPairing(agentId: string, name: string) {
  mine[agentId] = { phase: 'starting' }
  publish()
  try {
    // Hermes asks Telegram's setup service for the code, which can take a moment.
    const { pairing } = await murmur<{ pairing: ServerPairing }>('POST', '/murmur/telegram/start', { profile: agentId, name }, 40_000)
    const { profile: _, ...p } = pairing
    server = { ...server, [agentId]: p }
    delete mine[agentId]
  } catch (error) {
    mine[agentId] = { phase: 'failed', message: (error as Error).message }
  }
  publish()
  schedule()
}

/** Stop waiting and let the code go, or put a finished, expired or failed setup away (on every device). */
export function cancelPairing(agentId: string) {
  const had = Boolean(server[agentId])
  delete mine[agentId]
  const { [agentId]: _, ...rest } = server
  server = rest
  publish()
  if (had) murmur('POST', '/murmur/telegram/cancel', { profile: agentId }).catch(() => {})
}

export const clearPairing = cancelPairing

// ── Disconnecting ───────────────────────────────────────────────────────────

async function remember(agentId: string, username: string | null) {
  local.set(agentId, username)
  await rpc('profiles.configure', {
    name: agentId,
    ui_meta: { [META_KEY]: username ? { username, since: Date.now() } : null },
  }).catch(() => {})
}

/** Turn Telegram off for this agent and remove its bot from Hermes. */
export async function disconnectTelegram(agentId: string) {
  const res = await api.put<{ hot_served?: boolean }>(
    `/api/messaging/platforms/telegram${q(agentId)}`,
    { enabled: false, clear_env: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USERS'], profile: agentId },
    within(SLOW_MS),
  )
  // A shared messaging process picks the change up by itself; otherwise
  // restart it, the way Hermes does after setting Telegram up.
  if (!res.hot_served) await api.post(`/api/gateway/restart${q(agentId)}`, {}, within(SLOW_MS)).catch(() => {})
  await remember(agentId, null)
  clearPairing(agentId)
}

/** A t.me link to the agent's bot. */
export const botLink = (username: string) => `https://t.me/${username.replace(/^@/, '')}`
