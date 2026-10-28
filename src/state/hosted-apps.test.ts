import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConnectionOperationStatus,
  ConnectionOperationTarget,
  ConnectionUpdatePayload,
  ConnectorAccountRow,
  ConnectorCatalogRow,
  ConnectorsConnectResult,
} from '@/hermes/vendor/gateway-contract.generated'

// Hermes's connectors.* methods (tui_gateway/methods_connectors*.py, 0.22.5)
// as fakes. Payloads below are typed with Hermes's generated wire contract and
// shaped the way its handlers build them: `_operation_view` (a snapshot plus
// `settled`), `Target.snapshot` (with `resolved`), and the account-owned
// `connection.update` broadcast, which drops `connect_url` and `connection_id`.
type Handler = (params: Record<string, unknown>) => unknown
const routes: Record<string, Handler> = {}
const calls: { method: string; params: Record<string, unknown> }[] = []
const listeners = new Map<string, Set<(event: { type: string; payload: unknown }) => void>>()
const rpc = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
  calls.push({ method, params })
  const handler = routes[method]
  if (!handler) throw Object.assign(new Error('Method not found'), { code: -32601 })
  return handler(params)
})
vi.mock('@/hermes/gateway', () => ({
  rpc,
  gateway: {
    on: (type: string, fn: (event: { type: string; payload: unknown }) => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(fn)
      listeners.set(type, set)
      return () => set.delete(fn)
    },
  },
}))
vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: Error }))
vi.mock('@/lib/desktop', () => ({ isDesktop: false }))
const allowHostedApps = vi.fn(async (_ids: readonly string[]) => {})
vi.mock('./toolsets', () => ({ allowHostedApps }))

const hosted = await import('./hosted-apps')
const consent = await import('./hosted-apps-consent')
const {
  agreeToHostedApps,
  arrangeApps,
  cancelHostedConnect,
  connectHostedApp,
  connectedHostedApps,
  disconnectHostedApp,
  hostedAccountFrom,
  hostedAppFrom,
  hostedErrorText,
  HostedConsentNeeded,
  mergeTarget,
  openHostedSignIn,
  phaseOf,
  readHostedAccounts,
  readHostedCatalog,
  useHostedConnections,
} = hosted

const refused = (code: number, reason: string, message = reason) =>
  Object.assign(new Error(message), { code, data: { reason } })

const qc = {
  invalidateQueries: vi.fn(() => Promise.resolve()),
  setQueryData: vi.fn(),
  getQueryData: vi.fn(),
}

// ── Recorded payloads ───────────────────────────────────────────────────────

const row = (
  slug: string,
  name: string,
  category: string,
  description = `Use ${name} through Hermes`,
): ConnectorCatalogRow => ({
  slug,
  name,
  description,
  category,
  logo_url: `https://logos.composio.dev/api/${slug}`,
})
const CATALOG: ConnectorCatalogRow[] = [
  row('slack', 'Slack', 'Communication', 'Read and post messages, and search channels'),
  row('asana', 'Asana', 'Work management', 'Read and manage tasks and projects'),
  row('box', 'Box', 'Files and docs', 'Find, read, and manage files and folders'),
  row('shopify', 'Shopify', 'Commerce', 'Manage products, orders, and customers'),
  row('granola_mcp', 'Granola', 'Work management', 'Search meeting notes and transcripts'),
  row('notion', 'Notion', 'Files and docs', 'Search, read, and edit pages and databases'),
  row('linear', 'Linear', 'Work management', 'Search, create, and update issues and projects'),
  row('canva_mcp', 'Canva', 'Design and media', 'Find, create, and edit designs'),
  row('clickup_mcp', 'Clickup', 'Developer'),
  row('jira', 'Jira', 'Work management', 'Search, create, and update issues'),
  row('discordbot', 'Discord Bot', 'Communication', 'Post and moderate in a server as a bot'),
  row('apollo', 'Apollo', 'Sales and support', 'Find contacts and manage outreach'),
  row('posthog_mcp', 'PostHog', 'Data and monitoring', 'Query product analytics and feature flags'),
  row('greptile_mcp', 'Greptile', 'Developer'),
  row('memelord_mcp', 'Memelord', 'Developer'),
  row('resend_mcp', 'Resend', 'Communication', 'Send and manage transactional email'),
]

