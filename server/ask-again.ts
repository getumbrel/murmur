// A question kept for when the model is back, asked again by Murmur's server.
//
//   GET  /murmur/ask-again         → {held: [{profile, chat, at}]}: this Hermes's kept questions
//   POST /murmur/ask-again         {profile, chat, at} → {ok}: keep this chat's last question, to ask
//                                  again once the limit lifts at `at` (ms)
//   POST /murmur/ask-again/cancel  {chat} → {ok}
//
// A reply that stops at a plan's limit says when the model is back
// (src/features/chat/errors.ts). The person can ask Murmur to try again then,
// and it has to hold with every tab closed and the phone asleep, so the
// server keeps it (DATA_DIR/ask-again.json) and asks, a minute after the
// limit lifts: the chat's last message again, in its place, the way Try
// again does it. The reply lands like any other, and notifications.ts tells
// the person's devices.
//
// It only ever asks what the person already asked. Before it does, it reads
// the chat: if its last word isn't still that stopped reply (they wrote
// something since, tried again, deleted it), the question is let go, quietly.
// A limit that hasn't lifted after all is waited out once more; after that
// it's let go, and the note in the chat says when the model is back, as before.

import type http from 'node:http'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dataDir } from './config.ts'
import { hermesById, requestTarget } from './connection.ts'
import type { Hermes } from './hermes.ts'
import { readJson, sendJson } from './http.ts'
import { openSocket, type HermesEvent, type HermesSocket } from './socket.ts'

/** What the app sees. */
export type Held = { profile: string; chat: string; at: number; row?: number }

type Saved = Held & {
  /** The Hermes (connection id) it's on. */
  connection: string
  /** How many times it's been asked again already. */
  tries: number
  /** The message it is (Hermes's row), so a later one is never asked in its place. */
  row?: number
}

type Row = {
  id: number
  role: string
  content?: string | null
  display_kind?: string | null
  display_content?: string | null
  display_metadata?: { error_surface?: unknown } | null
  pictures?: unknown[]
  timestamp?: number
}

/** The little of a Hermes this needs. */
export type AskHermes = Pick<Hermes, 'read'> & {
  /** A socket for one asking (socket.ts), closed when the reply is over. */
  open: (handlers: { onEvent: (event: HermesEvent) => void; onOpen: () => void }) => HermesSocket
}

export type Deps = {
  hermes: (connection: string) => AskHermes | null
  /** Where questions are kept between restarts. */
  file: () => string
  now?: () => number
}

/** After the limit lifts, so the service's clock and this one can disagree a little. */
export const MARGIN_MS = 60_000
/** A limit this far off isn't one to wait for. */
export const FURTHEST_MS = 31 * 24 * 60 * 60_000
/** Found this long after its time (the server was off): too late to be what the person meant. */
export const TOO_LATE_MS = 24 * 60 * 60_000
/** Asked this many times, with the limit still there each time, it's let go. */
export const TRIES = 2
/** Hermes out of reach, or the chat busy: looked at again this often, this many times. */
export const RETRY_MS = 60_000
export const REACH_TRIES = 5
/** How long a reply may take (Hermes waits out a limit by itself for up to twenty minutes). */
export const REPLY_MS = 45 * 60_000

const keyOf = (connection: string, chat: string) => `${connection}\n${chat}`
const q = encodeURIComponent

/** When a limit lifts (ms), as Hermes's error surface names it: `limitLiftsAt` in the app, without its minute's grace. */
export function liftsAt(surface: unknown): number | undefined {
  if (!surface || typeof surface !== 'object') return undefined
  const s = surface as { resets_at?: unknown; usage_limit?: { resets_at_ms?: unknown } | null }
  const ms =
    typeof s.resets_at === 'number'
      ? s.resets_at * 1000
      : typeof s.usage_limit?.resets_at_ms === 'number'
        ? s.usage_limit.resets_at_ms
        : NaN
  return Number.isFinite(ms) ? ms : undefined
}

/**
 * The question to ask again, from a chat's newest rows (oldest first): its
 * last message, when the last thing in the chat is the reply to it that
 * stopped. Undefined when the chat has moved on, or the message isn't words
 * alone (a picture or a file is sent another way).
 */
export function questionIn(rows: Row[]): { row: number; text: string } | undefined {
  const last = rows.at(-1)
  if (last?.role !== 'assistant' || last.display_kind !== 'failed_turn') return undefined
  const asked = rows.findLast((r) => r.role === 'user')
  if (!asked || typeof asked.content !== 'string' || !asked.content.trim()) return undefined
  // Nothing of the agent's own between the two: a reply that got somewhere before it stopped isn't asked over.
  if (rows.slice(rows.indexOf(asked) + 1, -1).length) return undefined
  if (asked.pictures?.length || asked.display_content != null) return undefined
  return { row: asked.id, text: asked.content }
}

