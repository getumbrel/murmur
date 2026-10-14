// Telegram setup, finished by Murmur's server rather than by whichever tab started it.
//
//   GET  /murmur/telegram         → {pairings: Pairing[]}: this Hermes's setups, one per agent
//   POST /murmur/telegram/start   {profile, name} → {pairing}: a new code (any earlier one for
//                                 that agent goes); 4xx/502 {error} when Hermes couldn't make one
//   POST /murmur/telegram/cancel  {profile} → {ok}: stop waiting, or forget a finished one
//
// Hermes keeps a pairing (and the bot token it's for) only in its dashboard's
// memory, and the setup service hands the token over once, to whoever asks
// Hermes first. When only the tab that showed the code asked, a phone that
// finished in Telegram while that tab slept left a bot nobody saved. So Murmur
// asks: it records each pairing in DATA_DIR/telegram.json, checks Hermes every
// few seconds until Telegram is done, saves the bot for the right agent, and
// carries on after a restart. Every tab and device reads the same answer.
//
// Phases: waiting (code on screen) → applying (Telegram confirmed; saving)
// → connected. Or expired (the code ran out), or failed (with a message).

import type http from 'node:http'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dataDir } from './config.ts'
import { hermesById, requestTarget } from './connection.ts'
import type { Hermes } from './hermes.ts'
import { readJson, sendJson } from './http.ts'

export type Phase = 'waiting' | 'applying' | 'connected' | 'expired' | 'failed'

/** What the app sees. */
export type Pairing = {
  profile: string
  phase: Phase
  /** The t.me link, and what the QR code holds. */
  link: string
  qr: string
  /** ms since epoch. */
  expiresAt: number
  /** The bot's @username, once Telegram says. */
  username?: string
  /** Why it failed, in words. */
  message?: string
  updatedAt: number
}

type Saved = Pairing & {
  /** The Hermes (connection id) it's on. */
  connection: string
  /** Hermes's pairing id. */
  id: string
  /** Whether Telegram was already on for this agent when the code was made; unknown until Hermes says. */
  wasOn?: boolean
}

/** The little of a Hermes this needs (hermes.ts). */
export type TelegramHermes = Pick<Hermes, 'send' | 'peek'>

export type Deps = {
  hermes: (connection: string) => TelegramHermes | null
  /** Where pairings are kept between restarts. */
  file: () => string
}

/** How often to ask Hermes while waiting, and the most to back off to when it isn't answering. */
export const POLL_MS = 2500
export const MAX_BACKOFF_MS = 30_000
/** Finished setups are forgotten after this, if nobody dismissed them. */
const KEEP_MS = 24 * 60 * 60_000
const META_KEY = 'murmur-telegram'

const COPY = {
  restarted: 'Hermes restarted before Telegram finished.',
  claimed: 'That code was used somewhere else.',
  noOwner: 'Telegram didn’t say who you are.',
  notSaved: 'Hermes couldn’t save the bot.',
  unreachable: 'Can’t reach Hermes. Check that it’s running, then try again.',
  service: 'Telegram setup isn’t reachable right now. Try again in a moment.',
  unknown: 'Something went wrong setting up Telegram. Try again.',
}

const terminal = (phase: Phase) => phase === 'connected' || phase === 'expired' || phase === 'failed'
const keyOf = (connection: string, profile: string) => `${connection}\n${profile}`
const onboarding = (id: string) => `/api/messaging/telegram/onboarding/${encodeURIComponent(id)}`
const detailOf = (body: unknown) => {
  const detail = (body as { detail?: unknown } | null)?.detail
  return typeof detail === 'string' ? detail : undefined
}

export class StartError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function createPairings(deps: Deps) {
  const all = new Map<string, Saved>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Pairing ids being looked at right now. */
  const busy = new Set<string>()
  const failures = new Map<string, number>()
  let stopped = false

  // ── Keeping ───────────────────────────────────────────────────────────────

  function load() {
    let saved: Saved[] = []
    try {
      saved = (JSON.parse(readFileSync(deps.file(), 'utf8')) as { pairings?: Saved[] }).pairings ?? []
    } catch {
      // None yet.
    }
    for (const p of saved) {
      if (p && typeof p.id === 'string' && typeof p.connection === 'string' && typeof p.profile === 'string')
        all.set(keyOf(p.connection, p.profile), p)
    }
  }

