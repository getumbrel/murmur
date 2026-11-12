// Apps an agent reaches through Nous Research, the makers of Hermes: Slack,
// Asana, Box, Shopify, Granola and the rest of Nous's hosted catalog. Hermes
// has them built in (its connectors.* methods): Nous runs each app's sign-in
// and calls the app for the agent, so the app's data passes through Nous's
// servers. Apps Hermes connects itself (its own catalog, state/apps.ts) keep
// connecting directly, and an app offered both ways shows once, direct.
//
// Per Hermes, not per agent. The person's Nous identity lives with the main
// agent and every agent Murmur makes shares it (profiles.create's share_auth),
// and the connected accounts live with that identity at Nous. So an app
// connected here serves every agent on that Hermes, and disconnecting it
// removes it for all of them, at Nous too. Every call names that Hermes's
// main agent, so the identity lands where all its agents read it. Everything
// here says which Hermes (`hermes`: the one the agent in hand lives on).
//
// The identity is an account at Nous, created by the first connect. Murmur
// asks once first (state/hosted-apps-consent.ts), and connectHostedApp won't
// run without the answer. Reading never creates one: with no identity Hermes
// lists Nous's public catalog and no accounts, without asking Nous for them.
// Until the person agrees, agents have manage_connections switched off
// (state/toolsets.ts), since an agent using it would create one too.
//
// Connecting: Hermes asks Nous for a sign-in link, and Murmur shows it in the
// tab opened in the tap (as state/apps.ts does). The sign-in finishes on
// Nous's side, so unlike apps signed into directly it works over plain http.
// Hermes then watches the account until it's active, the sign-in fails, or
// five minutes pass. Murmur hears how it's going from Hermes's connection.update
// event (which leaves the link out) and asks for the whole picture now and
// then (connectors.operation.status), in case an event went missing.

import { create } from 'zustand'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { gateway, rpc } from '@/hermes/gateway'
import { isMissingMethod } from '@/hermes/compat'
import type {
  ConnectionOperationStatus,
  ConnectionOperationTarget,
  ConnectionUpdatePayload,
  ConnectorAccountRow,
  ConnectorAccountsResult,
  ConnectorErrorReason,
  ConnectorsCatalogResult,
  ConnectorsConnectResult,
} from '@/hermes/vendor/gateway-contract.generated'
import { arrange, isOffered, showSignIn, type CatalogApp } from './apps'
import { agentIdOn, mainOn } from '@/hermes/instance'
import { hostedConsent, recordHostedConsent } from './hosted-apps-consent'
import { allowHostedApps } from './toolsets'
import { hostedAppFrom, normal, SLUG, TWIN, type HostedApp } from './hosted-apps-names'

export { NOUS_PRIVACY_URL } from './hosted-apps-consent'
export { connectorTool, hostedAppFrom, type HostedApp } from './hosted-apps-names'

const ACCOUNT = { type: 'account' } as const
/** connectors.connect waits up to 31s for Nous's link before answering. */
const CONNECT_MS = 60_000
const POLL_MS = 2500
/** Hermes gives a sign-in five minutes; this is a little longer, in case its last word went missing. */
const FOLLOW_MS = 6 * 60_000

// ── Errors ──────────────────────────────────────────────────────────────────

/** Hermes's reason for a refusal (its error data's `reason`), when it gave one. */
export function reasonOf(error: unknown): ConnectorErrorReason | undefined {
  const data = (error as { data?: { reason?: unknown } } | null | undefined)?.data
  return typeof data?.reason === 'string' ? (data.reason as ConnectorErrorReason) : undefined
}

/** connectHostedApp was asked before the person agreed (state/hosted-apps-consent.ts). */
export class HostedConsentNeeded extends Error {
  constructor() {
    super('Ask before connecting apps through Nous')
    this.name = 'HostedConsentNeeded'
  }
}