const mcp = (name: string) => ({
  name,
  description: '',
  auth_type: 'oauth',
  required_env: [],
  url: null,
  needs_install: false,
})
// Hermes's own catalog: Asana is in it, but Murmur doesn't offer it (it can't sign in through Hermes).
const DIRECT = [
  'notion',
  'todoist',
  'canva',
  'figma',
  'linear',
  'airtable',
  'atlassian',
  'gamma',
  'clickup',
  'asana',
  'sentry',
].map(mcp)

const target = (over: Partial<ConnectionOperationTarget> = {}): ConnectionOperationTarget => ({
  name: 'slack',
  kind: 'connector',
  action: 'connect',
  state: 'pending',
  resolved: false,
  ...over,
})
const LINK = 'https://connect.composio.dev/link/lk_123'
const started = (
  t: Partial<ConnectionOperationTarget>,
  over: Partial<ConnectorsConnectResult> = {},
): ConnectorsConnectResult => ({
  op_id: 'a1b2c3d4e5f6',
  seq: 2,
  deadline_at: 1_800_000_300,
  settled: false,
  settled_at: null,
  settled_by: null,
  targets: [target(t)],
  ...over,
})
/**
 * methods_connectors._connection_update for an account operation: the change
 * (target, from, to, actor, detail) over the whole snapshot, whose targets
 * carry the same detail, and no link or account id.
 */
const update = (
  to: ConnectionOperationTarget['state'],
  seq: number,
  over: Partial<ConnectionUpdatePayload> = {},
): ConnectionUpdatePayload => {
  const settled = over.settled ?? false
  return {
    op_id: 'a1b2c3d4e5f6',
    seq,
    deadline_at: 1_800_000_300,
    settled,
    settled_at: settled ? 1_800_000_100 : null,
    settled_by: settled ? 'all_resolved' : null,
    targets: [
      target({
        state: to,
        resolved: to === 'connected' || to === 'skipped',
        ...(over.detail && { detail: over.detail }),
      }),
    ],
    owner: { type: 'account' },
    target: 'slack',
    from: 'initiated',
    to,
    actor: to === 'expired' ? 'clock' : 'backend_watcher',
    detail: null,
    ...over,
  }
}
const status = (t: Partial<ConnectionOperationTarget>, seq: number, settled = false): ConnectionOperationStatus => ({
  op_id: 'a1b2c3d4e5f6',
  seq,
  deadline_at: 1_800_000_300,
  settled,
  settled_at: settled ? 1_800_000_100 : null,
  settled_by: settled ? 'all_resolved' : null,
  targets: [target(t)],
})
const account = (over: Partial<ConnectorAccountRow> = {}): ConnectorAccountRow => ({
  connection_id: 'ca_slack_1',
  connector: 'slack',
  status: 'active',
  status_reason: null,
  label: 'sam@example.com',
  alias: null,
  active: true,
  disabled: false,
  created_at: '2026-10-28T10:00:00Z',
  updated_at: '2026-10-28T10:00:00Z',
  ...over,
})

const emit = (type: string, payload: unknown) => {
  for (const fn of listeners.get(type) ?? []) fn({ type, payload })
}
const flush = () => vi.advanceTimersByTimeAsync(0)
const connection = (slug = 'slack') => useHostedConnections.getState()[slug]
const sent = (method: string) => calls.filter((c) => c.method === method).map((c) => c.params)

function agreed(yes: boolean) {
  routes['profiles.list'] = () => ({
    profiles: [
      { name: 'default', is_default: true, ui_meta: yes ? { 'murmur-nous': { since: 1_800_000_000_000 } } : {} },
      { name: 'scout', is_default: false },
    ],
  })
}

function fakeTab() {
  return { closed: false, close: vi.fn(), location: { replace: vi.fn() } }
}

