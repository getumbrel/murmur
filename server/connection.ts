// Murmur's Hermes instances, which one each browser uses, and the API that manages them.
//
//   GET    /murmur/connections               → State: every Hermes with its status, and this browser's
//   POST   /murmur/connections               {name?, url, username?, password?, activate?} → tests, saves
//   PATCH  /murmur/connections/:id           {name} renames; {url, username?, password?} tests, then saves
//   DELETE /murmur/connections/:id           → forgets one (never the managed one)
//   POST   /murmur/connections/:id/activate  → this browser uses it from now on
//
// The older single-Hermes API still works, on the Hermes the request is for:
//
//   GET    /murmur/connection        → its Connection
//   POST   /murmur/connection/test   {url, username?, password?} → Connection, nothing saved
//   PUT    /murmur/connection        {url, username?, password?} → tests, saves (adds one on a first run)
//   DELETE /murmur/connection        → forgets it
//
// Which Hermes a request is for: the `x-murmur-hermes` header (REST) or the
// `?hermes=` parameter (the socket), which pin a tab to the Hermes it started
// with; else the browser's `murmur_hermes` cookie; else the first. A pinned id
// that no longer exists is refused (409 hermes_gone) rather than quietly sent
// to another Hermes, so a tab never mixes two.

import type http from 'node:http'
import {
  addTarget,
  cleanName,
  listTargets,
  memo,
  normalizeUrl,
  removeTarget,
  updateTarget,
  UrlError,
  type Credentials,
  type Target,
} from './config.ts'
import { createHermes, MIN_HERMES_VERSION, type ConnectionInfo, type Hermes } from './hermes.ts'
import { appendCookie, readCookie, readJson, secure, sendJson } from './http.ts'

export const HERMES_COOKIE = 'murmur_hermes'
export const HERMES_HEADER = 'x-murmur-hermes'
export const HERMES_PARAM = 'hermes'
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60

export type Connection = ConnectionInfo & { id: string; name: string }
type State = { active: string; connections: Connection[] }

// Loaded on first use, once the server's settings are known (config.ts).
const known = memo(() => ({ targets: listTargets(), instances: new Map<string, Hermes>() }))
const dropped = new Set<(hermes: Hermes) => void>()

/** Called with a Hermes whose sign-in or address changed, or that was removed, so its live sockets close. Returns a function that stops calling it. */
export function onDrop(fn: (hermes: Hermes) => void) {
  dropped.add(fn)
  return () => void dropped.delete(fn)
}

const targets = () => known().targets
const find = (id: string | null | undefined) => (id ? targets().find((t) => t.id === id) : undefined)

function instance(target: Target) {
  const { instances } = known()
  let hermes = instances.get(target.id)
  if (!hermes) instances.set(target.id, (hermes = createHermes(target)))
  return hermes
}

/** Re-read the list after a change, and drop what changed underneath. */
function reload(changed?: string) {
  const { instances } = known()
  known().targets = listTargets()
  for (const [id, hermes] of [...instances]) {
    if (id === changed || !find(id)) {
      instances.delete(id)
      for (const fn of dropped) fn(hermes)
    }
  }
}

// ── Which Hermes ──────────────────────────────────────────────────────────

const pinnedId = (req: http.IncomingMessage, url?: URL) => {
  const header = req.headers[HERMES_HEADER]
  return (typeof header === 'string' && header) || url?.searchParams.get(HERMES_PARAM) || null
}

/** The browser's choice: its cookie, or the first. */
const browserTarget = (req: http.IncomingMessage) => find(readCookie(req, HERMES_COOKIE)) ?? targets()[0]

/** The Hermes a request is for, or null when it was pinned to one that's gone. */
function targetFor(req: http.IncomingMessage, url?: URL) {
  const pinned = pinnedId(req, url)
  return pinned ? (find(pinned) ?? null) : browserTarget(req)
}

/** The Hermes to proxy a request to, or null (answer 409 hermes_gone). */
export function hermesFor(req: http.IncomingMessage, url: URL): Hermes | null {
  const target = targetFor(req, url)
  return target ? instance(target) : null
}

/** The first Hermes, for the startup line. */
export const firstTarget = () => targets()[0]