/** Why a connect didn't start, in a sentence for the person. */
export function hostedErrorText(name: string, error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message
  const raw = typeof message === 'string' ? message : ''
  switch (reasonOf(error)) {
    case 'CONNECTORS_UNAVAILABLE':
      return `${name} can’t connect through Nous on this Hermes.`
    case 'ORG_ACCESS_DENIED':
    case 'FORBIDDEN_SCOPE':
      return `Your Nous Research account doesn’t allow ${name}.`
    case 'NEEDS_NOUS_AUTH':
      return 'Your Nous Research sign-in has ended. Sign in to Nous again, then try again.'
    case 'CONNECTOR_REQUEST_FAILED':
      // Making the identity failed (tools/connectors/gateway/config.py), with Nous's wait when it named one.
      if (/could not be set up/i.test(raw)) {
        const wait = /try again in (a few seconds|about [^.]+)/i.exec(raw)?.[1]
        return `Nous Research couldn’t set up apps just now. Try again in ${wait ?? 'a moment'}.`
      }
  }
  if (isMissingMethod(error)) return `This Hermes can’t connect ${name}.`
  return `Couldn’t connect ${name}. Try again in a moment.`
}

/** Why a sign-in Nous started didn't end with the app connected. */
export function signInFailureText(name: string, target: Pick<ConnectionOperationTarget, 'state' | 'detail'>) {
  if (target.state === 'expired' || target.state === 'not_connected') return 'The sign-in took too long. Try again.'
  const detail = target.detail ?? ''
  if (/not a connector slug/i.test(detail)) return `Nous Research doesn’t offer ${name} right now.`
  if (/polic/i.test(detail)) return `${name} isn’t allowed for your Nous Research account.`
  return `${name} didn’t finish connecting. Try again.`
}

// ── Asking first ────────────────────────────────────────────────────────────

export const hostedConsentKey = (hermes: string | null) => ['hosted-consent', hermes] as const

/**
 * Whether the person agreed to apps through Nous on a Hermes. Until then,
 * a tap on one of its apps shows the consent step instead of connecting.
 */
export function useHostedConsent(hermes: string | null, enabled = true) {
  return useQuery({ queryKey: hostedConsentKey(hermes), enabled, queryFn: () => hostedConsent(hermes), staleTime: Infinity })
}

/**
 * The consent step's Continue: keeps the answer on that Hermes for every
 * browser, then lets every agent there (`agentIds`) reach apps through Nous,
 * in the background (connecting needn't wait for it). Throws when Hermes
 * didn't keep the answer, and then nothing connects.
 */
export async function agreeToHostedApps(qc: QueryClient, hermes: string | null, agentIds: readonly string[]) {
  await recordHostedConsent(hermes)
  qc.setQueryData(hostedConsentKey(hermes), true)
  void allowHostedApps(agentIds)
}

// ── The catalog ─────────────────────────────────────────────────────────────

export type HostedCatalog = {
  /** False on a Hermes without apps through Nous, or with them switched off: offer none. */
  available: boolean
  apps: HostedApp[]
  /** Nous couldn't be reached just now: apps are there, but not their list. */
  unreachable?: boolean
}

/** Nous's catalog, through Hermes. Its public one until this Hermes has an identity, then the person's own. */
export async function readHostedCatalog(hermes: string | null): Promise<HostedCatalog> {
  try {
    const res = await rpc<ConnectorsCatalogResult>('connectors.catalog', { profile: mainOn(hermes) }, CONNECT_MS)
    return { available: true, apps: res.connectors.filter((row) => SLUG.test(row.slug)).map(hostedAppFrom) }
  } catch (error) {
    if (isMissingMethod(error) || reasonOf(error) === 'CONNECTORS_UNAVAILABLE') return { available: false, apps: [] }
    if (reasonOf(error) === 'CATALOG_UNAVAILABLE' || reasonOf(error) === 'NEEDS_NOUS_AUTH')
      return { available: true, apps: [], unreachable: true }
    throw error
  }
}

export const hostedCatalogKey = (hermes: string | null) => ['hosted-catalog', hermes] as const

/** Nous's catalog. The same for every agent on a Hermes, so it's fetched once for each. */
export function useHostedCatalog(hermes: string | null, enabled = true) {
  return useQuery({
    queryKey: hostedCatalogKey(hermes),
    enabled,
    queryFn: () => readHostedCatalog(hermes),
    staleTime: 30 * 60_000,
    // Unreachable is an answer; ask again in a while rather than at once.
    refetchInterval: (query) => (query.state.data?.unreachable ? 5 * 60_000 : false),
  })
}

