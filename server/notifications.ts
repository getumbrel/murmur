// Notifications, sent by Murmur's server, so they reach a phone whose tabs are
// closed and a computer that's asleep: the server notices what agents do
// (watch.ts) and tells the person's devices. The app only says which devices
// want telling, and where the person is.
//
//   GET    /murmur/notifications              ?device=<id> → {key, known, native}
//   POST   /murmur/notifications/devices      {subscription, previous?} → {device}: this browser, by Web Push
//                                             (previous: the endpoint a renewed subscription replaces)
//                                             {native: true} → {device}: the desktop app, which shows them itself
//   DELETE /murmur/notifications/devices/:id  → {ok}
//   POST   /murmur/notifications/shown        {endpoint, id?} → {missed}: this browser showed note `id`;
//                                             the others it was sent and hasn't shown (see Catching up)
//   POST   /murmur/presence                   {tab, device?, hermes?, active, viewing?} or {tab, gone: true} → 204
//
// Who's told: nobody, when someone active is already looking at that chat;
// else the devices the person is active on, if they're active anywhere; else
// every device. A question still open when the person goes away is told to
// every device then, once. Active is a tab in front, in a focused window,
// touched in the last two minutes (the app decides, and says so as it changes).
//
// Devices and Murmur's push keys are kept in DATA_DIR/notifications.json; the
// notes a device hasn't shown yet, only in memory.

import type http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Note } from '../shared/notes.ts'
import { dataDir } from './config.ts'
import { hermesById, knownTargets, onDrop } from './connection.ts'
import type { Hermes } from './hermes.ts'
import { readJson, secure, sendJson } from './http.ts'
import { watchHermes, type Moment } from './watch.ts'
import { generateVapidKeys, sendPush, validPushKey, validVapidKeys, type PushOptions, type PushResult, type Subscription, type VapidKeys } from './web-push.ts'

/** A note as the desktop app shows it, with the Hermes it's from (for where clicking goes). */
export type NativeNote = Note & { hermes: string }

export type NotifyOptions = {
  /** Shows a note on this computer: the desktop app, which embeds the server. */
  notify?: (note: NativeNote) => void
  /** Where devices and keys are kept. Default: DATA_DIR/notifications.json. */
  file?: () => string
  /** Watches one Hermes (watch.ts); tests pass their own. */
  watch?: (hermes: Hermes, tell: (moment: Moment) => void) => { stop(): void }
  /** Sends one push (web-push.ts); tests pass their own. */
  push?: (subscription: Subscription, payload: string, keys: VapidKeys, options: PushOptions) => Promise<PushResult>
}

type Device = Subscription & { id: string; /** Where its links open. */ origin: string; since: number }
type Stored = { vapid?: VapidKeys; devices?: Device[]; native?: boolean }
type Tab = { device?: string; hermes?: string; active: boolean; viewing?: string; at: number }
type Ask = { note: Note; hermes: string; everyone: boolean }
/** A note as one device was sent it. */
type Sent = { id: string; note: Note; hermes: string; ask: boolean; at: number; until: number }

export const NATIVE = 'desktop'
/** A tab not heard from in this long has gone, or its computer is asleep (it says every 20 seconds while in front). */
export const TAB_TTL_MS = 50_000
const SWEEP_MS = 15_000
/** More than anyone signs up; past it, the device signed up longest ago makes room. */
const MAX_DEVICES = 24
/** A question is worth an hour; a finished reply, a day. */
const TTL = { ask: 60 * 60, note: 24 * 60 * 60 }
/** The most a device catching up is shown at once. */
const CATCH_UP = 8

const deviceId = (endpoint: string) => createHash('sha256').update(endpoint).digest('base64url').slice(0, 22)
const base64url = (value: unknown, bytes: number) => typeof value === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(value) && Buffer.from(value, 'base64url').length === bytes

/** A subscription a browser could have made: an https push service, and its keys. */
function subscriptionOf(raw: unknown): Subscription | null {
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  if (typeof s?.endpoint !== 'string' || s.endpoint.length > 2048 || !URL.canParse(s.endpoint)) return null
  if (new URL(s.endpoint).protocol !== 'https:') return null
  if (!base64url(s.keys?.p256dh, 65) || !base64url(s.keys?.auth, 16) || !validPushKey(s.keys!.p256dh as string)) return null
  return { endpoint: s.endpoint, keys: { p256dh: s.keys!.p256dh as string, auth: s.keys!.auth as string } }
}

const text = (value: unknown, max: number) => (typeof value === 'string' && value && value.length <= max ? value : undefined)

