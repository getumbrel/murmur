// Where this Murmur's agents live: the one-time choice between the Hermes
// built into Murmur and one it found (the Hermes Agent app on this Umbrel, or
// a Hermes nearby). Served by server/setup.ts.
//
//   GET  /murmur/setup[?again=1]                        → Setup (again: look afresh, not what it found seconds ago)
//   POST /murmur/setup  {use: 'builtin'}                → Chosen (200)
//   POST /murmur/setup  {use: 'found', id, username?, password?}
//        → Chosen (200); 422 {connection} it couldn't use (needs-login,
//          bad-login, unreachable, outdated, with a friendly `error`);
//          404 {error: 'not_found'} when that id isn't found anymore;
//          409 {error: 'decided', active, connections} when another browser chose first.
//   POST /murmur/connections {found: id, username?, password?, activate?}
//   POST /murmur/connections {builtin: true, activate?}
//        → Settings → Server's "Add": the same as adding by address, by id.
//
// API for the screens:
//
//   useSetup({ polling? })     the answer, react-query key ['murmur', 'setup'].
//                              `polling: true` asks again every 1.5s (Getting ready);
//                              a function, while it says to (Where, waiting on an update).
//   useLookAgain()             "Check again": the server looks around afresh (GET ?again=1).
//   chooseHermes(choice)       POST /murmur/setup. Resolves to a ChoiceResult;
//                              throws only when Murmur's server can't be reached.
//   addFoundHermes(id, opts)   Settings: add a found Hermes or the built-in without switching.
//   carryOn(result)            After a choice: this tab moves to the chosen Hermes
//                              (in place when it can, else through the switch curtain).
//   pickLead(found)            The found Hermes to lead with, or undefined.
//   holdsSomething(found)      Whether it has agents, chats or a model: worth recommending.
//   recommended(found)         Usable and holds something: gets the Recommended badge.
//   waitingOn(found)           Out of date or away: worth looking again by itself.
//   agentNames(found)          "Juniper, Sage, Otto and 3 more", or '' with no agents.
//   countLine(found)           "On this Umbrel · 6 agents · 100+ chats".
//   isBuiltinId(id)            The built-in's connection id is always 'builtin'.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adoptHermes, tabHermes } from '@/hermes/instance'
import {
  connectionKey,
  connectionsKey,
  switchHermes,
  type HermesConnection,
  type HermesList,
  type KnownHermes,
} from '@/state/connection'

// ── The answer ──────────────────────────────────────────────────────────────

export const BUILTIN_ID = 'builtin'
export const isBuiltinId = (id: string | null | undefined) => id === BUILTIN_ID

export type BuiltinState = 'starting' | 'ready' | 'unreachable' | 'outdated'

export type BuiltinHermes = {
  /**
   * `starting` from the moment Murmur starts until the built-in answers (a
   * first start takes from about 15 seconds to a few minutes). `unreachable`:
   * it never came up within five minutes, or it stopped answering for over a
   * minute after being up. `outdated`: older than Murmur needs.
   */
  state: BuiltinState
  version?: string
  /** With `outdated`: the version Murmur needs. */
  minVersion?: string
  /** A model is set up. Left out when it couldn't be asked (e.g. still starting). */
  hasModel?: boolean
  /** How many agents it has, the main one included. */
  agents?: number
  /** It's one of this Murmur's servers (chosen in onboarding or added in Settings). */
  added: boolean
}

export type FoundAgent = {
  /** The profile name: the Buddy seed, so the face matches the one it has in the app. */
  id: string
  name: string
  /** ui_meta.murmur.hue, when Murmur gave it one. */
  hue?: number
  /** ui_meta['hermes-bots'].color (hex), when another app gave it one. */
  color?: string
  isDefault?: boolean
}

export type FoundWhere = 'umbrel' | 'computer' | 'network'

export type FoundHermes = {
  /** Stable while Murmur runs: send it back to choose or add this one. */
  id: string
  /** "Hermes Agent", "Hermes on this computer", "Hermes on studio.local". */
  name: string
  where: FoundWhere
  /** Its address, for a form (e.g. prefilled when it needs a password). */
  url: string
  /** The address as shown small: "studio.local:9119". */
  host: string
  version?: string
  /** Older than Murmur needs: show it, with how to update; it can't be chosen. */
  outdated?: boolean
  minVersion?: string
  /** It runs from an image (Docker): updated by pulling a newer one, not with `hermes update`. */
  fromImage?: boolean
  /** Password-protected: Murmur sent it nothing; choosing it takes a username and password. */
  needsSignIn?: boolean
  /**
   * It answered a while ago and doesn't now, most often because it's being
   * updated: the rest is what it showed then. Shown, but it can't be chosen
   * until it's back.
   */
  away?: boolean
  hasModel?: boolean
  /** Main agent first, then Hermes's order. Left out when unknown (needs a sign-in, or it wouldn't say). */
  agents?: FoundAgent[]
  /** Every agent, when `agents` is known. */
  agentCount?: number
  /** Chats across every agent (not counting routine runs), when cheap to know. */
  chats?: number
}