/** Hermes's own app that covers this one of Nous's, when Murmur offers it. */
export function directTwin(slug: string, direct: readonly CatalogApp[]): CatalogApp | undefined {
  const name = TWIN[slug]
  return direct.find((app) => isOffered(app) && (app.name === name || normal(app.name) === normal(slug)))
}

export type AppTile = { kind: 'direct'; key: string; app: CatalogApp } | { kind: 'hosted'; key: string; app: HostedApp }

// Where apps only Nous connects sit among the everyday ones, by how much
// they're used: after the app named (null: first). Google's lead once Nous
// carries them; the rest follow Murmur's design (Slack after Notion…).
const PLACE: [slug: string, after: string | null][] = [
  ['gmail', null],
  ['googlecalendar', 'gmail'],
  ['googledrive', 'googlecalendar'],
  ['slack', 'notion'],
  ['asana', 'linear'],
  ['box', 'asana'],
  ['shopify', 'atlassian'],
  ['granola_mcp', 'shopify'],
]

/**
 * Everything the Apps sheet offers, in order: Hermes's apps (state/apps.ts's
 * arrange) with Nous's among them. An app Hermes connects itself shows once,
 * direct; Nous's ranked apps take their places, its other everyday apps
 * follow, and developer tools from both are sorted by name.
 */
export function arrangeApps(direct: CatalogApp[], hosted: readonly HostedApp[], nameOf: (name: string) => string) {
  const shown = hosted.filter((app) => !directTwin(app.slug, direct))
  const { everyday, developer } = arrange(direct, nameOf)
  const tiles: AppTile[] = everyday.map((app) => ({ kind: 'direct', key: app.name, app }))
  const anchors = new Map(PLACE)
  const keyOf = (tile: AppTile) => (tile.kind === 'direct' ? tile.app.name : tile.app.slug)
  let front = 0
  const at = (after: string | null): number => {
    for (let anchor = after; anchor !== null;) {
      const i = tiles.findIndex((tile) => keyOf(tile) === anchor)
      if (i >= 0) return i + 1
      // An app Murmur doesn't offer: after the ranked ones.
      if (!anchors.has(anchor)) return tiles.length
      anchor = anchors.get(anchor)!
    }
    return front++
  }
  for (const [slug, after] of PLACE) {
    const app = shown.find((a) => a.slug === slug)
    if (app) tiles.splice(at(after), 0, { kind: 'hosted', key: `nous:${slug}`, app })
  }
  const byName = (a: AppTile, b: AppTile) =>
    (a.kind === 'direct' ? nameOf(a.app.name) : a.app.name).localeCompare(
      b.kind === 'direct' ? nameOf(b.app.name) : b.app.name,
    )
  const rest = shown.filter((app) => !anchors.has(app.slug))
  const hostedTile = (app: HostedApp): AppTile => ({ kind: 'hosted', key: `nous:${app.slug}`, app })
  return {
    everyday: [
      ...tiles,
      ...rest
        .filter((app) => app.everyday)
        .map(hostedTile)
        .sort(byName),
    ],
    developer: [
      ...developer.map((app): AppTile => ({ kind: 'direct', key: app.name, app })),
      ...rest.filter((app) => !app.everyday).map(hostedTile),
    ].sort(byName),
  }
}

// ── Accounts ────────────────────────────────────────────────────────────────

export type HostedAccountState =
  /** Working. */
  | 'connected'
  /** A sign-in under way (or left unfinished). */
  | 'pending'
  /** The app or Nous stopped accepting it: sign in again. */
  | 'signin'

export type HostedAccount = {
  /** Nous's id for it (connection_id): what disconnecting and signing in again name. */
  id: string
  slug: string
  /** Who it is at the app, as the app says (an email address, a workspace). */
  label: string
  /** The name it was given when one app has several ("work"), else null. */
  alias: string | null
  state: HostedAccountState
  since: Date
}

/** One of Nous's account rows as Murmur keeps it; null for one a reconnect retired. */
export function hostedAccountFrom(row: ConnectorAccountRow): HostedAccount | null {
  if (row.disabled) return null
  const state: HostedAccountState =
    row.status === 'active' ? 'connected' : row.status === 'pending' ? 'pending' : 'signin'
  return {
    id: row.connection_id,
    slug: row.connector,
    label: row.label,
    alias: row.alias?.trim() || null,
    state,
    since: new Date(row.created_at),
  }
}