  /** Atomic, owner-only, like murmur.json. */
  function save() {
    const file = deps.file()
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify({ pairings: [...all.values()] }, null, 2) + '\n', { mode: 0o600 })
      chmodSync(tmp, 0o600)
      renameSync(tmp, file)
    } catch (error) {
      console.warn(`Murmur: couldn’t save Telegram setup to ${file} (${(error as Error).message}).`)
    }
  }

  function prune() {
    let changed = false
    for (const [key, p] of all) {
      if (terminal(p.phase) && Date.now() - p.updatedAt > KEEP_MS) {
        all.delete(key)
        changed = true
      }
    }
    if (changed) save()
  }

  function update(key: string, id: string, changes: Partial<Saved>) {
    const p = all.get(key)
    // Cancelled, or replaced by a newer code, while Hermes was answering.
    if (!p || p.id !== id) return false
    all.set(key, { ...p, ...changes, updatedAt: Date.now() })
    save()
    return true
  }

  /** Settled for good: nothing more to ask Hermes. */
  function settle(key: string, id: string, phase: Phase, message?: string): null {
    update(key, id, { phase, message })
    return null
  }

  // ── Watching ──────────────────────────────────────────────────────────────

  function schedule(key: string, delay: number) {
    clearTimeout(timers.get(key))
    if (stopped) return
    timers.set(
      key,
      setTimeout(() => void tick(key), delay),
    )
  }

  async function tick(key: string) {
    timers.delete(key)
    const p = all.get(key)
    // One look at a time per code; the one under way schedules the next.
    if (!p || terminal(p.phase) || busy.has(p.id)) return
    busy.add(p.id)
    let next: number | null
    try {
      next = await step(key, p)
    } catch (error) {
      console.warn(`Murmur: Telegram setup check failed (${(error as Error).message}).`)
      next = backoff(key)
    } finally {
      busy.delete(p.id)
    }
    if (next === null) failures.delete(key)
    else if (all.get(key)?.id === p.id && !terminal(all.get(key)!.phase)) schedule(key, next)
  }

  /** Hermes or the setup service didn't answer: wait longer each time, up to a limit. */
  function backoff(key: string) {
    const n = (failures.get(key) ?? 0) + 1
    failures.set(key, n)
    return Math.min(POLL_MS * 2 ** n, MAX_BACKOFF_MS)
  }

  const steady = (key: string) => (failures.delete(key), POLL_MS)

  /** One look at Hermes; the delay before the next, or null when it's settled. */
  async function step(key: string, p: Saved): Promise<number | null> {
    const hermes = deps.hermes(p.connection)
    if (!hermes) {
      // That Hermes was removed from Murmur: nothing left to finish.
      all.delete(key)
      save()
      return null
    }
    const late = Date.now() >= p.expiresAt
    let res: { status: number; body: unknown }
    try {
      res = await hermes.send('GET', onboarding(p.id))
    } catch {
      if (late) return finishLate(key, p, hermes)
      return backoff(key)
    }
    if (res.status === 404) {
      // Hermes no longer has it: it restarted, its time ran out, or it was saved
      // by someone else (an older Murmur tab). Which, Hermes's settings say.
      if ((p.phase === 'applying' || p.wasOn === false) && (await landed(hermes, p.profile))) return connected(key, p, hermes, p.username)
      return settle(key, p.id, late ? 'expired' : 'failed', late ? undefined : COPY.restarted)
    }
    if (res.status === 410) {
      const expired = /expired/i.test(detailOf(res.body) ?? '') || late
      return settle(key, p.id, expired ? 'expired' : 'failed', expired ? undefined : COPY.claimed)
    }
    if (res.status < 200 || res.status >= 300) return late ? finishLate(key, p, hermes) : backoff(key)

    const body = (res.body ?? {}) as { status?: unknown; bot_username?: unknown; owner_user_id?: unknown }
    if (body.status === 'waiting') return late ? settle(key, p.id, 'expired') : steady(key)
    if (body.status !== 'ready') return backoff(key)
    if (typeof body.owner_user_id !== 'string' || !body.owner_user_id) return settle(key, p.id, 'failed', COPY.noOwner)

    const username = (typeof body.bot_username === 'string' && body.bot_username) || p.username
    if (!update(key, p.id, { phase: 'applying', username })) return null
    return apply(key, { ...p, username }, hermes, body.owner_user_id)
  }

  /** Save the bot for this agent, allowing only the person who paired. Hermes forgets the pairing once it has. */
  async function apply(key: string, p: Saved, hermes: TelegramHermes, owner: string): Promise<number | null> {
    let res: { status: number; body: unknown }
    try {
      res = await hermes.send(
        'POST',
        `${onboarding(p.id)}/apply?profile=${encodeURIComponent(p.profile)}`,
        { allowed_user_ids: [owner], profile: p.profile },
        30_000,
      )
    } catch {
      return backoff(key)
    }
    if (res.status >= 200 && res.status < 300) {
      const name = (res.body as { bot_username?: unknown } | null)?.bot_username
      return connected(key, p, hermes, (typeof name === 'string' && name) || p.username)
    }
    if (res.status === 404 && /setup session/i.test(detailOf(res.body) ?? '')) {
      if (await landed(hermes, p.profile)) return connected(key, p, hermes, p.username)
      return settle(key, p.id, 'failed', COPY.restarted)
    }
    // Not ready after all: look again.
    if (res.status === 409) return steady(key)
    if (res.status >= 400 && res.status < 500) return settle(key, p.id, 'failed', detailOf(res.body) ?? COPY.notSaved)
    return backoff(key)
  }

  /** Past the code's time without an answer: Hermes has let it go, so this is the last look. */
  async function finishLate(key: string, p: Saved, hermes: TelegramHermes): Promise<null> {
    if (p.phase === 'applying' && (await landed(hermes, p.profile))) return connected(key, p, hermes, p.username)
    return p.phase === 'applying' ? settle(key, p.id, 'failed', COPY.notSaved) : settle(key, p.id, 'expired')
  }

  async function connected(key: string, p: Saved, hermes: TelegramHermes, username?: string): Promise<null> {
    if (!update(key, p.id, { phase: 'connected', username, message: undefined })) return null
    // Hermes doesn't keep the bot's @username; the agent's ui_meta does, for every device.
    if (username) {
      await hermes
        .peek([['profiles.configure', { name: p.profile, ui_meta: { [META_KEY]: { username, since: Date.now() } } }]])
        .catch(() => {})
    }
    return null
  }

  /** Whether Telegram is saved and on for this agent (`unknown` when Hermes didn't say). Hermes can take 15s or more to answer. */
  async function landed<U = false>(hermes: TelegramHermes, profile: string, unknown: U = false as U): Promise<boolean | U> {
    try {
      const res = await hermes.send<{ platforms?: { id: string; enabled?: boolean; configured?: boolean }[] }>(
        'GET',
        `/api/messaging/platforms?profile=${encodeURIComponent(profile)}`,
        undefined,
        45_000,
      )
      if (res.status < 200 || res.status >= 300) return unknown
      const telegram = res.body?.platforms?.find((x) => x.id === 'telegram')
      return Boolean(telegram?.enabled && telegram.configured)
    } catch {
      return unknown
    }
  }

  // ── Asking ────────────────────────────────────────────────────────────────

  function view(saved: Saved): Pairing {
    const { connection, id, wasOn, ...p } = saved
    // A code past its time is expired, whatever the last look said.
    return p.phase === 'waiting' && Date.now() >= p.expiresAt ? { ...p, phase: 'expired' } : p
  }

  function list(connection: string): Pairing[] {
    prune()
    return [...all.values()].filter((p) => p.connection === connection).map(view)
  }

  async function start(connection: string, profile: string, name: string): Promise<Pairing> {
    const hermes = deps.hermes(connection)
    if (!hermes) throw new StartError(409, 'hermes_gone')
    let res: { status: number; body: unknown }
    try {
      res = await hermes.send('POST', '/api/messaging/telegram/onboarding/start', { bot_name: name })
    } catch {
      throw new StartError(502, COPY.unreachable)
    }
    if (res.status < 200 || res.status >= 300) {
      throw new StartError(502, res.status === 502 || res.status === 503 ? COPY.service : COPY.unknown)
    }
    const body = (res.body ?? {}) as { pairing_id?: unknown; deep_link?: unknown; qr_payload?: unknown; expires_at?: unknown }
    if (typeof body.pairing_id !== 'string' || typeof body.deep_link !== 'string') throw new StartError(502, COPY.service)
    const expiresAt = Date.parse(String(body.expires_at))
    const key = keyOf(connection, profile)
    // A code still showing for this agent stops working: one bot per agent.
    const previous = all.get(key)
    if (previous?.phase === 'waiting') void release(connection, previous.id)
    const pairing: Saved = {
      connection,
      profile,
      id: body.pairing_id,
      phase: 'waiting',
      link: body.deep_link,
      qr: (typeof body.qr_payload === 'string' && body.qr_payload) || body.deep_link,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 10 * 60_000,
      updatedAt: Date.now(),
    }
    all.set(key, pairing)
    failures.delete(key)
    save()
    schedule(key, POLL_MS)
    // Whether Telegram was on already, so a code Hermes forgets is never taken
    // for a finished one. Hermes can take a while to say; nobody waits for it.
    void landed(hermes, profile, null).then((on) => on !== null && update(key, pairing.id, { wasOn: on }))
    return view(pairing)
  }

  async function release(connection: string, id: string) {
    await deps
      .hermes(connection)
      ?.send('DELETE', onboarding(id))
      .catch(() => {})
  }

  /** Stop waiting (Hermes lets the code go), or forget a finished setup. */
  function cancel(connection: string, profile: string) {
    const key = keyOf(connection, profile)
    const p = all.get(key)
    if (!p) return
    all.delete(key)
    clearTimeout(timers.get(key))
    timers.delete(key)
    failures.delete(key)
    save()
    if (p.phase === 'waiting') void release(connection, p.id)
  }

  /** Carry on with what was waiting before a restart. */
  function resume() {
    load()
    prune()
    for (const [key, p] of all) if (!terminal(p.phase)) schedule(key, 0)
  }

  function stop() {
    stopped = true
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }

  return { list, start, cancel, resume, stop }
}