const cookieFor = (req: http.IncomingMessage, id: string) =>
  `${HERMES_COOKIE}=${id}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; SameSite=Lax${secure(req) ? '; Secure' : ''}`

/**
 * Keep the cookie naming a Hermes that exists. Sent with the page itself, so
 * the app knows which Hermes it's for (and whose things in local storage are
 * its own) before it asks anything. Not HttpOnly for that reason: it's an id,
 * not a credential.
 */
export function syncHermesCookie(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!find(readCookie(req, HERMES_COOKIE))) appendCookie(res, cookieFor(req, targets()[0].id))
}

// ── Describing ────────────────────────────────────────────────────────────

const describe = async (target: Target, fresh = false): Promise<Connection> => {
  const hermes = instance(target)
  const info = await (fresh ? hermes.check() : hermes.status())
  return { id: target.id, name: target.name, ...info }
}

async function state(req: http.IncomingMessage, active = browserTarget(req).id): Promise<State> {
  return { active, connections: await Promise.all(targets().map((t) => describe(t))) }
}

// ── Changing ──────────────────────────────────────────────────────────────

type Body = { name?: unknown; url?: unknown; username?: unknown; password?: unknown; activate?: unknown }

/** What a form describes. A blank password keeps the saved one for the same address and user. */
function candidate(body: Body, saved?: Target): { url: string; credentials?: Credentials } {
  const url = normalizeUrl(body.url)
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  let password = typeof body.password === 'string' ? body.password : ''
  if (username && !password && saved?.url === url && saved.credentials?.username === username) {
    password = saved.credentials.password
  }
  return { url, credentials: username && password ? { username, password } : undefined }
}

const urlProblem = (body: Body, error: UrlError): ConnectionInfo => ({
  url: typeof body.url === 'string' ? body.url : '',
  managed: false,
  source: 'saved',
  mode: 'unknown',
  status: 'unreachable',
  error: error.message,
})

/** Test what a form describes. Connected: returns the trial, already signed in. Else answers 422 and returns null. */
async function trial(res: http.ServerResponse, body: Body, saved?: Target) {
  let next: ReturnType<typeof candidate>
  try {
    next = candidate(body, saved)
  } catch (error) {
    if (!(error instanceof UrlError)) throw error
    sendJson(res, 422, urlProblem(body, error))
    return null
  }
  const other = targets().find((t) => t.url === next.url && t.id !== saved?.id && t.source !== 'default')
  if (other) {
    sendJson(res, 409, { error: `Murmur is already connected to this Hermes, as “${other.name}”.` })
    return null
  }
  const id = saved?.id ?? 'new'
  const hermes = createHermes({ id, name: '', url: next.url, source: 'saved', credentials: next.credentials })
  const info = await hermes.check()
  if (info.status !== 'connected') {
    sendJson(res, 422, { id, name: saved?.name ?? '', ...info })
    return null
  }
  // Reachable but too old: saying so now beats an app that half works.
  if (info.outdated) {
    const error = `This Hermes is version ${info.hermesVersion}. Murmur needs ${MIN_HERMES_VERSION} or newer, so update Hermes and try again.`
    sendJson(res, 422, { id, name: saved?.name ?? '', ...info, error })
    return null
  }
  return { ...next, hermes }
}

/** Add one. Its trial is already signed in, so it carries on as the real thing. */
async function add(res: http.ServerResponse, body: Body) {
  const tried = await trial(res, body)
  if (!tried) return null
  const target = addTarget({ name: cleanName(body.name), url: tried.url, credentials: tried.credentials })
  reload()
  known().instances.set(target.id, tried.hermes)
  return target
}

/** Change one's address or sign-in, keeping its id (and so the browser's things for it). */
async function update(res: http.ServerResponse, target: Target, body: Body) {
  const tried = await trial(res, body, target)
  if (!tried) return null
  updateTarget(target.id, { url: tried.url, credentials: tried.credentials ?? null, name: cleanName(body.name) })
  reload(target.id)
  known().instances.set(target.id, tried.hermes)
  return find(target.id)!
}

function remove(req: http.IncomingMessage, res: http.ServerResponse, target: Target) {
  removeTarget(target.id)
  reload()
  // This browser was using it: move it to the first, now, so the reload lands there.
  if (browserTarget(req).id !== readCookie(req, HERMES_COOKIE)) appendCookie(res, cookieFor(req, targets()[0].id))
}