/** The accounts connected through Nous on a Hermes. None, without a call to Nous, until it has an identity. */
export async function readHostedAccounts(hermes: string | null): Promise<HostedAccount[]> {
  try {
    const { accounts } = await rpc<ConnectorAccountsResult>('connectors.accounts', { profile: mainOn(hermes) })
    return accounts
      .map(hostedAccountFrom)
      .filter((a): a is HostedAccount => a !== null)
      .sort((a, b) => a.slug.localeCompare(b.slug) || b.since.getTime() - a.since.getTime())
  } catch (error) {
    if (isMissingMethod(error) || reasonOf(error) === 'CONNECTORS_UNAVAILABLE') return []
    throw error
  }
}

export const hostedAccountsKey = (hermes: string | null) => ['hosted-accounts', hermes] as const

export function useHostedAccounts(hermes: string | null, enabled = true) {
  return useQuery({ queryKey: hostedAccountsKey(hermes), enabled, queryFn: () => readHostedAccounts(hermes), staleTime: 30_000 })
}

export type ConnectedHostedApp = { app: HostedApp; account: HostedAccount }

/**
 * What the Apps sheet lists as connected through Nous: one row per account
 * that works or needs signing in again, with its app (from the catalog, or
 * made up from the slug when Nous no longer lists it). Sign-ins under way
 * show on their tile instead (useHostedConnection).
 */
export function connectedHostedApps(
  apps: readonly HostedApp[] | undefined,
  accounts: readonly HostedAccount[] | undefined,
): ConnectedHostedApp[] {
  return (accounts ?? [])
    .filter((account) => account.state !== 'pending')
    .map((account) => ({
      account,
      app: apps?.find((a) => a.slug === account.slug) ?? hostedAppFrom({ slug: account.slug }),
    }))
}

/** The apps connected through Nous, for the Apps sheet's list. */
export function useConnectedHostedApps(hermes: string | null, enabled = true) {
  const catalog = useHostedCatalog(hermes, enabled)
  const accounts = useHostedAccounts(hermes, enabled && catalog.data?.available === true)
  return { ...accounts, data: accounts.data && connectedHostedApps(catalog.data?.apps, accounts.data) }
}

// ── Connecting ──────────────────────────────────────────────────────────────

export type HostedPhase =
  /** Asking Nous for the sign-in (up to half a minute). */
  | 'starting'
  /** The sign-in is open in another tab. */
  | 'signing-in'
  /** The browser wouldn't open the tab: `url` takes a tap (openHostedSignIn). */
  | 'blocked'
  | 'done'
  | 'failed'

export type HostedConnection = {
  phase: HostedPhase
  /** The sign-in, once Nous made it. */
  url?: string
  /** What went wrong, for 'failed', in a sentence for the person. */
  message?: string
}

// Connects under way, by app and the Hermes it's being connected on (an app's
// slug alone on the first Hermes, as an agent's id is its name there).
type Store = Record<string, HostedConnection>
const slot = (hermes: string | null, slug: string) => agentIdOn(hermes, slug)
export const useHostedConnections = create<Store>(() => ({}))
const patch = (hermes: string | null, slug: string, next: HostedConnection | null) =>
  useHostedConnections.setState((all) => {
    const copy = { ...all }
    if (next) copy[slot(hermes, slug)] = next
    else delete copy[slot(hermes, slug)]
    return copy
  }, true)

/** How connecting one app on a Hermes is going, in this tab. */
export const useHostedConnection = (hermes: string | null, slug: string | undefined) =>
  useHostedConnections((all) => (slug ? all[slot(hermes, slug)] : undefined))

/** How connecting one app on a Hermes is going, as it stands now. */
export const hostedConnection = (hermes: string | null, slug: string) => useHostedConnections.getState()[slot(hermes, slug)]