let visibility: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  for (const key of Object.keys(routes)) delete routes[key]
  listeners.clear()
  useHostedConnections.setState({}, true)
  consent.forgetHostedConsent()
  qc.invalidateQueries.mockClear()
  qc.setQueryData.mockClear()
  allowHostedApps.mockClear()
  vi.stubGlobal('window', { open: vi.fn(() => ({ opener: {}, closed: false })) })
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (_: string, fn: () => void) => (visibility = fn),
    removeEventListener: () => (visibility = undefined),
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ── The catalog ─────────────────────────────────────────────────────────────

describe('Nous’s catalog', () => {
  it('reads each app the way Murmur offers it, never with Nous’s logo', async () => {
    routes['connectors.catalog'] = () => ({ connectors: [...CATALOG, row('Not A Slug', 'Bad', 'Developer')] })
    const { available, apps } = await readHostedCatalog()
    expect(available).toBe(true)
    expect(sent('connectors.catalog')).toEqual([{ profile: 'default' }])
    expect(apps.find((a) => a.slug === 'slack')).toEqual({
      slug: 'slack',
      name: 'Slack',
      description: 'Read and post messages, and search channels',
      summary: 'Messages and channels',
      icon: 'slack',
      everyday: true,
    })
    // Named and drawn as Murmur's own marks have them.
    expect(apps.find((a) => a.slug === 'clickup_mcp')).toMatchObject({
      name: 'ClickUp',
      icon: 'clickup',
      everyday: false,
    })
    expect(apps.find((a) => a.slug === 'granola_mcp')).toMatchObject({
      name: 'Granola',
      icon: 'granola',
      summary: 'Meeting notes',
    })
    expect(apps.find((a) => a.slug === 'discordbot')).toMatchObject({ name: 'Discord Bot', icon: 'discord' })
    // "Use … through Hermes" says nothing: replaced where Murmur can say more, left out otherwise.
    expect(apps.find((a) => a.slug === 'greptile_mcp')?.description).toBe('Ask questions about your code')
    expect(apps.find((a) => a.slug === 'memelord_mcp')).toMatchObject({ description: '', icon: 'memelord_mcp' })
    expect(apps.find((a) => a.slug === 'resend_mcp')?.everyday).toBe(false)
    expect(apps.some((a) => a.slug === 'Not A Slug')).toBe(false)
    expect(JSON.stringify(apps)).not.toContain('logos.composio.dev')
  })

  it('offers none on a Hermes without it, or with it switched off', async () => {
    expect(await readHostedCatalog()).toEqual({ available: false, apps: [] })
    routes['connectors.catalog'] = () => {
      throw refused(4031, 'CONNECTORS_UNAVAILABLE', 'Connectors are not available.')
    }
    expect(await readHostedCatalog()).toEqual({ available: false, apps: [] })
  })

  it('says when Nous can’t be reached', async () => {
    routes['connectors.catalog'] = () => {
      throw refused(5034, 'CATALOG_UNAVAILABLE', 'Connector catalog is unavailable.')
    }
    expect(await readHostedCatalog()).toEqual({ available: true, apps: [], unreachable: true })
  })
})

