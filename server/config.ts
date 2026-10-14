// Which Hermes instances Murmur knows, and the little it remembers between restarts.
//
// A Murmur can be connected to several Hermes (one on an Umbrel, one on a
// VPS…). Each browser picks one at a time (connection.ts); this module only
// keeps the list.
//
//   env HERMES_URL (+ HERMES_TOKEN, or HERMES_USERNAME / HERMES_PASSWORD)
//       A managed entry, always first, never removable: a Murmur pinned to one
//       Hermes, with no choice to make.
//   env MURMUR_BUILTIN_HERMES_URL (+ _USERNAME / _PASSWORD)
//       The Hermes that comes with Murmur (its own container on umbrelOS and in
//       the Docker compose). Offered on first run; once chosen or added it is
//       the `builtin` entry in the list, which keeps its place but takes its
//       address and sign-in from here, and can't be removed.
//   DATA_DIR/murmur.json `connections`
//       The ones chosen or added from the app.
//   None yet: the Hermes Agent app on umbrelOS, at its container address, as
//       an unsaved default, until the app makes the choice (setup.ts).

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

export const DEFAULT_HERMES_URL = 'http://hermes-agent_web_1:18789'
export const UMBREL_HOST = 'hermes-agent_web_1'

// ── Settings ──────────────────────────────────────────────────────────────
// Read from the environment, or from what an app embedding the server passes
// (server/app.ts), so nothing here may read them at import time.

export type Env = Record<string, string | undefined>

let env: Env = process.env

/** Use these settings instead of process.env. Values computed with `memo` are worked out again. */
export const useEnv = (next: Env) => void (env = next)

export const setting = (name: string) => env[name]

/** A value worked out from the settings once, and again only if they're replaced. */
export function memo<T>(compute: () => T): () => T {
  let cache: { env: Env; value: T } | null = null
  return () => (cache?.env === env ? cache.value : (cache = { env, value: compute() }).value)
}

export const dataDir = memo(() => resolve(env.DATA_DIR ?? 'data'))
const dataFile = () => join(dataDir(), 'murmur.json')

/** The managed entry's id, and the id a pre-list saved connection is given. */
export const ENV_ID = 'env'
export const MAIN_ID = 'main'
const DEFAULT_ID = 'default'
/** The built-in Hermes, once it's in the list. */
export const BUILTIN_ID = 'builtin'
export const BUILTIN_NAME = 'Built-in'

export type Credentials = { username: string; password: string }

export type Target = {
  id: string
  name: string
  url: string
  /**
   * Where it came from. `env` is managed: read-only, never removed. `builtin`
   * comes with Murmur: renamable, never removed. `default` was never set up.
   */
  source: 'env' | 'saved' | 'default' | 'builtin'
  credentials?: Credentials
  /** An explicit dashboard session token (HERMES_TOKEN). */
  token?: string
}

type SavedConnection = {
  id: string
  name: string
  url: string
  username?: string
  password?: string
  /** The built-in: its place and name. Its address and sign-in always come from the environment. */
  builtin?: true
}

type Stored = {
  connections?: SavedConnection[]
  /** A rename of the managed entry. */
  managedName?: string
  /** Before multiple Hermes: the one saved connection. Migrated on first read. */
  hermes?: { url: string; username?: string; password?: string }
  secret?: string
  /** Set on the first start that asks where agents live: data without it predates the choice (an update). */
  setupSeen?: true
}

export class UrlError extends Error {}

/** Accepts what people paste ("192.168.1.20:9119", "https://hermes.example/"), returns a clean base URL. */
export function normalizeUrl(raw: unknown): string {
  let value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) throw new UrlError('Enter the address of your Hermes dashboard.')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new UrlError('That address doesn’t look right. Try something like http://192.168.1.20:9119.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlError('Use an address that starts with http:// or https://.')
  }
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/+$/, '')
}

/** The computer Murmur's server runs on, as a Hermes address can name it. */
export const isThisComputer = (hostname: string) =>
  hostname === 'localhost' || /^127\./.test(hostname) || hostname === '[::1]' || hostname === 'host.docker.internal'