/** One Hermes's connects under way, by app. */
export function hostedConnectionsOn(all: Store, hermes: string | null): [slug: string, connection: HostedConnection][] {
  return Object.entries(all).flatMap(([key, connection]) => {
    const at = key.indexOf('~')
    const slug = at < 0 ? key : key.slice(at + 1)
    return slot(hermes, slug) === key ? [[slug, connection] as [string, HostedConnection]] : []
  })
}

/** One connect in this tab, from the tap to the end. */
type Flow = {
  hermes: string | null
  slug: string
  name: string
  tab?: Window | null
  /** The account it repairs, when signing in again. */
  repair?: string
  opId?: string
  seq: number
  target?: ConnectionOperationTarget
  /** The link last shown, so a new one (a retry) is shown again. */
  shown?: string
  over?: boolean
}
const flows = new Map<string, Flow>()
const live = (flow: Flow) => flows.get(slot(flow.hermes, flow.slug)) === flow && !flow.over

type Snapshot = Pick<ConnectionOperationStatus, 'op_id' | 'seq' | 'settled' | 'settled_by' | 'targets'>

/**
 * One target as the newest frame has it. Hermes's event leaves out the link
 * and the account (methods_connectors._connection_update), so they're kept
 * from the last reply, unless a new attempt has started (a new link is
 * coming then, and the old one is dead).
 */
export function mergeTarget(
  held: ConnectionOperationTarget | undefined,
  next: ConnectionOperationTarget,
): ConnectionOperationTarget {
  if (!held) return next
  const reissued = next.state === 'initiated' && held.state !== 'initiated'
  return {
    ...next,
    connect_url: next.connect_url ?? (reissued ? null : held.connect_url),
    connection_id: next.connection_id ?? held.connection_id,
  }
}

/**
 * Where a connect stands, from its target: still starting, waiting on the
 * sign-in, done, failed, or let go by the person (null).
 */
export function phaseOf(target: ConnectionOperationTarget, settled: boolean): HostedPhase | null {
  switch (target.state) {
    case 'connected':
      return 'done'
    case 'initiated':
      return target.connect_url ? 'signing-in' : 'starting'
    case 'pending':
      return settled ? 'failed' : 'starting'
    case 'skipped':
      return null
    default:
      // failed, expired, and not_connected (what settling leaves an unfinished target as).
      return 'failed'
  }
}

/** Applies one frame of the connect's operation; true once it's over. */
function apply(qc: QueryClient, flow: Flow, snapshot: Snapshot, from: 'reply' | 'event'): boolean {
  if (!live(flow) || snapshot.op_id !== flow.opId) return false
  // Frames can cross: an older one would move the row back.
  if (from === 'event' ? snapshot.seq <= flow.seq : snapshot.seq < flow.seq) return false
  const next = snapshot.targets.find((t) => t.name === flow.slug)
  if (!next) return false
  flow.seq = snapshot.seq
  const target = (flow.target = mergeTarget(flow.target, next))
  const phase = phaseOf(target, snapshot.settled)
  if (phase === null) return finish(qc, flow, null)
  if (phase === 'done') return finish(qc, flow, { phase: 'done' })
  if (phase === 'failed') return finish(qc, flow, { phase: 'failed', message: signInFailureText(flow.name, target) })
  if (snapshot.settled) return finish(qc, flow, { phase: 'failed', message: signInFailureText(flow.name, target) })
  const url = target.connect_url ?? undefined
  if (phase === 'signing-in' && url && url !== flow.shown) {
    flow.shown = url
    const opened = showSignIn(url, flow.tab)
    patch(flow.hermes, flow.slug, { phase: opened ? 'signing-in' : 'blocked', url })
  } else if (phase === 'starting') {
    patch(flow.hermes, flow.slug, { phase: 'starting' })
  }
  return false
}

/** Ends a connect: shows how it went, and lets go of what's left of it at Nous. */
function finish(qc: QueryClient, flow: Flow, outcome: HostedConnection | null): true {
  flow.over = true
  flows.delete(slot(flow.hermes, flow.slug))
  patch(flow.hermes, flow.slug, outcome)
  // Done: back to Murmur. Otherwise the tab may say what went wrong.
  if (outcome?.phase === 'done') flow.tab?.close()
  else void letGo(flow)
  void refresh(qc, flow.hermes, outcome?.phase === 'done')
  return true
}