// ── Murmur's own ────────────────────────────────────────────────────────────

let pairings: ReturnType<typeof createPairings> | null = null

/** Called once the server's settings are known: picks up setups a restart interrupted. */
export function startTelegram() {
  pairings?.stop()
  pairings = createPairings({ hermes: hermesById, file: () => join(dataDir(), 'telegram.json') })
  pairings.resume()
}

export function stopTelegram() {
  pairings?.stop()
  pairings = null
}

const cleanProfile = (raw: unknown) => (typeof raw === 'string' ? raw.trim().slice(0, 128) : '')
const reply = (res: http.ServerResponse, status: number, body: unknown) => (sendJson(res, status, body), true)

export async function handleTelegram(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
  if (path !== '/murmur/telegram' && !path.startsWith('/murmur/telegram/')) return false
  if (!pairings) startTelegram()
  const store = pairings!
  const target = requestTarget(req)
  if (!target) return reply(res, 409, { error: 'hermes_gone' })

  if (path === '/murmur/telegram' && req.method === 'GET') return reply(res, 200, { pairings: store.list(target.id) })
  if (req.method !== 'POST') return false
  const body = (await readJson(req).catch(() => ({}))) as { profile?: unknown; name?: unknown }
  const profile = cleanProfile(body.profile)
  if (!profile) return reply(res, 422, { error: 'Say which agent.' })

  if (path === '/murmur/telegram/start') {
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : 'Hermes Agent'
    try {
      return reply(res, 200, { pairing: await store.start(target.id, profile, name) })
    } catch (error) {
      if (!(error instanceof StartError)) throw error
      return reply(res, error.status, { error: error.message })
    }
  }
  if (path === '/murmur/telegram/cancel') {
    store.cancel(target.id, profile)
    return reply(res, 200, { ok: true })
  }
  return false
}