describe('the Apps sheet’s apps', () => {
  const apps = CATALOG.map(hostedAppFrom)
  const keys = (tiles: { kind: string; app: { name: string; slug?: string } }[]) =>
    tiles.map((t) => (t.kind === 'direct' ? t.app.name : `nous:${(t.app as { slug: string }).slug}`))

  it('show an app Hermes connects itself once, direct, and Nous’s in their places', () => {
    const { everyday, developer } = arrangeApps(DIRECT, apps, (n) => n)
    expect(keys(everyday)).toEqual([
      'notion',
      'nous:slack',
      'todoist',
      'canva',
      'figma',
      'linear',
      'nous:asana',
      'nous:box',
      'airtable',
      'clickup',
      'atlassian',
      'nous:shopify',
      'nous:granola_mcp',
      'gamma',
      // Nous’s other everyday apps follow, by name.
      'nous:apollo',
      'nous:discordbot',
    ])
    expect(keys(developer)).toEqual([
      'nous:greptile_mcp',
      'nous:memelord_mcp',
      'nous:posthog_mcp',
      'nous:resend_mcp',
      'sentry',
    ])
    // Notion, Linear, Canva and ClickUp come direct; Jira comes with Atlassian.
    for (const twin of ['notion', 'linear', 'canva_mcp', 'clickup_mcp', 'jira'])
      expect(
        [...everyday, ...developer].some((t) => t.kind === 'hosted' && t.app.slug === twin),
        twin,
      ).toBe(false)
  })

  it('put Google’s apps first once Nous carries them, and keep their order when one’s missing', () => {
    const more = [
      ...apps,
      hostedAppFrom(row('googledrive', 'Google Drive', 'Files and docs')),
      hostedAppFrom(row('gmail', 'Gmail', 'Communication')),
    ]
    expect(keys(arrangeApps(DIRECT, more, (n) => n).everyday).slice(0, 4)).toEqual([
      'nous:gmail',
      'nous:googledrive',
      'notion',
      'nous:slack',
    ])
  })

  it('follow a ranked app’s neighbour when its own isn’t there', () => {
    const noAsana = apps.filter((a) => a.slug !== 'asana')
    const tiles = keys(arrangeApps(DIRECT, noAsana, (n) => n).everyday)
    expect(tiles.indexOf('nous:box')).toBe(tiles.indexOf('linear') + 1)
  })
})

describe('an app’s tools in a chat', () => {
  it('name the app and what they do', () => {
    // tools/connectors/gateway/names.py: format_connector_name strips the app's prefix.
    expect(hosted.connectorTool('connectors__slack__SEND_MESSAGE')).toMatchObject({
      app: { name: 'Slack', icon: 'slack' },
      action: 'send message',
    })
    expect(hosted.connectorTool('connectors__granola_mcp__list_meetings')).toMatchObject({
      app: { name: 'Granola' },
      action: 'list meetings',
    })
    expect(hosted.connectorTool('connectors__box__BOX_SEARCH_FOR_CONTENT')?.action).toBe('search for content')
    expect(hosted.connectorTool('mcp__umbrel__list_apps')).toBeNull()
    expect(hosted.connectorTool('connectors__execute')).toBeNull()
  })
})

// ── Accounts ────────────────────────────────────────────────────────────────

describe('accounts connected through Nous', () => {
  it('read Nous’s account rows, leaving out ones a reconnect retired', async () => {
    routes['connectors.accounts'] = () => ({
      accounts: [
        account(),
        account({
          connection_id: 'ca_slack_0',
          status: 'failed',
          status_reason: 'token revoked',
          created_at: '2026-10-01T10:00:00Z',
        }),
        account({ connection_id: 'ca_slack_old', disabled: true }),
        account({ connection_id: 'ca_box', connector: 'box', status: 'pending', alias: ' work ' }),
      ],
    })
    const list = await readHostedAccounts()
    expect(sent('connectors.accounts')).toEqual([{ profile: 'default' }])
    expect(list.map((a) => [a.id, a.state, a.alias])).toEqual([
      ['ca_box', 'pending', 'work'],
      ['ca_slack_1', 'connected', null],
      ['ca_slack_0', 'signin', null],
    ])
    expect(list[1]).toMatchObject({ slug: 'slack', label: 'sam@example.com', since: new Date('2026-10-28T10:00:00Z') })
  })

  it('are none on a Hermes without apps through Nous', async () => {
    expect(await readHostedAccounts()).toEqual([])
    routes['connectors.accounts'] = () => {
      throw refused(4031, 'CONNECTORS_UNAVAILABLE')
    }
    expect(await readHostedAccounts()).toEqual([])
  })

  it('list what works or needs signing in again, with their apps', () => {
    const rows = ['active', 'expired', 'pending'].map((s, i) =>
      hostedAccountFrom(account({ connection_id: `c${i}`, status: s as ConnectorAccountRow['status'] })),
    )
    const gone = hostedAccountFrom(account({ connection_id: 'c9', connector: 'retired_app' }))
    const listed = connectedHostedApps(
      CATALOG.map(hostedAppFrom),
      [...rows, gone].filter((a) => a !== null),
    )
    expect(listed.map((c) => [c.account.id, c.account.state, c.app.name])).toEqual([
      ['c0', 'connected', 'Slack'],
      ['c1', 'signin', 'Slack'],
      ['c9', 'connected', 'Retired App'],
    ])
  })
})