export function createAskAgain(deps: Deps) {
  const now = deps.now ?? Date.now
  const all = new Map<string, Saved>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Being asked right now: the sockets to close on the way out. */
  const asking = new Map<string, HermesSocket>()
  const unreached = new Map<string, number>()
  let stopped = false

  // ── Keeping ───────────────────────────────────────────────────────────────

  function load() {
    let saved: Saved[] = []
    try {
      saved = (JSON.parse(readFileSync(deps.file(), 'utf8')) as { held?: Saved[] }).held ?? []
    } catch {
      // None yet.
    }
    all.clear()
    for (const h of saved) {
      if (
        typeof h?.connection === 'string' &&
        typeof h.chat === 'string' &&
        typeof h.profile === 'string' &&
        Number.isFinite(h.at)
      )
        all.set(keyOf(h.connection, h.chat), {
          connection: h.connection,
          profile: h.profile,
          chat: h.chat,
          at: h.at,
          tries: h.tries || 0,
          ...(typeof h.row === 'number' ? { row: h.row } : {}),
        })
    }
  }

  function save() {
    const file = deps.file()
    try {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify({ held: [...all.values()] }, null, 2))
      chmodSync(tmp, 0o600)
      renameSync(tmp, file)
    } catch (error) {
      console.error(`Couldn’t save ${file}:`, error instanceof Error ? error.message : error)
    }
  }

  function letGo(key: string) {
    clearTimeout(timers.get(key))
    timers.delete(key)
    unreached.delete(key)
    if (all.delete(key)) save()
  }

  function schedule(key: string, delay: number) {
    if (stopped) return
    clearTimeout(timers.get(key))
    // (A timer can't be set further off than about 24 days: look again then.)
    const timer = setTimeout(() => void due(key), Math.min(Math.max(0, delay), 2 ** 31 - 1))
    timer.unref?.()
    timers.set(key, timer)
  }

  // ── Asking ────────────────────────────────────────────────────────────────

  /** The question a chat ends on, undefined if it doesn't end on one, null if Hermes didn't say. */
  async function questionOf(hermes: AskHermes, chat: string, profile: string) {
    const res = await hermes.read<{ messages?: Row[] }>(
      `/api/sessions/${q(chat)}/messages?profile=${q(profile)}&order=latest&limit=20`,
      10_000,
    )
    if (!res) return null
    return questionIn([...(res.messages ?? [])].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0) || a.id - b.id))
  }

  async function due(key: string) {
    const held = all.get(key)
    if (!held || stopped || asking.has(key)) return
    const wait = held.at + MARGIN_MS - now()
    if (wait > 0) return schedule(key, wait)
    if (-wait > TOO_LATE_MS) return letGo(key)
    const hermes = deps.hermes(held.connection)
    // That Hermes was removed from Murmur: nothing to ask.
    if (!hermes) return letGo(key)

    const later = () => {
      const n = (unreached.get(key) ?? 0) + 1
      unreached.set(key, n)
      return n >= REACH_TRIES ? letGo(key) : schedule(key, RETRY_MS)
    }

    const question = await questionOf(hermes, held.chat, held.profile)
    if (all.get(key) !== held || stopped) return
    if (question === null) return later()
    // The chat has moved on (a new message, even one that stopped the same way): not what was asked for.
    if (!question || (held.row != null && question.row !== held.row)) return letGo(key)

    let outcome: Outcome
    try {
      outcome = await ask(key, hermes, held, question)
    } catch {
      outcome = { kind: 'unreached' }
    } finally {
      asking.get(key)?.close()
      asking.delete(key)
    }
    if (!all.has(key) || stopped) return
    if (outcome.kind === 'unreached') return later()
    unreached.delete(key)
    // Still at its limit, and it says until when: once more, then.
    if (outcome.kind === 'limited' && held.tries + 1 < TRIES && outcome.at - now() < FURTHEST_MS) {
      // (Asked again, it's a new row: the one Hermes named, or whichever the chat ends on then.)
      all.set(key, {
        connection: held.connection,
        profile: held.profile,
        chat: held.chat,
        at: outcome.at,
        tries: held.tries + 1,
        ...(outcome.row != null ? { row: outcome.row } : {}),
      })
      save()
      return schedule(key, outcome.at + MARGIN_MS - now())
    }
    letGo(key)
  }

  type Outcome = { kind: 'answered' } | { kind: 'limited'; at: number; row?: number } | { kind: 'unreached' }

  /** Ask the question again in its place, and stay until the reply is over (Hermes lets a chat nobody's on go). */
  function ask(key: string, hermes: AskHermes, held: Saved, question: { row: number; text: string }) {
    return new Promise<Outcome>((resolve) => {
      let runtime: string | undefined
      let begun = false
      let row: number | undefined
      const done = (outcome: Outcome) => {
        clearTimeout(limit)
        resolve(outcome)
      }
      const limit = setTimeout(() => done(begun ? { kind: 'answered' } : { kind: 'unreached' }), REPLY_MS)
      limit.unref?.()
      const socket = hermes.open({
        onEvent: (event) => {
          if (!runtime || event.session_id !== runtime || event.type !== 'message.complete') return
          const payload = (event.payload ?? {}) as { status?: unknown; error_surface?: unknown }
          const at = payload.status === 'error' ? liftsAt(payload.error_surface) : undefined
          done(at && at > now() ? { kind: 'limited', at, row } : { kind: 'answered' })
        },
        onOpen: () => {
          // Hermes came back mid-reply: the reply is its own business now.
          if (begun) return done({ kind: 'answered' })
          begun = true
          void (async () => {
            try {
              const resumed = await socket.call<{ session_id?: string; running?: boolean }>('session.resume', {
                session_id: held.chat,
                profile: held.profile,
                source: 'desktop',
                omit_messages: true,
                lazy: true,
              })
              if (!resumed.session_id) return done({ kind: 'unreached' })
              // Already replying: someone got there first.
              if (resumed.running) return done({ kind: 'answered' })
              runtime = resumed.session_id
              const sent = await socket.call<{ user_row_id?: unknown }>('prompt.submit', {
                session_id: runtime,
                text: question.text,
                profile: held.profile,
                truncate_before_row_id: question.row,
                confirm_truncate: true,
                confirm_empty_truncate: true,
              })
              if (typeof sent?.user_row_id === 'number') row = sent.user_row_id
            } catch {
              begun = false
              done({ kind: 'unreached' })
            }
          })()
        },
      })
      asking.set(key, socket)
    })
  }

  // ── What the app asks for ─────────────────────────────────────────────────

  const list = (connection: string): Held[] =>
    [...all.values()].filter((h) => h.connection === connection).map(({ profile, chat, at, row }) => ({ profile, chat, at, ...(row != null ? { row } : {}) }))

  /** Keep a chat's last question. False when the chat doesn't end on one that can be asked again. */
  async function hold(connection: string, profile: string, chat: string, at: number) {
    const hermes = deps.hermes(connection)
    const question = hermes && (await questionOf(hermes, chat, profile))
    if (!question || stopped) return false
    const key = keyOf(connection, chat)
    all.set(key, { connection, profile, chat, at, tries: 0, row: question.row })
    unreached.delete(key)
    save()
    schedule(key, at + MARGIN_MS - now())
    return true
  }

  function cancel(connection: string, chat: string) {
    const key = keyOf(connection, chat)
    // (One being asked this moment carries on: the reply has begun, and Stop is in the chat.)
    letGo(key)
  }

  /** Carry on with what was kept before a restart. */
  function resume() {
    load()
    for (const [key, h] of all) schedule(key, h.at + MARGIN_MS - now())
  }

  function stop() {
    stopped = true
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    for (const socket of asking.values()) socket.close()
    asking.clear()
  }

  return { list, hold, cancel, resume, stop, due }
}