export type Setup = {
  /** A Hermes is already chosen (saved, or pinned by HERMES_URL): skip the choice. */
  decided: boolean
  /** Murmur runs on umbrelOS: say "on this Umbrel". */
  umbrel: boolean
  /** The Hermes that comes with Murmur, or null when this Murmur has none (desktop, plain Docker). */
  builtin: BuiltinHermes | null
  /** Hermes Murmur found, not counting any already among its servers. */
  found: FoundHermes[]
}

export const setupKey = ['murmur', 'setup'] as const

async function request(method: string, path: string, body?: unknown) {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Can’t reach Murmur. Check your connection, then try again.')
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return { res, data }
}

async function getSetup(path: string): Promise<Setup> {
  const { res, data } = await request('GET', path)
  if (!res.ok || !data || typeof data.decided !== 'boolean') throw new Error(`Murmur returned ${res.status}`)
  return data as unknown as Setup
}

/** The answer; the server reuses what it found for a few seconds. */
export const fetchSetup = () => getSetup('/murmur/setup')

/**
 * The setup answer. Fresh on every mount during onboarding; `polling` asks
 * again every 1.5s, always or while the answer it's given says to.
 */
export function useSetup({
  polling = false,
  enabled = true,
}: { polling?: boolean | ((setup: Setup | undefined) => boolean); enabled?: boolean } = {}) {
  return useQuery({
    queryKey: setupKey,
    queryFn: fetchSetup,
    staleTime: 0,
    enabled,
    refetchInterval: (q) => ((typeof polling === 'function' ? polling(q.state.data) : polling) ? 1500 : false),
    retry: 1,
  })
}

/** Out of date or away: Murmur keeps looking, so it shows up updated without anyone asking. */
export const waitingOn = (f: FoundHermes) => Boolean(f.outdated || f.away)

/**
 * Look again now, past the server's few seconds of reuse: "Check again" after
 * an update, "Try again". Never throws: resolves to the new answer, or the
 * last one when Murmur couldn't be reached (the query then holds the error).
 */
export function useLookAgain() {
  const qc = useQueryClient()
  return async () => {
    await qc
      .fetchQuery({ queryKey: setupKey, queryFn: () => getSetup('/murmur/setup?again=1'), staleTime: 0 })
      .catch(() => {})
    return qc.getQueryData<Setup>(setupKey)
  }
}

// ── Choosing ────────────────────────────────────────────────────────────────

export type Choice = { use: 'builtin' } | { use: 'found'; id: string; username?: string; password?: string }

export type ChoiceResult =
  /** Chosen. `connection.status` is not 'connected' while the built-in is still starting. */
  | ({ ok: true; connection: KnownHermes; builtin?: BuiltinHermes | null } & HermesList)
  /** It couldn't be used: show `connection.status` / `connection.error` (needs-login, bad-login, unreachable, outdated). */
  | { ok: false; reason: 'failed'; connection: HermesConnection }
  /** That found Hermes isn't there anymore: refetch the setup. */
  | { ok: false; reason: 'gone'; error: string }
  /** Another browser chose first: follow the server (refetch the setup and connection). */
  | ({ ok: false; reason: 'decided' } & HermesList)

function toResult(status: number, data: Record<string, unknown> | null): ChoiceResult {
  if (status === 200 && data?.connection)
    return { ok: true, ...(data as Omit<Extract<ChoiceResult, { ok: true }>, 'ok'>) }
  if (status === 409 && data?.error === 'decided')
    return { ok: false, reason: 'decided', ...(data as unknown as HermesList) }
  if (status === 404)
    return {
      ok: false,
      reason: 'gone',
      error: (data?.message as string | undefined) ?? 'That Hermes isn’t answering anymore.',
    }
  const connection = (data?.connection ?? data) as HermesConnection | null
  if (connection && 'status' in connection) return { ok: false, reason: 'failed', connection }
  throw new Error((data?.error as string | undefined) ?? `Murmur returned ${status}`)
}