const reply = (res: http.ServerResponse, status: number, body: unknown) => (sendJson(res, status, body), true)

const MANAGED = 'Murmur’s server configuration sets this Hermes, so it can’t be changed here.'

export async function handleConnection(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
  // ── The list ──
  if (path === '/murmur/connections') {
    if (req.method === 'GET') return reply(res, 200, await state(req))
    if (req.method !== 'POST') return false
    const body = (await readJson(req).catch(() => ({}))) as Body
    const target = await add(res, body)
    if (!target) return true
    let active: string | undefined
    if (body.activate === true) {
      appendCookie(res, cookieFor(req, target.id))
      active = target.id
    }
    sendJson(res, 200, { connection: await describe(target, true), ...(await state(req, active)) })
    return true
  }

  const one = /^\/murmur\/connections\/([A-Za-z0-9]{1,32})(\/activate)?$/.exec(path)
  if (one) {
    const target = find(one[1])
    if (!target) return reply(res, 404, { error: 'Murmur doesn’t know that Hermes.' })
    if (one[2]) {
      if (req.method !== 'POST') return false
      appendCookie(res, cookieFor(req, target.id))
      sendJson(res, 200, await state(req, target.id))
      return true
    }
    if (req.method === 'PATCH') {
      const body = (await readJson(req).catch(() => ({}))) as Body
      const name = cleanName(body.name)
      if (body.url === undefined && body.username === undefined && body.password === undefined) {
        if (!name) return reply(res, 422, { error: 'Give this Hermes a name.' })
        if (target.source === 'default') return reply(res, 409, { error: 'Connect to this Hermes before naming it.' })
        updateTarget(target.id, { name })
        known().targets = listTargets()
        sendJson(res, 200, { connection: await describe(find(target.id)!), ...(await state(req)) })
        return true
      }
      if (target.source !== 'saved') return reply(res, 409, { error: MANAGED })
      const updated = await update(res, target, body)
      if (updated) sendJson(res, 200, { connection: await describe(updated, true), ...(await state(req)) })
      return true
    }
    if (req.method === 'DELETE') {
      if (target.source !== 'saved') return reply(res, 409, { error: 'Murmur’s server configuration sets this Hermes, so it can’t be removed.' })
      remove(req, res, target)
      sendJson(res, 200, await state(req))
      return true
    }
    return false
  }

  // ── The single-Hermes API, on this request's Hermes ──
  if (!path.startsWith('/murmur/connection')) return false
  const target = targetFor(req)
  if (!target) return reply(res, 409, { error: 'hermes_gone' })

  if (path === '/murmur/connection' && req.method === 'GET') {
    sendJson(res, 200, await describe(target, true))
    return true
  }
  if (path === '/murmur/connection/test' && req.method === 'POST') {
    const body = (await readJson(req).catch(() => ({}))) as Body
    try {
      const { url, credentials } = candidate(body, target)
      sendJson(res, 200, { id: target.id, name: target.name, ...(await createHermes({ ...target, source: 'saved', url, credentials, token: undefined }).check()) })
    } catch (error) {
      if (!(error instanceof UrlError)) throw error
      sendJson(res, 422, urlProblem(body, error))
    }
    return true
  }
  const saving = path === '/murmur/connection' && req.method === 'PUT'
  const forgetting = path === '/murmur/connection' && req.method === 'DELETE'
  if (!saving && !forgetting) return false
  if (target.source === 'env') return reply(res, 409, { error: MANAGED })

  if (forgetting) {
    if (target.source !== 'saved') return reply(res, 409, { error: 'There’s no saved Hermes to forget.' })
    remove(req, res, target)
    sendJson(res, 200, await describe(targets()[0], true))
    return true
  }
  const body = (await readJson(req).catch(() => ({}))) as Body
  // A first run (nothing saved yet) adds one; otherwise this changes the one in use.
  const saved = target.source === 'default' ? await add(res, body) : await update(res, target, body)
  if (!saved) return true
  if (saved.id !== readCookie(req, HERMES_COOKIE)) appendCookie(res, cookieFor(req, saved.id))
  sendJson(res, 200, await describe(saved, true))
  return true
}