// ── Asking first ────────────────────────────────────────────────────────────

describe('asking first', () => {
  it('reads the answer from the main agent', async () => {
    agreed(false)
    expect(await consent.hostedConsent()).toBe(false)
    consent.forgetHostedConsent()
    agreed(true)
    expect(await consent.hostedConsent()).toBe(true)
  })

  it('never connects before the person agreed: nothing reaches Hermes that could make a Nous account', async () => {
    agreed(false)
    routes['connectors.connect'] = () => started({ state: 'initiated', connect_url: LINK })
    const tab = fakeTab()
    await expect(
      connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: tab as never }),
    ).rejects.toBeInstanceOf(HostedConsentNeeded)
    expect(tab.close).toHaveBeenCalled()
    expect(calls.map((c) => c.method)).toEqual(['profiles.list'])
    expect(connection()).toBeUndefined()
  })

  it('doesn’t connect when Hermes can’t say whether the person agreed', async () => {
    routes['profiles.list'] = () => {
      throw new Error('Lost connection to Hermes')
    }
    const tab = fakeTab()
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: tab as never })
    expect(connection()).toEqual({ phase: 'failed', message: 'Couldn’t connect Slack. Try again in a moment.' })
    expect(tab.close).toHaveBeenCalled()
    expect(sent('connectors.connect')).toEqual([])
  })

  it('keeps the answer on the main agent, then lets every agent reach the apps', async () => {
    routes['profiles.configure'] = () => ({ ok: true, applied: { ui_meta: true } })
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'))
    await agreeToHostedApps(qc as never, ['default', 'scout'])
    expect(sent('profiles.configure')).toEqual([
      { name: 'default', ui_meta: { 'murmur-nous': { since: Date.parse('2026-10-28T10:00:00Z') } } },
    ])
    expect(allowHostedApps).toHaveBeenCalledWith(['default', 'scout'])
    expect(await consent.hostedConsent()).toBe(true)
    expect(calls.some((c) => c.method === 'profiles.list')).toBe(false)
  })

  it('doesn’t count an answer Hermes didn’t keep', async () => {
    routes['profiles.configure'] = () => ({ ok: false, applied: { ui_meta: false } })
    await expect(agreeToHostedApps(qc as never, ['default'])).rejects.toThrow()
    expect(allowHostedApps).not.toHaveBeenCalled()
  })

  it('lets agents use apps from before Murmur asked, when this Hermes has a Nous identity already', async () => {
    agreed(false)
    routes['free_tier.status'] = () => ({ has_guest: true, enabled: false, available: false })
    expect(await consent.hostedAppsAllowed()).toBe(true)
    expect(sent('free_tier.status')).toEqual([{ profile: 'default' }])
    consent.forgetHostedConsent()
    routes['free_tier.status'] = () => ({ has_guest: false, enabled: false, available: false })
    expect(await consent.hostedAppsAllowed()).toBe(false)
  })
})

// ── Connecting ──────────────────────────────────────────────────────────────