/** Make this the Hermes this Murmur uses (onboarding). This browser's cookie moves to it. */
export async function chooseHermes(choice: Choice): Promise<ChoiceResult> {
  const { res, data } = await request('POST', '/murmur/setup', choice)
  return toResult(res.status, data)
}

/** Add a found Hermes (by its id) or the built-in to this Murmur's servers, without switching unless `activate`. */
export async function addFoundHermes(
  id: string,
  { username, password, activate = false }: { username?: string; password?: string; activate?: boolean } = {},
): Promise<ChoiceResult> {
  const body = isBuiltinId(id) ? { builtin: true, activate } : { found: id, username, password, activate }
  const { res, data } = await request('POST', '/murmur/connections', body)
  return toResult(res.status, data)
}

/**
 * After a successful choice: carry on with the chosen Hermes. In place when
 * this tab files things where the chosen one does (a first run becoming the
 * first saved Hermes); otherwise through the switch curtain and a reload.
 * Returns false when it reloads.
 */
export function useCarryOn() {
  const qc = useQueryClient()
  return (result: Extract<ChoiceResult, { ok: true }>) => {
    const { connection } = result
    if (connection.id !== tabHermes() && !adoptHermes(connection.id)) {
      void switchHermes(connection, { activated: true })
      return false
    }
    qc.setQueryData(connectionKey, connection)
    qc.setQueryData(connectionsKey, { active: result.active, connections: result.connections })
    void qc.invalidateQueries({ queryKey: setupKey })
    if (connection.status === 'connected') void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'murmur' })
    return true
  }
}

// ── Choosing what to show ───────────────────────────────────────────────────

const WHERE_ORDER: Record<FoundWhere, number> = { umbrel: 0, computer: 1, network: 2 }

const usability = (f: FoundHermes) => (f.away ? 3 : f.outdated ? 1 : f.needsSignIn ? 2 : 0)

const agentsIn = (f: FoundHermes) => f.agentCount ?? f.agents?.length ?? 0

/** The found Hermes to lead with: usable before outdated before needs a password before away, then on this Umbrel, then the most agents. */
export function pickLead(found: readonly FoundHermes[]): FoundHermes | undefined {
  return [...found].sort(
    (a, b) => usability(a) - usability(b) || WHERE_ORDER[a.where] - WHERE_ORDER[b.where] || agentsIn(b) - agentsIn(a),
  )[0]
}

/** Something worth keeping: two or more agents, any chats, or a model already set up. */
export const holdsSomething = (f: FoundHermes) => agentsIn(f) >= 2 || (f.chats ?? 0) > 0 || f.hasModel === true

/** Gets the Recommended badge: usable now, and it holds something. */
export const recommended = (f: FoundHermes) => !f.outdated && !f.needsSignIn && !f.away && holdsSomething(f)

/** The main agent first, then the order Hermes gives. */
export const orderedAgents = (f: Pick<FoundHermes, 'agents'>) =>
  [...(f.agents ?? [])].sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)))

/** "Juniper", "Juniper and Sage", "Juniper, Sage and Otto", …, "Juniper, Sage, Otto and 3 more". */
export function agentNames(f: Pick<FoundHermes, 'agents' | 'agentCount'>): string {
  const names = orderedAgents(f).map((a) => a.name)
  const total = Math.max(f.agentCount ?? 0, names.length)
  if (!names.length) return ''
  if (total > names.length || total >= 5) {
    const shown = names.slice(0, 3)
    return `${shown.join(', ')} and ${total - shown.length} more`
  }
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const NBSP = '\u00a0'

/** "6 agents", "1 chat", "100+ chats": numbers held to their word. */
export function plural(n: number, one: string, many = `${one}s`) {
  return n >= 100 && one === 'chat' ? `100+${NBSP}${many}` : `${n}${NBSP}${n === 1 ? one : many}`
}

/** "On this Umbrel · 6 agents · 100+ chats". Leaves out what's unknown or zero chats. */
export function countLine(f: Pick<FoundHermes, 'where' | 'agents' | 'agentCount' | 'chats'>): string {
  const agents = f.agentCount ?? f.agents?.length
  return [
    f.where === 'umbrel' && 'On this Umbrel',
    agents !== undefined && agents > 0 && plural(agents, 'agent'),
    f.chats ? plural(f.chats, 'chat') : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