export function createNotifications(options: NotifyOptions = {}) {
  const file = options.file ?? (() => join(dataDir(), 'notifications.json'))
  const watch = options.watch ?? watchHermes
  const push = options.push ?? sendPush
  /** Replaced (startNotifications) or shut down: what was still on its way changes nothing. */
  let stopped = false

  // ── Keeping ───────────────────────────────────────────────────────────────

  let stored: Stored = {}
  try {
    stored = JSON.parse(readFileSync(file(), 'utf8')) as Stored
  } catch {
    // None yet.
  }
  stored.devices = (stored.devices ?? []).filter((d) => d && typeof d.id === 'string' && subscriptionOf(d))

  /** Atomic, owner-only: the private key signs Murmur's pushes. */
  function save() {
    if (stopped) return
    const path = file()
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 })
      chmodSync(tmp, 0o600)
      renameSync(tmp, path)
    } catch (error) {
      console.warn(`Murmur: couldn’t save notification settings to ${path} (${(error as Error).message}).`)
    }
  }

  function vapid(): VapidKeys {
    if (!validVapidKeys(stored.vapid)) {
      stored.vapid = generateVapidKeys()
      save()
    }
    return stored.vapid
  }

  const devices = () => stored.devices!
  const native = () => Boolean(options.notify && stored.native)
  const anyDevice = () => devices().length > 0 || native()

  // ── Where the person is ───────────────────────────────────────────────────

  const tabs = new Map<string, Tab>()
  /** Questions told and not yet answered, by Hermes and Hermes's own key for them. */
  const asks = new Map<string, Ask>()
  let wasActive = false

  function activeTabs() {
    const cutoff = Date.now() - TAB_TTL_MS
    for (const [id, tab] of tabs) if (tab.at < cutoff) tabs.delete(id)
    return [...tabs.values()].filter((t) => t.active)
  }

  /** Someone just went away: questions still open are told everywhere, once. */
  function settle() {
    const active = activeTabs().length > 0
    if (wasActive && !active) {
      for (const ask of asks.values()) {
        if (ask.everyone) continue
        ask.everyone = true
        send(ask.note, ask.hermes, everyDevice(), true)
      }
    }
    wasActive = active
  }

  // ── Telling ───────────────────────────────────────────────────────────────

  type Target = { kind: 'push'; device: Device } | { kind: 'native' }
  /** Pushes a push service turned away in a row, by device. */
  const refusals = new Map<string, number>()

  const everyDevice = (): Target[] => [
    ...devices().map((device): Target => ({ kind: 'push', device })),
    ...(native() ? [{ kind: 'native' } as const] : []),
  ]

  /** Who hears a note now: undefined when someone's looking at it already. */
  function audience(note: Note, hermes: string): { to: Target[]; everyone: boolean } | undefined {
    const active = activeTabs()
    if (active.some((t) => t.viewing === note.tag && (!t.hermes || t.hermes === hermes))) return undefined
    if (!active.length) return { to: everyDevice(), everyone: true }
    const here = new Set(active.map((t) => t.device))
    return { to: everyDevice().filter((t) => here.has(t.kind === 'native' ? NATIVE : t.device.id)), everyone: false }
  }

  function send(note: Note, hermes: string, to: Target[], ask: boolean) {
    for (const target of to) {
      if (target.kind === 'native') {
        try {
          options.notify?.({ ...note, hermes })
        } catch (error) {
          console.warn(`Murmur: couldn’t show a notification (${(error as Error).message}).`)
        }
        continue
      }
      const { device } = target
      const ttl = ask ? TTL.ask : TTL.note
      void push(device, payloadFor(note, hermes, device.origin, keep(device.id, note, hermes, ask)), vapid(), {
        ttl,
        // Every note is shown, and is about something the person started: worth
        // waking a phone for. At `normal`, Android holds it while the phone dozes.
        // No Topic: a push service keeps only a few while a phone is away.
        urgency: 'high',
      }).then((result) => {
        if (stopped) return
        // Turned away for Murmur's key: a subscription made for keys Murmur no longer has.
        const refused = result.status === 401 || result.status === 403
        const strikes = refused ? (refusals.get(device.id) ?? 0) + 1 : 0
        refusals.set(device.id, strikes)
        // Gone (unsubscribed, or expired), or turned away every time: the browser subscribes again when it's next opened.
        if (result.gone || strikes >= 3) forget(device.id)
        else if (result.status < 200 || result.status >= 300) console.warn(`Murmur: a push to ${new URL(device.endpoint).host} failed (${result.status || 'unreachable'}).`)
      })
    }
  }

  function hear(hermes: string, moment: Moment) {
    if (moment.kind === 'answered') {
      const key = `${hermes}\n${moment.key}`
      const answered = asks.get(key)
      asks.delete(key)
      if (answered) unsee((sent) => sent.note === answered.note)
      return
    }
    const ask = moment.kind === 'ask'
    const heard = audience(moment.note, hermes)
    if (ask) asks.set(`${hermes}\n${moment.key}`, { note: moment.note, hermes, everyone: heard?.everyone ?? false })
    if (heard) send(moment.note, hermes, heard.to, ask)
  }

  // ── Catching up ───────────────────────────────────────────────────────────
  //
  // Chrome on Android keeps one push waiting at a time (while the phone dozes,
  // in a burst, coming back online) and drops any that land meanwhile, though
  // the push service took them. So what each device is sent is kept until it
  // says it's shown it, and whichever push gets through brings the rest
  // (public/sw.js).

  /** What each device was sent and hasn't shown, newest per chat or group, oldest first: by device, then tag. */
  const unshown = new Map<string, Map<string, Sent>>()

  function keep(device: string, note: Note, hermes: string, ask: boolean): Sent {
    const now = Date.now()
    const kept = unshown.get(device) ?? new Map<string, Sent>()
    for (const [tag, old] of kept) if (old.until <= now || tag === note.tag) kept.delete(tag)
    const ttl = ask ? TTL.ask : TTL.note
    const sent = { id: randomBytes(9).toString('base64url'), note, hermes, ask, at: now, until: now + ttl * 1000 }
    unshown.set(device, kept.set(note.tag, sent))
    return sent
  }

  /** Notes no device needs showing any more: a question answered, a chat looked at. */
  function unsee(done: (sent: Sent) => boolean) {
    for (const kept of unshown.values()) for (const [tag, sent] of kept) if (done(sent)) kept.delete(tag)
  }

  /** A device showed note `id`: the others it hasn't, handed over once. */
  function catchUp(device: string, id: string | undefined) {
    const kept = unshown.get(device)
    unshown.delete(device)
    const now = Date.now()
    return [...(kept?.values() ?? [])].filter((sent) => sent.id !== id && sent.until > now).slice(-CATCH_UP)
  }

  // ── Watching ──────────────────────────────────────────────────────────────

  const watchers = new Map<string, { hermes: Hermes; stop(): void }>()

  /** One watcher per Hermes while any device wants telling; a Hermes whose address or sign-in changed is watched afresh. */
  function reconcile() {
    if (stopped) return
    const wanted = new Map<string, Hermes>()
    if (anyDevice()) {
      for (const target of knownTargets()) {
        const hermes = hermesById(target.id)
        if (hermes) wanted.set(target.id, hermes)
      }
    }
    for (const [id, watcher] of watchers) {
      if (wanted.get(id) === watcher.hermes) continue
      watcher.stop()
      watchers.delete(id)
      for (const key of asks.keys()) if (key.startsWith(`${id}\n`)) asks.delete(key)
    }
    for (const [id, hermes] of wanted) {
      if (watchers.has(id)) continue
      const watcher = watch(hermes, (moment) => hear(id, moment))
      watchers.set(id, { hermes, stop: watcher.stop })
    }
  }

  const stopDrop = onDrop(() => queueMicrotask(reconcile))
  const sweep = setInterval(() => {
    settle()
    reconcile()
  }, SWEEP_MS)
  sweep.unref?.()
  reconcile()

  // ── Devices ───────────────────────────────────────────────────────────────

  /** A browser's subscription, in place of the one it renewed (`previous`, its endpoint) if it says. */
  function remember(subscription: Subscription, origin: string, previous?: string) {
    const id = deviceId(subscription.endpoint)
    const replaced = previous ? deviceId(previous) : undefined
    const others = devices()
      .filter((d) => d.id !== id && d.id !== replaced)
      .sort((a, b) => a.since - b.since)
      .slice(-(MAX_DEVICES - 1))
    stored.devices = [...others, { id, ...subscription, origin, since: Date.now() }]
    save()
    reconcile()
    return id
  }

  function forget(id: string) {
    if (id === NATIVE) stored.native = false
    else stored.devices = devices().filter((d) => d.id !== id)
    refusals.delete(id)
    unshown.delete(id)
    save()
    reconcile()
  }

  // ── The API ───────────────────────────────────────────────────────────────

  const reply = (res: http.ServerResponse, status: number, body: unknown) => (sendJson(res, status, body), true)

  async function handle(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
    if (path === '/murmur/presence') {
      if (req.method !== 'POST') return false
      const body = (await readJson(req, 4096).catch(() => ({}))) as Record<string, unknown>
      const tab = text(body.tab, 64)
      if (!tab) return reply(res, 422, { error: 'Say which tab.' })
      if (body.gone === true) tabs.delete(tab)
      else {
        const seen: Tab = {
          device: text(body.device, 64),
          hermes: text(body.hermes, 64),
          active: body.active === true,
          viewing: text(body.viewing, 512),
          at: Date.now(),
        }
        tabs.set(tab, seen)
        if (seen.active && seen.viewing) unsee((sent) => sent.note.tag === seen.viewing && (!seen.hermes || sent.hermes === seen.hermes))
      }
      settle()
      res.writeHead(204, { 'cache-control': 'no-store' }).end()
      return true
    }

    if (path === '/murmur/notifications' && req.method === 'GET') {
      const asked = new URL(req.url ?? '/', 'http://x').searchParams.get('device')
      const known = asked === NATIVE ? native() : devices().some((d) => d.id === asked)
      return reply(res, 200, { key: vapid().publicKey, known, native: Boolean(options.notify) })
    }

    if (path === '/murmur/notifications/devices' && req.method === 'POST') {
      const body = (await readJson(req, 8192).catch(() => ({}))) as { subscription?: unknown; previous?: unknown; native?: unknown }
      if (body.native === true) {
        if (!options.notify) return reply(res, 404, { error: 'not_found' })
        stored.native = true
        save()
        reconcile()
        return reply(res, 200, { device: NATIVE })
      }
      const subscription = subscriptionOf(body.subscription)
      if (!subscription) return reply(res, 422, { error: 'That isn’t a push subscription.' })
      const origin = text(req.headers.origin, 512) ?? `${secure(req) ? 'https' : 'http'}://${req.headers.host}`
      return reply(res, 200, { device: remember(subscription, origin, text(body.previous, 2048)) })
    }

    if (path === '/murmur/notifications/shown' && req.method === 'POST') {
      const body = (await readJson(req, 4096).catch(() => ({}))) as { endpoint?: unknown; id?: unknown }
      const endpoint = text(body.endpoint, 2048)
      if (!endpoint) return reply(res, 422, { error: 'Say which device.' })
      const device = devices().find((d) => d.id === deviceId(endpoint))
      const missed = device ? catchUp(device.id, text(body.id, 64)) : []
      return reply(res, 200, { missed: missed.map((sent) => notificationFor(sent.note, sent.hermes, device!.origin, sent)) })
    }

    const one = /^\/murmur\/notifications\/devices\/([A-Za-z0-9_-]{1,64})$/.exec(path)
    if (one && req.method === 'DELETE') {
      forget(one[1])
      return reply(res, 200, { ok: true })
    }
    return false
  }

  return {
    handle,
    stop() {
      stopped = true
      stopDrop()
      clearInterval(sweep)
      for (const watcher of watchers.values()) watcher.stop()
      watchers.clear()
    },
  }
}