// ── Murmur's own ────────────────────────────────────────────────────────────

let store: ReturnType<typeof createAskAgain> | null = null

/** Called once the server's settings are known: picks up questions kept before a restart. */
export function startAskAgain() {
  store?.stop()
  store = createAskAgain({
    hermes: (id) => {
      const hermes = hermesById(id)
      return hermes && { read: hermes.read, open: (handlers) => openSocket(hermes, handlers) }
    },
    file: () => join(dataDir(), 'ask-again.json'),
  })
  store.resume()
}

export function stopAskAgain() {
  store?.stop()
  store = null
}

const clean = (raw: unknown, max: number) => (typeof raw === 'string' ? raw.trim().slice(0, max) : '')
const reply = (res: http.ServerResponse, status: number, body: unknown) => (sendJson(res, status, body), true)

export async function handleAskAgain(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
  if (path !== '/murmur/ask-again' && path !== '/murmur/ask-again/cancel') return false
  if (!store) startAskAgain()
  const target = requestTarget(req)
  if (!target) return reply(res, 409, { error: 'hermes_gone' })

  if (path === '/murmur/ask-again' && req.method === 'GET') return reply(res, 200, { held: store!.list(target.id) })
  if (req.method !== 'POST') return false
  const body = (await readJson(req).catch(() => ({}))) as { profile?: unknown; chat?: unknown; at?: unknown }
  const chat = clean(body.chat, 256)
  if (!chat) return reply(res, 422, { error: 'Say which chat.' })

  if (path === '/murmur/ask-again/cancel') {
    store!.cancel(target.id, chat)
    return reply(res, 200, { ok: true })
  }
  const profile = clean(body.profile, 128)
  const at = typeof body.at === 'number' && Number.isFinite(body.at) ? body.at : NaN
  if (!profile) return reply(res, 422, { error: 'Say which agent.' })
  if (!(at > Date.now()) || at - Date.now() > FURTHEST_MS) return reply(res, 422, { error: 'That time has passed.' })
  if (!(await store!.hold(target.id, profile, chat, at)))
    return reply(res, 422, { error: 'There’s nothing to ask again in that chat.' })
  return reply(res, 200, { ok: true })
}