describe('connecting an app', () => {
  beforeEach(() => agreed(true))

  it('shows Nous’s sign-in in the tab opened in the tap, and is done once Hermes sees the account', async () => {
    routes['connectors.connect'] = () => started({ state: 'initiated', connect_url: LINK, connection_id: 'ca_new' })
    routes['connectors.operation.status'] = () =>
      status({ state: 'initiated', connect_url: LINK, connection_id: 'ca_new' }, 2)
    const tab = fakeTab()
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: tab as never })
    expect(sent('connectors.connect')).toEqual([
      { profile: 'default', owner: { type: 'account' }, connectors: ['slack'] },
    ])
    expect(tab.location.replace).toHaveBeenCalledWith(LINK)
    expect(connection()).toEqual({ phase: 'signing-in', url: LINK })

    emit('connection.update', update('connected', 3))
    expect(connection()).toEqual({ phase: 'done' })
    expect(tab.close).toHaveBeenCalled()
    // The first connect makes the identity, and with it the person's own catalog.
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['hosted-accounts'] })
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['hosted-catalog'] })
    expect(sent('connection.respond')).toEqual([])
  })

  it('waits for a link Nous was slow to make, then shows it', async () => {
    routes['connectors.connect'] = () => started({ state: 'pending' }, { seq: 1 })
    let link: string | undefined
    routes['connectors.operation.status'] = () =>
      status({ state: link ? 'initiated' : 'pending', connect_url: link, connection_id: 'ca_new' }, link ? 2 : 1)
    const tab = fakeTab()
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: tab as never })
    expect(connection()).toEqual({ phase: 'starting' })
    expect(tab.location.replace).not.toHaveBeenCalled()

    // The event names the new state but leaves the link out: Murmur asks for it.
    link = LINK
    emit('connection.update', update('initiated', 2, { from: 'pending' }))
    await flush()
    expect(tab.location.replace).toHaveBeenCalledWith(LINK)
    expect(connection()).toEqual({ phase: 'signing-in', url: LINK })
  })

  it('needs a tap when the browser blocked the tab', async () => {
    routes['connectors.connect'] = () => started({ state: 'initiated', connect_url: LINK })
    vi.stubGlobal('window', { open: vi.fn(() => null) })
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: null })
    expect(connection()).toEqual({ phase: 'blocked', url: LINK })
    vi.stubGlobal('window', { open: vi.fn(() => ({ opener: {} })) })
    openHostedSignIn('slack')
    expect(window.open).toHaveBeenCalledWith(LINK, '_blank')
    expect(connection()).toEqual({ phase: 'signing-in', url: LINK })
  })

  it('is done at once for an app that was connected already', async () => {
    routes['connectors.connect'] = () =>
      started(
        { state: 'connected', resolved: true },
        { settled: true, settled_at: 1_800_000_001, settled_by: 'all_resolved' },
      )
    const tab = fakeTab()
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: tab as never })
    expect(connection()).toEqual({ phase: 'done' })
    expect(tab.close).toHaveBeenCalled()
    expect(sent('connectors.operation.status')).toEqual([])
  })

  it('says why a sign-in failed, and leaves nothing half-made at Nous', async () => {
    routes['connectors.connect'] = () => started({ state: 'initiated', connect_url: LINK, connection_id: 'ca_new' })
    routes['connection.respond'] = () => ({ status: 'ok', settled: true })
    routes['connectors.accounts.remove'] = (p) => ({
      connection_id: p.connection_id,
      connector: 'slack',
      status: 'removed',
    })
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: fakeTab() as never })
    emit('connection.update', update('failed', 3, { detail: "not allowed by your organization's policy" }))
    expect(connection()).toEqual({ phase: 'failed', message: 'Slack isn’t allowed for your Nous Research account.' })
    await flush()
    expect(sent('connection.respond')).toEqual([
      { profile: 'default', owner: { type: 'account' }, op_id: 'a1b2c3d4e5f6', result: { settled_by: 'continue' } },
    ])
    expect(sent('connectors.accounts.remove')).toEqual([{ profile: 'default', connection_id: 'ca_new' }])
  })

  it('says a sign-in took too long when Hermes gave up on it', async () => {
    routes['connectors.connect'] = () => started({ state: 'initiated', connect_url: LINK, connection_id: 'ca_new' })
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: fakeTab() as never })
    emit('connection.update', update('expired', 3))
    expect(connection()).toEqual({ phase: 'failed', message: 'The sign-in took too long. Try again.' })
  })

  it('ignores a frame older than one it has', async () => {
    routes['connectors.connect'] = () => started({ state: 'initiated', connect_url: LINK }, { seq: 5 })
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: fakeTab() as never })
    emit('connection.update', update('failed', 4))
    emit('connection.update', update('failed', 5))
    expect(connection()?.phase).toBe('signing-in')
  })

  it('asks Hermes now and then, and asks the account once Hermes has let the operation go', async () => {
    routes['connectors.connect'] = () => started({ state: 'initiated', connect_url: LINK, connection_id: 'ca_new' })
    routes['connectors.operation.status'] = () => {
      throw refused(4004, 'UNKNOWN_OPERATION', 'No open operation with that op_id.')
    }
    routes['connectors.accounts'] = () => ({ accounts: [account({ connection_id: 'ca_new' })] })
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: fakeTab() as never })
    await vi.advanceTimersByTimeAsync(2500)
    expect(sent('connectors.operation.status')).toEqual([
      { profile: 'default', owner: { type: 'account' }, op_id: 'a1b2c3d4e5f6' },
    ])
    expect(connection()).toEqual({ phase: 'done' })
  })

  it('tells Hermes the person is back from the sign-in', async () => {
    routes['connectors.connect'] = () => started({ state: 'initiated', connect_url: LINK })
    routes['connectors.operation.wake'] = () => ({ status: 'ok' })
    routes['connectors.operation.status'] = () => status({ state: 'connected', resolved: true }, 3, true)
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: fakeTab() as never })
    visibility?.()
    await flush()
    expect(sent('connectors.operation.wake')).toEqual([
      { profile: 'default', owner: { type: 'account' }, op_id: 'a1b2c3d4e5f6' },
    ])
    expect(connection()).toEqual({ phase: 'done' })
  })

  it('stops when cancelled, closing the tab and leaving nothing half-made', async () => {
    routes['connectors.connect'] = () => started({ state: 'initiated', connect_url: LINK, connection_id: 'ca_new' })
    routes['connection.respond'] = () => ({ status: 'ok', settled: true })
    routes['connectors.accounts.remove'] = () => ({ connection_id: 'ca_new', connector: 'slack', status: 'removed' })
    const tab = fakeTab()
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: tab as never })
    await cancelHostedConnect(qc as never, 'slack')
    expect(connection()).toBeUndefined()
    expect(tab.close).toHaveBeenCalled()
    expect(sent('connection.respond')[0]).toMatchObject({ op_id: 'a1b2c3d4e5f6', result: { settled_by: 'continue' } })
    expect(sent('connectors.accounts.remove')).toEqual([{ profile: 'default', connection_id: 'ca_new' }])
    // A late word from Hermes changes nothing.
    emit('connection.update', update('connected', 9))
    expect(connection()).toBeUndefined()
  })

  it('signs an account that stopped working in again, without removing it when that fails', async () => {
    routes['connectors.connect'] = () =>
      started({ state: 'initiated', action: 'reconnect', connect_url: LINK, connection_id: 'ca_slack_0' })
    routes['connection.respond'] = () => ({ status: 'ok', settled: true })
    await connectHostedApp(
      qc as never,
      { slug: 'slack', name: 'Slack' },
      { tab: fakeTab() as never, account: { id: 'ca_slack_0' } },
    )
    expect(sent('connectors.connect')[0]).toEqual({
      profile: 'default',
      owner: { type: 'account' },
      connectors: ['slack'],
      reconnect: true,
      connection_id: 'ca_slack_0',
    })
    emit('connection.update', update('expired', 3))
    await flush()
    expect(sent('connectors.accounts.remove')).toEqual([])
  })

  it('says in words why it didn’t start', async () => {
    routes['connectors.connect'] = () => {
      throw refused(
        5034,
        'CONNECTOR_REQUEST_FAILED',
        'Hosted connectors could not be set up. Lots of people are getting started right now. Try again in about 5 minutes. Signing in is free and skips the wait.',
      )
    }
    const tab = fakeTab()
    await connectHostedApp(qc as never, { slug: 'slack', name: 'Slack' }, { tab: tab as never })
    expect(connection()).toEqual({
      phase: 'failed',
      message: 'Nous Research couldn’t set up apps just now. Try again in about 5 minutes.',
    })
    expect(tab.close).toHaveBeenCalled()
  })
})