/**
 * Settles the connect's operation at Hermes and removes the unfinished
 * account the sign-in made at Nous, so a failed or cancelled connect leaves
 * nothing behind. An account being signed into again is left alone.
 */
async function letGo(flow: Flow) {
  if (!flow.opId) return
  await rpc('connection.respond', {
    profile: mainOn(flow.hermes),
    owner: ACCOUNT,
    op_id: flow.opId,
    result: { settled_by: 'continue' },
  }).catch(() => {})
  const made = flow.target?.connection_id
  if (made && flow.target?.state !== 'connected' && !flow.repair)
    await rpc('connectors.accounts.remove', { profile: mainOn(flow.hermes), connection_id: made }).catch(() => {})
}

/** The first connect also gives its Hermes its identity, and with it the person's own catalog. */
const refresh = (qc: QueryClient, hermes: string | null, catalog: boolean) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: hostedAccountsKey(hermes) }),
    catalog && qc.invalidateQueries({ queryKey: hostedCatalogKey(hermes) }),
  ])

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Asks Hermes where the connect stands; true once it's over. */
async function check(qc: QueryClient, flow: Flow): Promise<boolean> {
  try {
    const status = await rpc<ConnectionOperationStatus>('connectors.operation.status', {
      profile: mainOn(flow.hermes),
      owner: ACCOUNT,
      op_id: flow.opId,
    })
    return apply(qc, flow, status, 'reply')
  } catch (error) {
    if (!live(flow)) return true
    // Hermes forgets an operation once it's settled: the account says how it went.
    if (reasonOf(error) === 'UNKNOWN_OPERATION') return settleByAccount(qc, flow)
    return false
  }
}

async function settleByAccount(qc: QueryClient, flow: Flow): Promise<boolean> {
  const made = flow.target?.connection_id ?? flow.repair
  const accounts = await readHostedAccounts(flow.hermes).catch(() => undefined)
  if (!live(flow)) return true
  const account = accounts?.find((a) => a.id === made)
  if (account?.state === 'connected') return finish(qc, flow, { phase: 'done' })
  return finish(qc, flow, { phase: 'failed', message: signInFailureText(flow.name, { state: 'expired' }) })
}

async function follow(qc: QueryClient, flow: Flow) {
  const off = gateway.on('connection.update', (event) => {
    const update = event.payload as ConnectionUpdatePayload | undefined
    // (Each Hermes numbers its own operations: only the one this connect is on speaks for it.)
    if (event.hermes !== undefined && event.hermes !== flow.hermes) return
    if (update?.owner?.type !== 'account' || update.op_id !== flow.opId) return
    const over = apply(qc, flow, update, 'event')
    // A new attempt's link only comes with a reply.
    if (!over && flow.target?.state === 'initiated' && !flow.target.connect_url) void check(qc, flow)
  })
  // Back from the sign-in: Hermes reads the account now, not at its next look.
  const back = () => {
    if (document.visibilityState !== 'visible' || !live(flow)) return
    void rpc('connectors.operation.wake', { profile: mainOn(flow.hermes), owner: ACCOUNT, op_id: flow.opId })
      .catch(() => {})
      .then(() => live(flow) && check(qc, flow))
  }
  document.addEventListener('visibilitychange', back)
  try {
    const until = Date.now() + FOLLOW_MS
    while (live(flow) && Date.now() < until) {
      await wait(POLL_MS)
      if (!live(flow) || (await check(qc, flow))) return
    }
    if (live(flow)) await settleByAccount(qc, flow)
  } finally {
    off()
    document.removeEventListener('visibilitychange', back)
  }
}

/**
 * Connects an app through Nous, for every agent on a Hermes. `tab` is the
 * one openSignInTab (state/apps.ts) opened in the tap; `account` signs an
 * account that stopped working in again instead of adding another. Progress
 * is in useHostedConnection. Throws HostedConsentNeeded, before asking Hermes
 * anything, when the person hasn't agreed to apps through Nous.
 */