/** A name people can tell apart: "Hermes Agent" (the umbrelOS app), "This computer", or the host. */
export function nameFor(url: string, taken: string[] = []) {
  const { hostname, host } = new URL(url)
  if (hostname === UMBREL_HOST) return 'Hermes Agent'
  const base = isThisComputer(hostname) ? 'This computer' : hostname
  if (!taken.includes(base)) return base
  return taken.includes(host) ? `${host} (${taken.length + 1})` : host
}

export function cleanName(raw: unknown): string | undefined {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
  return name || undefined
}

function read(): Stored {
  try {
    return JSON.parse(readFileSync(dataFile(), 'utf8')) as Stored
  } catch {
    return {}
  }
}

/** Atomic, owner-only write: the file can hold Hermes passwords. */
function write(data: Stored) {
  const file = dataFile()
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
}

const pinned = () => Boolean(env.HERMES_URL)

/** The built-in Hermes's address and sign-in, or null when this Murmur has none. */
export const builtinConfig = memo((): { url: string; credentials?: Credentials } | null => {
  if (!env.MURMUR_BUILTIN_HERMES_URL) return null
  let url: string
  try {
    url = normalizeUrl(env.MURMUR_BUILTIN_HERMES_URL)
  } catch {
    console.warn(`Murmur: MURMUR_BUILTIN_HERMES_URL isn’t an address (${env.MURMUR_BUILTIN_HERMES_URL}); there’s no built-in Hermes.`)
    return null
  }
  const username = env.MURMUR_BUILTIN_HERMES_USERNAME || 'murmur'
  const password = env.MURMUR_BUILTIN_HERMES_PASSWORD
  return { url, credentials: password ? { username, password } : undefined }
})

/** The built-in as a Hermes to talk to, whether or not it's in the list yet. */
export function builtinTarget(name?: string): Target | null {
  const config = builtinConfig()
  return config ? { id: BUILTIN_ID, name: name ?? BUILTIN_NAME, url: config.url, source: 'builtin', credentials: config.credentials } : null
}

function managed(stored: Stored): Target | null {
  if (!env.HERMES_URL) return null
  const { HERMES_TOKEN: token, HERMES_USERNAME: username, HERMES_PASSWORD: password } = env
  const url = normalizeUrl(env.HERMES_URL)
  return {
    id: ENV_ID,
    name: stored.managedName ?? cleanName(env.HERMES_NAME) ?? nameFor(url),
    url,
    source: 'env',
    token: token || undefined,
    credentials: username && password ? { username, password } : undefined,
  }
}

const toTarget = (c: SavedConnection): Target => ({
  id: c.id,
  name: c.name,
  url: c.url,
  source: 'saved',
  credentials: c.username && c.password ? { username: c.username, password: c.password } : undefined,
})

/** Before the built-in, the Hermes Agent app was named "This Umbrel" for the machine; it now goes by its app's name. */
function renamed(c: SavedConnection): SavedConnection {
  if (c.name !== 'This Umbrel') return c
  try {
    return new URL(c.url).hostname === UMBREL_HOST ? { ...c, name: 'Hermes Agent' } : c
  } catch {
    return c
  }
}

const newId = () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'x')

/**
 * The pre-list `hermes` entry becomes the first saved connection, `main`
 * (once; pinned installs ignored it, and still do). The managed and `main`
 * entries keep the browser's original, unprefixed storage, so they must never
 * both exist: pinned later, `main` gets an id of its own.
 */
function migrated(stored: Stored): Stored {
  if (pinned() && stored.connections?.some((c) => c.id === MAIN_ID)) {
    const next = { ...stored, connections: stored.connections.map((c) => (c.id === MAIN_ID ? { ...c, id: newId() } : c)) }
    tryWrite(next)
    return next
  }
  if (stored.connections || !stored.hermes?.url || pinned()) return stored
  let url: string
  try {
    url = normalizeUrl(stored.hermes.url)
  } catch {
    return stored // a hand-edited file with a bad address: leave it be
  }
  const { hermes, ...rest } = stored
  const next: Stored = { ...rest, connections: [{ id: MAIN_ID, name: nameFor(url), url, username: hermes.username, password: hermes.password }] }
  tryWrite(next)
  return next
}

function tryWrite(data: Stored) {
  try {
    write(data)
  } catch (error) {
    console.warn(`Murmur: couldn’t update ${dataFile()} (${(error as Error).message}).`)
  }
}

