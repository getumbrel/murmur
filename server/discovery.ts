// Hermes to offer when Murmur asks where agents live (setup.ts): the ones it
// can find, and how the built-in one is doing.
//
// Found: MURMUR_FIND_HERMES ("Name=url,Name=url"; on umbrelOS the Hermes Agent
// app at its container address), else a few likely places. Each is asked, all
// at once and briefly, for its public /api/status: is it Hermes, which
// version, and does it need a password. Only one that doesn't is read further,
// with the token that same host hands out in its own page (as connecting to it
// would): its agents, how many chats, whether a model is set up. A Hermes that
// needs a password is sent nothing at all. Credentials Murmur holds only ever
// go to the address they were set up for. One that answered and then goes
// quiet is still offered for a while, marked away: most often it's updating.
//
// The built-in: its public /api/health says when it's up (a first start takes
// a while), then Murmur signs in as it always will.

import { createHash } from 'node:crypto'
import { isThisComputer, memo, normalizeUrl, setting, UMBREL_HOST } from './config.ts'
import { createHermes, MIN_HERMES_VERSION, olderThan, type Hermes } from './hermes.ts'

// ── Where to look ───────────────────────────────────────────────────────────

/** Without MURMUR_FIND_HERMES: the Hermes Agent app's container address, and a dashboard on this computer. */
const DEFAULT_FIND =
  'Hermes Agent=http://hermes-agent_web_1:18789,http://localhost:9119,http://127.0.0.1:9119,http://localhost:18789'

export type FoundWhere = 'umbrel' | 'computer' | 'network'

export type Candidate = {
  /** Stable for an address: send it back to choose or add this one. */
  id: string
  /** What the choice shows: "Hermes Agent", "Hermes on this computer", "Hermes on studio.local". */
  name: string
  /** The name it's saved under once chosen, when MURMUR_FIND_HERMES gives one (else the usual nameFor()). */
  label?: string
  url: string
  host: string
  where: FoundWhere
}

export const candidateId = (url: string) => 'f' + createHash('sha256').update(url).digest('hex').slice(0, 12)

/** One place to look, described. */
export function candidate(url: string, label?: string): Candidate {
  const { hostname, host } = new URL(url)
  const where: FoundWhere = hostname === UMBREL_HOST ? 'umbrel' : isThisComputer(hostname) ? 'computer' : 'network'
  const name =
    label ??
    (where === 'umbrel' ? 'Hermes Agent' : where === 'computer' ? 'Hermes on this computer' : `Hermes on ${hostname}`)
  return { id: candidateId(url), name, label, url, host, where }
}

/** "Name=url,url,…" → places to look; bad entries are skipped, repeats kept once. */
export function parseFindList(value: string): Candidate[] {
  const out = new Map<string, Candidate>()
  for (const entry of value.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    // A name only when the "=" comes before the address starts.
    const named = eq > 0 && !/[:/]/.test(trimmed.slice(0, eq))
    const label = named ? trimmed.slice(0, eq).trim() || undefined : undefined
    try {
      const url = normalizeUrl(named ? trimmed.slice(eq + 1) : trimmed)
      if (!out.has(url)) out.set(url, candidate(url, label))
    } catch {
      // Not an address: skipped.
    }
  }
  return [...out.values()]
}

export const candidates = memo(() => parseFindList(setting('MURMUR_FIND_HERMES') ?? DEFAULT_FIND))

export const candidateById = (id: unknown) =>
  typeof id === 'string' ? candidates().find((c) => c.id === id) : undefined

/**
 * Whether Murmur runs on umbrelOS, from the addresses it was given there
 * (the Hermes Agent app's container, or the built-in's).
 */
export const onUmbrel = memo(() => {
  const given = [setting('HERMES_URL'), setting('MURMUR_BUILTIN_HERMES_URL'), setting('MURMUR_FIND_HERMES')]
    .filter(Boolean)
    .join(',')
  return new RegExp(`(^|[/=,])(${UMBREL_HOST}|murmur_hermes_1)(:|/|,|$)`).test(given)
})