describe('the words for what went wrong', () => {
  it('never name Hermes’s parts', () => {
    const texts = [
      hostedErrorText('Slack', refused(4031, 'CONNECTORS_UNAVAILABLE')),
      hostedErrorText('Slack', refused(4030, 'ORG_ACCESS_DENIED')),
      hostedErrorText('Slack', refused(4032, 'NEEDS_NOUS_AUTH')),
      hostedErrorText(
        'Slack',
        refused(5034, 'CONNECTOR_REQUEST_FAILED', 'Connector request failed. Try again explicitly.'),
      ),
      hostedErrorText('Slack', Object.assign(new Error('Method not found'), { code: -32601 })),
    ]
    expect(texts).toEqual([
      'Slack can’t connect through Nous on this Hermes.',
      'Your Nous Research account doesn’t allow Slack.',
      'Your Nous Research sign-in has ended. Sign in to Nous again, then try again.',
      'Couldn’t connect Slack. Try again in a moment.',
      'This Hermes can’t connect Slack.',
    ])
    for (const text of texts) expect(text).not.toMatch(/connector|gateway|token|provider|mcp|plugin|toolset/i)
  })
})

describe('a target’s frames', () => {
  it('keep the link and the account the event leaves out, unless a new attempt began', () => {
    const held = target({ state: 'initiated', connect_url: LINK, connection_id: 'ca_new' })
    expect(mergeTarget(held, target({ state: 'initiated' }))).toMatchObject({
      connect_url: LINK,
      connection_id: 'ca_new',
    })
    const failed = target({ state: 'failed', connect_url: null, connection_id: 'ca_new' })
    expect(mergeTarget(failed, target({ state: 'initiated' }))).toMatchObject({
      connect_url: null,
      connection_id: 'ca_new',
    })
  })

  it('map to where the connect stands', () => {
    expect(phaseOf(target({ state: 'pending' }), false)).toBe('starting')
    expect(phaseOf(target({ state: 'initiated' }), false)).toBe('starting')
    expect(phaseOf(target({ state: 'initiated', connect_url: LINK }), false)).toBe('signing-in')
    expect(phaseOf(target({ state: 'connected' }), true)).toBe('done')
    expect(phaseOf(target({ state: 'skipped' }), true)).toBeNull()
    for (const state of ['failed', 'expired', 'not_connected'] as const)
      expect(phaseOf(target({ state }), true)).toBe('failed')
  })
})