/** Every Hermes, managed first. Never empty: with none set up, the unsaved umbrelOS default. */
export function listTargets(): Target[] {
  const stored = migrated(read())
  const saved: Target[] = []
  for (const c of stored.connections ?? []) {
    if (c.builtin) {
      // Gone when this Murmur no longer comes with one (run without the bundle).
      const builtin = builtinTarget(c.name)
      if (builtin) saved.push(builtin)
      continue
    }
    try {
      saved.push(toTarget(renamed({ ...c, url: normalizeUrl(c.url) })))
    } catch {
      // Skip a hand-edited entry with a bad address.
    }
  }
  const env = managed(stored)
  const all = env ? [env, ...saved] : saved
  return all.length ? all : [{ id: DEFAULT_ID, name: nameFor(DEFAULT_HERMES_URL), url: DEFAULT_HERMES_URL, source: 'default' }]
}

/**
 * Whether this Murmur has a Hermes already: pinned by HERMES_URL, or one
 * chosen or added in the app. Until then the app asks where agents live.
 */
export const decided = () => listTargets()[0].source !== 'default'

/** Put the built-in in the list (once), keeping everything else in place. */
export function addBuiltin(): Target {
  const stored = migrated(read())
  const list = stored.connections ?? []
  if (!list.some((c) => c.builtin)) write({ ...stored, connections: [...list, { id: BUILTIN_ID, name: BUILTIN_NAME, url: '', builtin: true }] })
  return listTargets().find((t) => t.id === BUILTIN_ID)!
}

/**
 * Note this start, once: true when Murmur's data was already there without
 * the note, so this Murmur was set up before it came with a Hermes (an update).
 */
export function noteSetupSeen(): boolean {
  let raw: string | null
  try {
    raw = readFileSync(dataFile(), 'utf8')
  } catch {
    raw = null
  }
  const stored = raw === null ? {} : read()
  if (stored.setupSeen) return false
  tryWrite({ ...stored, setupSeen: true })
  return raw !== null
}

/** What the person renamed the HERMES_URL Hermes to, if they did (kept after it's no longer pinned). */
export const managedName = () => read().managedName

export function addTarget(input: { name?: string; url: string; credentials?: Credentials }): Target {
  const stored = migrated(read())
  const list = stored.connections ?? []
  const names = listTargets().map((t) => t.name)
  const entry: SavedConnection = {
    // The first one, set up from the app, carries on the browser's original storage.
    id: !pinned() && !list.length ? MAIN_ID : newId(),
    name: input.name ?? nameFor(input.url, names),
    url: input.url,
    ...input.credentials,
  }
  write({ ...stored, connections: [...list, entry] })
  return toTarget(entry)
}

/** Rename, or change the address and sign-in. The managed entry can only be renamed. */
export function updateTarget(id: string, patch: { name?: string; url?: string; credentials?: Credentials | null }) {
  const stored = migrated(read())
  if (id === ENV_ID && pinned()) {
    if (patch.name) write({ ...stored, managedName: patch.name })
    return
  }
  const connections = (stored.connections ?? []).map((c) => {
    if (c.id !== id) return c
    if (c.builtin) return patch.name ? { ...c, name: patch.name } : c
    const next: SavedConnection = { id: c.id, name: patch.name ?? c.name, url: patch.url ?? c.url }
    const credentials = patch.credentials === undefined ? (c.username && c.password ? { username: c.username, password: c.password } : undefined) : patch.credentials
    return credentials ? { ...next, ...credentials } : next
  })
  write({ ...stored, connections })
}

export function removeTarget(id: string) {
  const stored = migrated(read())
  write({ ...stored, connections: (stored.connections ?? []).filter((c) => c.id !== id || c.builtin) })
}

/** The key that signs Murmur's own sign-in cookie: env, else generated once and kept. */
export function sessionSecret(): string {
  if (env.MURMUR_SECRET) return env.MURMUR_SECRET
  const stored = read()
  if (stored.secret) return stored.secret
  const secret = randomBytes(32).toString('base64url')
  try {
    write({ ...stored, secret })
  } catch (error) {
    console.warn(`Murmur: couldn’t save a sign-in secret in ${dataDir()} (${(error as Error).message}). Sign-ins won’t survive a restart.`)
  }
  return secret
}
