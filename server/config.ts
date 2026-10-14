// Which Hermes instances Murmur knows, and the little it remembers between restarts.
//
// A Murmur can be connected to several Hermes (one on an Umbrel, one on a
// VPS…). Each browser picks one at a time (connection.ts); this module only
// keeps the list.
//
//   env HERMES_URL (+ HERMES_TOKEN, or HERMES_USERNAME / HERMES_PASSWORD)
//       A managed entry, always first, never removable. This is how umbrelOS
//       runs Murmur ("This Umbrel").
//   DATA_DIR/murmur.json `connections`
//       The ones added from the app.
//   Neither: the Hermes app on umbrelOS, at its container address, as an
//       unsaved default, so a first run can show "Connect to Hermes".

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

export const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data')
export const DEFAULT_HERMES_URL = 'http://hermes-agent_web_1:18789'
export const UMBREL_HOST = 'hermes-agent_web_1'
const FILE = join(DATA_DIR, 'murmur.json')

/** The managed entry's id, and the id a pre-list saved connection is given. */
export const ENV_ID = 'env'
export const MAIN_ID = 'main'
const DEFAULT_ID = 'default'

export type Credentials = { username: string; password: string }

export type Target = {
  id: string
  name: string
  url: string
  /** Where it came from. `env` is managed: read-only, never removed. `default` was never set up. */
  source: 'env' | 'saved' | 'default'
  credentials?: Credentials
  /** An explicit dashboard session token (HERMES_TOKEN). */
  token?: string
}

type SavedConnection = { id: string; name: string; url: string; username?: string; password?: string }

type Stored = {
  connections?: SavedConnection[]
  /** A rename of the managed entry. */
  managedName?: string
  /** Before multiple Hermes: the one saved connection. Migrated on first read. */
  hermes?: { url: string; username?: string; password?: string }
  secret?: string
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

/** A name people can tell apart: "This Umbrel", "This computer", or the host. */
export function nameFor(url: string, taken: string[] = []) {
  const { hostname, host } = new URL(url)
  if (hostname === UMBREL_HOST) return 'This Umbrel'
  const base = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(hostname) ? 'This computer' : hostname
  if (!taken.includes(base)) return base
  return taken.includes(host) ? `${host} (${taken.length + 1})` : host
}

export function cleanName(raw: unknown): string | undefined {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
  return name || undefined
}

function read(): Stored {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as Stored
  } catch {
    return {}
  }
}

/** Atomic, owner-only write: the file can hold Hermes passwords. */
function write(data: Stored) {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  const tmp = `${FILE}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, FILE)
}

const pinned = Boolean(process.env.HERMES_URL)

function managed(stored: Stored): Target | null {
  if (!process.env.HERMES_URL) return null
  const { HERMES_TOKEN: token, HERMES_USERNAME: username, HERMES_PASSWORD: password } = process.env
  const url = normalizeUrl(process.env.HERMES_URL)
  return {
    id: ENV_ID,
    name: stored.managedName ?? cleanName(process.env.HERMES_NAME) ?? nameFor(url),
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

const newId = () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'x')

/**
 * The pre-list `hermes` entry becomes the first saved connection, `main`
 * (once; pinned installs ignored it, and still do). The managed and `main`
 * entries keep the browser's original, unprefixed storage, so they must never
 * both exist: pinned later, `main` gets an id of its own.
 */
function migrated(stored: Stored): Stored {
  if (pinned && stored.connections?.some((c) => c.id === MAIN_ID)) {
    const next = { ...stored, connections: stored.connections.map((c) => (c.id === MAIN_ID ? { ...c, id: newId() } : c)) }
    tryWrite(next)
    return next
  }
  if (stored.connections || !stored.hermes?.url || pinned) return stored
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
    console.warn(`Murmur: couldn’t update ${FILE} (${(error as Error).message}).`)
  }
}

/** Every Hermes, managed first. Never empty: with none set up, the unsaved umbrelOS default. */
export function listTargets(): Target[] {
  const stored = migrated(read())
  const saved: Target[] = []
  for (const c of stored.connections ?? []) {
    try {
      saved.push(toTarget({ ...c, url: normalizeUrl(c.url) }))
    } catch {
      // Skip a hand-edited entry with a bad address.
    }
  }
  const env = managed(stored)
  const all = env ? [env, ...saved] : saved
  return all.length ? all : [{ id: DEFAULT_ID, name: nameFor(DEFAULT_HERMES_URL), url: DEFAULT_HERMES_URL, source: 'default' }]
}

export function addTarget(input: { name?: string; url: string; credentials?: Credentials }): Target {
  const stored = migrated(read())
  const list = stored.connections ?? []
  const names = listTargets().map((t) => t.name)
  const entry: SavedConnection = {
    // The first one, set up from the app, carries on the browser's original storage.
    id: !pinned && !list.length ? MAIN_ID : newId(),
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
  if (id === ENV_ID && pinned) {
    if (patch.name) write({ ...stored, managedName: patch.name })
    return
  }
  const connections = (stored.connections ?? []).map((c) => {
    if (c.id !== id) return c
    const next: SavedConnection = { id: c.id, name: patch.name ?? c.name, url: patch.url ?? c.url }
    const credentials = patch.credentials === undefined ? (c.username && c.password ? { username: c.username, password: c.password } : undefined) : patch.credentials
    return credentials ? { ...next, ...credentials } : next
  })
  write({ ...stored, connections })
}

export function removeTarget(id: string) {
  const stored = migrated(read())
  write({ ...stored, connections: (stored.connections ?? []).filter((c) => c.id !== id) })
}

/** The key that signs Murmur's own sign-in cookie: env, else generated once and kept. */
export function sessionSecret(): string {
  if (process.env.MURMUR_SECRET) return process.env.MURMUR_SECRET
  const stored = read()
  if (stored.secret) return stored.secret
  const secret = randomBytes(32).toString('base64url')
  try {
    write({ ...stored, secret })
  } catch (error) {
    console.warn(`Murmur: couldn’t save a sign-in secret in ${DATA_DIR} (${(error as Error).message}). Sign-ins won’t survive a restart.`)
  }
  return secret
}