export async function connectHostedApp(
  qc: QueryClient,
  hermes: string | null,
  app: Pick<HostedApp, 'slug' | 'name'>,
  { tab, account }: { tab?: Window | null; account?: Pick<HostedAccount, 'id'> } = {},
) {
  const key = slot(hermes, app.slug)
  let agreed: boolean
  try {
    agreed = await hostedConsent(hermes)
  } catch (error) {
    // Hermes can't say: it can't connect anything either.
    tab?.close()
    return patch(hermes, app.slug, { phase: 'failed', message: hostedErrorText(app.name, error) })
  }
  if (!agreed) {
    tab?.close()
    throw new HostedConsentNeeded()
  }
  const earlier = flows.get(key)
  if (earlier) earlier.over = true
  const flow: Flow = { hermes, slug: app.slug, name: app.name, tab, repair: account?.id, seq: -1 }
  flows.set(key, flow)
  patch(hermes, app.slug, { phase: 'starting' })
  let started: ConnectorsConnectResult
  try {
    started = await rpc<ConnectorsConnectResult>(
      'connectors.connect',
      {
        profile: mainOn(hermes),
        owner: ACCOUNT,
        connectors: [app.slug],
        ...(account && { reconnect: true, connection_id: account.id }),
      },
      CONNECT_MS,
    )
  } catch (error) {
    if (!live(flow)) return
    flow.over = true
    flows.delete(key)
    tab?.close()
    patch(hermes, app.slug, { phase: 'failed', message: hostedErrorText(app.name, error) })
    void refresh(qc, hermes, false)
    return
  }
  flow.opId = started.op_id
  if (!live(flow)) {
    // Cancelled while Nous made the link: let that go too. (A second tap's
    // connect shares this operation, and carries on with it.)
    flow.target = started.targets.find((t) => t.name === app.slug)
    if (!flows.has(key)) void letGo(flow)
    return
  }
  void qc.invalidateQueries({ queryKey: hostedAccountsKey(hermes) })
  if (!apply(qc, flow, started, 'reply')) void follow(qc, flow)
}

/** Opens a sign-in the browser blocked, from a tap. */
export function openHostedSignIn(hermes: string | null, slug: string) {
  const current = hostedConnection(hermes, slug)
  if (current?.phase !== 'blocked' || !current.url) return
  if (showSignIn(current.url)) patch(hermes, slug, { ...current, phase: 'signing-in' })
}

/** Stops a connect: closes its tab, and leaves nothing half-made at Nous. */
export async function cancelHostedConnect(qc: QueryClient, hermes: string | null, slug: string) {
  const flow = flows.get(slot(hermes, slug))
  patch(hermes, slug, null)
  if (!flow) return
  flow.over = true
  flows.delete(slot(hermes, slug))
  flow.tab?.close()
  await letGo(flow)
  void refresh(qc, hermes, false)
}

/** Forgets how a connect went, once the person has seen it. */
export const clearHostedConnection = (hermes: string | null, slug: string) => patch(hermes, slug, null)

// ── Disconnecting ───────────────────────────────────────────────────────────

/** Why a disconnect didn't happen, in a sentence for the person. */
export function disconnectErrorText(name: string, error: unknown) {
  if (reasonOf(error) === 'ACCOUNTS_UNAVAILABLE')
    return `Couldn’t reach Nous Research to disconnect ${name}. Try again in a moment.`
  return `Couldn’t disconnect ${name}. Try again in a moment.`
}

/**
 * Disconnects an account from every agent on its Hermes, and removes it at
 * Nous. Hermes would make an identity for a call like this one if there were
 * none, so it only takes an account Hermes listed (which means there is one).
 * One Hermes no longer has counts as done. Throws, with words for the person.
 */
export async function disconnectHostedApp(qc: QueryClient, hermes: string | null, account: HostedAccount, name: string) {
  const key = hostedAccountsKey(hermes)
  const before = qc.getQueryData<HostedAccount[]>(key)
  qc.setQueryData<HostedAccount[]>(key, (list) => list?.filter((a) => a.id !== account.id))
  try {
    await rpc('connectors.accounts.remove', { profile: mainOn(hermes), connection_id: account.id })
  } catch (error) {
    if (reasonOf(error) !== 'CONNECTION_NOT_FOUND') {
      qc.setQueryData(key, before)
      throw new Error(disconnectErrorText(name, error))
    }
  } finally {
    void qc.invalidateQueries({ queryKey: key })
  }
}