// ── Asking a Hermes ─────────────────────────────────────────────────────────

const PUBLIC_MS = 1500
/** Whether a place has a Hermes at all: a little longer, as the first ask of one that's been idle can be slow. */
const LOOK_MS = 2500
/** How long one found Hermes may take, all told. One that's slow to say what's in it is offered without. */
const FOUND_MS = 4000

export type PublicStatus = { version: string; authRequired: boolean; installId?: string }

/** Hermes's public status (no credentials sent), or null when it isn't a Hermes that answers. */
export async function publicStatus(url: string, timeout = PUBLIC_MS): Promise<PublicStatus | null> {
  try {
    const res = await fetch(`${url}/api/status`, { redirect: 'manual', signal: AbortSignal.timeout(timeout) })
    const body = (await res.json()) as { version?: unknown; auth_required?: unknown; install_id?: unknown } | null
    if (!res.ok || typeof body?.version !== 'string' || !('auth_required' in body)) return null
    return {
      version: body.version,
      authRequired: Boolean(body.auth_required),
      installId: typeof body.install_id === 'string' ? body.install_id : undefined,
    }
  } catch {
    return null
  }
}

/** Hermes's public health check, the cheapest sign of life: its version, or null. */
export async function health(url: string, timeout = PUBLIC_MS): Promise<{ version?: string } | null> {
  try {
    const res = await fetch(`${url}/api/health`, { redirect: 'manual', signal: AbortSignal.timeout(timeout) })
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as { version?: unknown } | null
    return { version: typeof body?.version === 'string' ? body.version : undefined }
  } catch {
    return null
  }
}

export type FoundAgent = { id: string; name: string; hue?: number; color?: string; isDefault?: boolean }

type Profile = {
  name?: unknown
  is_default?: unknown
  display_name?: unknown
  bot_title?: unknown
  ui_meta?: unknown
}

const record = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** An agent as the app will show it (the same rules as toAgent() in src/state/agents.ts). */
export function toFoundAgent(p: Profile): FoundAgent | null {
  const id = text(p.name)
  if (!id) return null
  const meta = record(p.ui_meta) ?? {}
  const bots = record(meta['hermes-bots'])
  const murmur = record(meta.murmur)
  const isDefault = p.is_default === true
  const name = text(bots?.title) || text(p.bot_title) || text(p.display_name) || (isDefault ? 'Hermes' : titleCase(id))
  const color = text(bots?.color)
  return {
    id,
    name,
    ...(typeof murmur?.hue === 'number' && Number.isFinite(murmur.hue) && { hue: murmur.hue }),
    ...(/^#?[0-9a-f]{6}$/i.test(color) && { color: color.startsWith('#') ? color : `#${color}` }),
    ...(isDefault && { isDefault }),
  }
}

/** The main agent first, then by name, as the app lists them. */
export function toFoundAgents(profiles: unknown): FoundAgent[] {
  const list = Array.isArray(profiles) ? profiles : []
  return list
    .map((p) => toFoundAgent(record(p) ?? {}))
    .filter((a): a is FoundAgent => Boolean(a))
    .sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)) || a.name.localeCompare(b.name))
}

/** Up to this many agents travel with a found Hermes; `agentCount` says how many there are. */
const MAX_AGENTS = 24

const CHATS_PATH = '/api/profiles/sessions?limit=0&min_messages=1&exclude_sources=cron'

export type Contents = { agents?: FoundAgent[]; agentCount?: number; chats?: number; hasModel?: boolean }

/** What's in a Hermes Murmur can read: its agents, its chats, whether it has a model. Unknowns are left out. */
export async function contents(hermes: Hermes, timeout = 3000): Promise<Contents> {
  const [profiles, sessions, [listed, setup]] = await Promise.all([
    hermes.read<{ profiles?: unknown }>('/api/profiles', timeout),
    hermes.read<{ total?: unknown }>(CHATS_PATH, timeout),
    hermes.peek(
      [
        ['profiles.list', {}],
        ['setup.status', {}],
      ],
      timeout,
    ),
  ])
  const out: Contents = {}
  // The socket's list carries colours; REST's doesn't.
  const fromSocket = record(listed)?.profiles
  const agents = toFoundAgents(Array.isArray(fromSocket) ? fromSocket : profiles?.profiles)
  if (agents.length) Object.assign(out, { agents: agents.slice(0, MAX_AGENTS), agentCount: agents.length })
  if (typeof sessions?.total === 'number') out.chats = sessions.total
  const configured = record(setup)?.provider_configured
  if (typeof configured === 'boolean') out.hasModel = configured
  return out
}