/**
 * What a push carries: the notification, for Murmur's service worker to show
 * (public/sw.js). Not in the declarative form Safari 18.4 and later can show
 * by itself: one Safari shows loads its link when tapped, a fresh start even
 * with Murmur open, where the worker's opens the chat in the window already
 * there. Its link names the Hermes it's from, so it opens there.
 */
export function payloadFor(note: Note, hermes: string, origin: string, sent: { id: string; at: number; ask?: boolean }) {
  return JSON.stringify({ notification: notificationFor(note, hermes, origin, sent) })
}

/**
 * A note as a notification: what a push carries, and what a device catching
 * up is handed. A question says so: caught up, it still buzzes, as it needs the person.
 */
function notificationFor(note: Note, hermes: string, origin: string, sent: { id: string; at: number; ask?: boolean }) {
  const link = new URL(note.href, origin)
  link.searchParams.set('hermes', hermes)
  return {
    title: note.title,
    body: note.body,
    tag: note.tag,
    renotify: true,
    timestamp: sent.at,
    navigate: link.href,
    icon: new URL('/icon-192.png', origin).href,
    badge: new URL('/badge-96.png', origin).href,
    data: { id: sent.id, href: note.href, hermes, ...(sent.ask && { ask: true }) },
  }
}

// ── Murmur's own ────────────────────────────────────────────────────────────

let notifications: ReturnType<typeof createNotifications> | null = null
let started: NotifyOptions = {}

/** Called once the server's settings are known: watches again for the devices that want telling. */
export function startNotifications(options: NotifyOptions = started) {
  notifications?.stop()
  started = options
  notifications = createNotifications(options)
}

export function stopNotifications() {
  notifications?.stop()
  notifications = null
}

export async function handleNotifications(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
  if (path !== '/murmur/presence' && path !== '/murmur/notifications' && !path.startsWith('/murmur/notifications/')) return false
  if (!notifications) startNotifications()
  return notifications!.handle(req, res, path)
}