// ── Disconnecting ───────────────────────────────────────────────────────────

describe('disconnecting', () => {
  const slack = hostedAccountFrom(account())!

  it('removes the account at Nous', async () => {
    routes['connectors.accounts.remove'] = () => ({
      connection_id: 'ca_slack_1',
      connector: 'slack',
      status: 'removed',
    })
    await disconnectHostedApp(qc as never, slack, 'Slack')
    expect(sent('connectors.accounts.remove')).toEqual([{ profile: 'default', connection_id: 'ca_slack_1' }])
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['hosted-accounts'] })
  })

  it('counts one Nous no longer has as done', async () => {
    routes['connectors.accounts.remove'] = () => {
      throw refused(4041, 'CONNECTION_NOT_FOUND', 'Connector account not found.')
    }
    await expect(disconnectHostedApp(qc as never, slack, 'Slack')).resolves.toBeUndefined()
  })

  it('says when Nous couldn’t be reached, and puts the row back', async () => {
    routes['connectors.accounts.remove'] = () => {
      throw refused(5034, 'ACCOUNTS_UNAVAILABLE', 'Connector accounts are unavailable.')
    }
    qc.getQueryData.mockReturnValueOnce([slack] as never)
    await expect(disconnectHostedApp(qc as never, slack, 'Slack')).rejects.toThrow(
      'Couldn’t reach Nous Research to disconnect Slack. Try again in a moment.',
    )
    expect(qc.setQueryData).toHaveBeenLastCalledWith(['hosted-accounts'], [slack])
  })
})