// ── Found ───────────────────────────────────────────────────────────────────

export type Found = Contents & {
  id: string
  name: string
  where: FoundWhere
  url: string
  host: string
  version?: string
  outdated?: boolean
  minVersion?: string
  needsSignIn?: boolean
  /** It answered a while ago and doesn't now: what it showed then (see remembered()). */
  away?: boolean
  /** Which Hermes this is (its data folder), to tell the same one at two addresses apart. Never sent to the app. */
  installId?: string
}

/** Look at one place, within FOUND_MS. Null when no Hermes answers there. */
async function look(c: Candidate): Promise<Found | null> {
  const until = Date.now() + FOUND_MS
  const status = await publicStatus(c.url, LOOK_MS)
  if (!status) return null
  const found: Found = {
    id: c.id,
    name: c.name,
    where: c.where,
    url: c.url,
    host: c.host,
    version: status.version,
    installId: status.installId,
  }
  if (olderThan(status.version, MIN_HERMES_VERSION))
    Object.assign(found, { outdated: true, minVersion: MIN_HERMES_VERSION })
  // Password-protected: nothing more is sent its way until someone signs in.
  if (status.authRequired) return { ...found, needsSignIn: true }
  const hermes = createHermes({ id: c.id, name: c.name, url: c.url, source: 'saved' })
  const described = (async (): Promise<Partial<Found>> => {
    try {
      await hermes.restAuth()
    } catch {
      // It hands out no token after all (e.g. behind a proxy that asks for a sign-in).
      return { needsSignIn: true }
    }
    return contents(hermes, Math.max(500, until - Date.now()))
  })()
  // It's there either way: one too slow to say what's in it is still offered, just without its counts.
  const late = new Promise<Partial<Found>>((done) => setTimeout(() => done({}), Math.max(0, until - Date.now())))
  return { ...found, ...(await Promise.race([described, late])) }
}

/** Which Hermes Murmur already has, to leave out of what it found. */
export type Known = { urls: Set<string>; installIds: Set<string> }

/**
 * What to offer: no Hermes Murmur already has (by address or by install), and
 * each Hermes once even when it answers at two addresses (localhost and
 * 127.0.0.1). The first place listed wins, except that the Hermes Agent app's
 * own name beats another address of the same Hermes.
 */
export function offer(found: (Found | null)[], known: Known): Found[] {
  const kept = found.filter(
    (f): f is Found => Boolean(f) && !known.urls.has(f!.url) && !(f!.installId && known.installIds.has(f!.installId)),
  )
  const out: Found[] = []
  for (const f of kept) {
    const twin = f.installId ? out.findIndex((o) => o.installId === f.installId) : -1
    if (twin < 0) out.push(f)
    else if (f.where === 'umbrel' && out[twin].where !== 'umbrel') out[twin] = f
  }
  return out
}

/** For the app: everything but how Murmur tells installs apart. */
export const forApp = ({ installId: _, ...rest }: Found) => rest

/**
 * How long a Hermes that answered is still offered once it goes quiet.
 * Updating the Hermes Agent app stops it while the new Hermes downloads (a few
 * gigabytes), then starts it again; it answers a while after that.
 */
export const AWAY_MS = 30 * 60_000

export type Seen = { at: number; found: Found }

/** What a place offers: what answers there now, else what answered there within AWAY_MS, marked away. */
export function remembered(found: Found | null, last: Seen | undefined, now: number): Found | null {
  if (found) return found
  return last && now - last.at < AWAY_MS ? { ...last.found, away: true } : null
}

const FOUND_FRESH_MS = 10_000
let lastLook: { at: number; found: Promise<(Found | null)[]> } | null = null
const lastSeen = new Map<string, Seen>()

/** Every place, looked at all at once (and reused for a few seconds). Each one gets about FOUND_MS. */
export function lookAround(): Promise<(Found | null)[]> {
  if (lastLook && Date.now() - lastLook.at < FOUND_FRESH_MS) return lastLook.found
  const looked = Promise.all(
    candidates().map(async (c) => {
      const found = await look(c).catch(() => null)
      if (found) lastSeen.set(c.id, { at: Date.now(), found })
      return remembered(found, lastSeen.get(c.id), Date.now())
    }),
  )
  lastLook = { at: Date.now(), found: looked }
  return looked
}

/** Forget the last look, e.g. after "Check again". */
export const lookAgain = () => void (lastLook = null)

// ── The built-in ────────────────────────────────────────────────────────────

/** A first start takes from about 15 seconds to a few minutes on a small Umbrel. */
export const START_PATIENCE_MS = 5 * 60_000
/** A restart of an already-running built-in (e.g. after a settings change) takes about as long as a start. */
export const RESTART_PATIENCE_MS = 60_000

export type BuiltinState = 'starting' | 'ready' | 'unreachable' | 'outdated'

/**
 * Whether a built-in that isn't answering is still on its way: `starting`
 * until it has answered once (for up to START_PATIENCE_MS after Murmur
 * started), and again for a while when it goes quiet after being up; after
 * that, `unreachable`.
 */
export function quietState({
  now,
  startedAt,
  lastUpAt,
}: {
  now: number
  startedAt: number
  lastUpAt?: number
}): 'starting' | 'unreachable' {
  if (lastUpAt === undefined) return now - startedAt < START_PATIENCE_MS ? 'starting' : 'unreachable'
  return now - lastUpAt < RESTART_PATIENCE_MS ? 'starting' : 'unreachable'
}

export type BuiltinReport = { state: BuiltinState; version?: string; minVersion?: string } & Pick<
  Contents,
  'hasModel'
> & { agents?: number }

const startedAt = Date.now()
/** When Murmur last got in: it answered and took the sign-in. */
let lastUpAt: number | undefined
let builtinInstall: string | undefined
let warned = false
let lastReport: { at: number; report: Promise<BuiltinReport> } | null = null
let lastContents: { at: number; contents: Contents } | null = null
const REPORT_FRESH_MS = 1000
const CONTENTS_FRESH_MS = 10_000

/** The built-in's install, once it has answered: so it's never also offered as found. */
export const builtinInstallId = () => builtinInstall

async function report(hermes: Hermes): Promise<BuiltinReport> {
  const now = Date.now()
  const up = await health(hermes.target.url)
  if (!up) return { state: quietState({ now, startedAt, lastUpAt }) }
  if (!builtinInstall) builtinInstall = (await publicStatus(hermes.target.url))?.installId
  const version = up.version
  if (version && olderThan(version, MIN_HERMES_VERSION))
    return { state: 'outdated', version, minVersion: MIN_HERMES_VERSION }
  const info = await hermes.status()
  if (info.status !== 'connected') {
    // Up, but Murmur can't sign in: a password that doesn't match is a setup mistake, not a slow start.
    if (info.status === 'bad-login' || info.status === 'needs-login') {
      if (!warned)
        console.warn(
          `Murmur: can’t sign in to the built-in Hermes (${info.error}). Check MURMUR_BUILTIN_HERMES_PASSWORD.`,
        )
      warned = true
      return { state: 'unreachable', version }
    }
    return { state: quietState({ now, startedAt, lastUpAt }), version }
  }
  lastUpAt = now
  void tidyBuiltin(hermes).catch(() => {})
  if (!lastContents || now - lastContents.at > CONTENTS_FRESH_MS)
    lastContents = { at: now, contents: await contents(hermes) }
  const { hasModel, agentCount } = lastContents.contents
  return {
    state: 'ready',
    version: info.hermesVersion ?? version,
    ...(hasModel !== undefined && { hasModel }),
    ...(agentCount !== undefined && { agents: agentCount }),
  }
}

// Hermes 0.22 gives chats from a desktop app (Murmur's say they are one) the
// `project` and `catalog` toolsets, which only Hermes Desktop can show. Murmur
// is the only app using the built-in, so its agents have them switched off.
// (Agents Murmur makes elsewhere get the same in the app: src/state/toolsets.ts.)
//
// The `connections` toolset (Hermes's manage_connections) is off too until the
// person agrees to apps through Nous Research: an agent using it would make a
// Nous account for this Hermes without asking. The app keeps it in step as well,
// but only once it's opened; this covers an agent reached over Telegram or a
// routine before then. The answer is read the way the app reads it
// (src/state/hosted-apps-consent.ts); when Hermes doesn't say, it's left alone.
const HIDDEN_TOOLSETS = ['catalog', 'project']
const HOSTED_TOOLSET = 'connections'
const CONSENT_KEY = 'murmur-nous'

/**
 * The disabled toolsets the way Murmur wants them, or null when they're in step
 * already: Murmur's added, and `connections` off while apps through Nous aren't
 * allowed (`hosted` false), back on once they are (true), untouched when unknown.
 */
export function withHiddenToolsets(current: unknown, hosted: boolean | null = null): string[] | null {
  const list = Array.isArray(current)
    ? current.map(String)
    : typeof current === 'string' && current.trim()
      ? [current.trim()]
      : []
  const kept = hosted === true ? list.filter((t) => t !== HOSTED_TOOLSET) : list
  const wanted = hosted === false ? [...HIDDEN_TOOLSETS, HOSTED_TOOLSET] : HIDDEN_TOOLSETS
  const missing = wanted.filter((t) => !kept.includes(t))
  return missing.length || kept.length !== list.length ? [...kept, ...missing] : null
}

/**
 * Whether agents may reach apps through Nous: the person agreed (the main
 * agent's ui_meta), or this Hermes already has a Nous identity. Null when
 * Hermes didn't answer.
 */
export function hostedAllowed(listed: unknown, freeTier: unknown): boolean | null {
  const profiles = record(listed)?.profiles
  if (!Array.isArray(profiles)) return null
  const main = profiles.map(record).find((p) => p?.is_default === true) ?? profiles.map(record).find((p) => p?.name === 'default')
  if (typeof record(record(main?.ui_meta)?.[CONSENT_KEY])?.since === 'number') return true
  const guest = record(freeTier)?.has_guest
  return typeof guest === 'boolean' ? guest : null
}

let tidied = false

/** Once per start, when the built-in is first up: every agent's toolsets. Best effort. */
async function tidyBuiltin(hermes: Hermes) {
  if (tidied) return
  tidied = true
  const [profiles, [listed, freeTier]] = await Promise.all([
    hermes.read<{ profiles?: { name?: unknown }[] }>('/api/profiles'),
    hermes.peek([
      ['profiles.list', {}],
      ['free_tier.status', { profile: 'default' }],
    ]),
  ])
  const hosted = hostedAllowed(listed, freeTier)
  for (const p of profiles?.profiles ?? []) {
    if (typeof p.name !== 'string') continue
    const q = `profile=${encodeURIComponent(p.name)}`
    const config = await hermes.read<{ agent?: { disabled_toolsets?: unknown } }>(
      `/api/config?${q}&include_defaults=false`,
    )
    if (!config) continue
    const next = withHiddenToolsets(config.agent?.disabled_toolsets, hosted)
    if (next) await hermes.write('PUT', `/api/config?${q}`, { config: { agent: { disabled_toolsets: next } } })
  }
}

/** How the built-in is doing, asked at most once a second however many tabs poll. */
export function builtinReport(hermes: Hermes): Promise<BuiltinReport> {
  if (lastReport && Date.now() - lastReport.at < REPORT_FRESH_MS) return lastReport.report
  const next = report(hermes).catch((): BuiltinReport => ({
    state: quietState({ now: Date.now(), startedAt, lastUpAt }),
  }))
  lastReport = { at: Date.now(), report: next }
  return next
}
