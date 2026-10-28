import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConnectionOperationTarget,
  ConnectionRequestPayload,
  ConnectionUpdatePayload,
  ConnectorsConnectResult,
} from '@/hermes/vendor/gateway-contract.generated'

// A chat's connect card, from Hermes's session events (tui_gateway/agent_callbacks.py's
// connection_callback → connection.request; methods_connectors._connection_update →
// connection.update, which for a chat keeps the link). Payloads are typed with Hermes's
// generated wire contract.
const calls: { method: string; params: Record<string, unknown> }[] = []
const routes: Record<string, (params: Record<string, unknown>) => unknown> = {}
let onEvent: ((event: { type: string; session_id?: string; payload: unknown }) => void) | undefined
vi.mock('@/hermes/gateway', () => ({
  rpc: vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params })
    const handler = routes[method]
    if (!handler) throw Object.assign(new Error('Method not found'), { code: -32601 })
    return handler(params)
  }),
  gateway: { onEvent: (fn: typeof onEvent) => void (onEvent = fn), on: () => () => {} },
}))
vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: Error }))
vi.mock('@/lib/desktop', () => ({ isDesktop: false }))
vi.mock('./toolsets', () => ({ allowHostedApps: vi.fn() }))

const chat = await import('./hosted-apps-chat')
const {
  applyChatFrame,
  chatConnectFrom,
  finishChatConnect,
  openChatSignIn,
  restoreChatConnect,
  skipChatConnect,
  useChatConnects,
  wireChatConnects,
} = chat

const SID = 'r-20261028-abc'
const LINK = 'https://connect.composio.dev/link/lk_1'
const target = (over: Partial<ConnectionOperationTarget> = {}): ConnectionOperationTarget => ({
  name: 'slack',
  kind: 'connector',
  action: 'connect',
  state: 'initiated',
  resolved: false,
  connect_url: LINK,
  connection_id: 'ca_1',
  ...over,
})
const request = (over: Partial<ConnectionRequestPayload> = {}): ConnectionRequestPayload => ({
  op_id: 'op123',
  seq: 2,
  deadline_at: 1_800_000_300,
  timeout_seconds: 300,
  targets: [
    target(),
    target({
      name: 'linear',
      kind: 'mcp',
      action: 'authorize',
      state: 'pending',
      connect_url: null,
      connection_id: null,
    }),
  ],
  tool_call_id: 'call_7',
  ...over,
})
const update = (seq: number, targets: ConnectionOperationTarget[], settled = false): ConnectionUpdatePayload => ({
  op_id: 'op123',
  seq,
  deadline_at: 1_800_000_300,
  settled,
  settled_at: settled ? 1_800_000_200 : null,
  settled_by: settled ? 'all_resolved' : null,
  targets,
  owner: { type: 'session', session_id: SID },
  target: targets[0].name,
  from: 'initiated',
  to: targets[0].state,
  actor: 'backend_watcher',
  detail: null,
})
const qc = { invalidateQueries: vi.fn(() => Promise.resolve()) }
const card = () => useChatConnects.getState()[SID]
const sent = (method: string) => calls.filter((c) => c.method === method).map((c) => c.params)

beforeEach(() => {
  calls.length = 0
  for (const key of Object.keys(routes)) delete routes[key]
  useChatConnects.setState({}, true)
  qc.invalidateQueries.mockClear()
  vi.stubGlobal('window', { open: vi.fn(() => ({ opener: {} })) })
})
afterEach(() => vi.unstubAllGlobals())

describe('a chat’s connect card', () => {
  it('comes from Hermes’s request, under the agent’s tool call', () => {
    expect(chatConnectFrom(request(), SID)).toEqual({
      sessionId: SID,
      opId: 'op123',
      toolCallId: 'call_7',
      seq: 2,
      deadline: 1_800_000_300_000,
      settled: false,
      suggested: null,
      targets: [
        { name: 'slack', kind: 'connector', state: 'initiated', url: LINK, detail: '' },
        { name: 'linear', kind: 'mcp', state: 'pending', url: null, detail: '' },
      ],
    })
  })

  it('can be a directory of apps, with the ones the agent suggests', () => {
    expect(chatConnectFrom(request({ targets: [], display: { suggested: ['slack', 'asana'] } }), SID)).toMatchObject({
      suggested: ['slack', 'asana'],
      targets: [],
    })
    expect(chatConnectFrom(request({ targets: [] }), SID)).toBeNull()
    expect(chatConnectFrom(null, SID)).toBeNull()
  })

  it('moves with Hermes’s frames, never back to an older one', () => {
    const first = chatConnectFrom(request(), SID)!
    const connected = applyChatFrame(
      first,
      update(3, [target({ state: 'connected', resolved: true, connect_url: null })]),
    )
    expect(connected.targets[0]).toMatchObject({ state: 'connected', url: LINK })
    expect(applyChatFrame(connected, update(3, [target({ state: 'failed' })]))).toBe(connected)
    expect(applyChatFrame(connected, update(2, [target({ state: 'failed' })]))).toBe(connected)
    expect(applyChatFrame(connected, { ...update(9, [target()]), op_id: 'other' })).toBe(connected)
    const settled = applyChatFrame(connected, update(4, [target({ state: 'connected' })], true))
    expect(settled.settled).toBe(true)
    expect(applyChatFrame(settled, update(5, [target({ state: 'failed' })]))).toBe(settled)
  })

  it('drops a dead link once a new attempt starts', () => {
    const failed = applyChatFrame(
      chatConnectFrom(request(), SID)!,
      update(3, [target({ state: 'failed', connect_url: null })]),
    )
    expect(failed.targets[0].url).toBe(LINK)
    expect(applyChatFrame(failed, update(4, [target({ connect_url: null })])).targets[0].url).toBeNull()
  })

  it('is kept per chat from Hermes’s events, and tells the Apps sheet when an app connects', () => {
    wireChatConnects(qc as never)
    onEvent?.({ type: 'connection.request', session_id: SID, payload: request() })
    expect(card()?.opId).toBe('op123')
    // Another chat's frames, and an account operation's, aren't this card's.
    onEvent?.({
      type: 'connection.update',
      session_id: 'r-other',
      payload: update(3, [target({ state: 'connected' })]),
    })
    onEvent?.({
      type: 'connection.update',
      payload: { ...update(3, [target({ state: 'connected' })]), owner: { type: 'account' } },
    })
    expect(card()?.targets[0].state).toBe('initiated')
    onEvent?.({
      type: 'connection.update',
      session_id: SID,
      payload: update(3, [target({ state: 'connected', resolved: true })]),
    })
    expect(card()?.targets[0].state).toBe('connected')
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['hosted-accounts'] })
  })

  it('comes back with a resumed chat', () => {
    restoreChatConnect(SID, request({ seq: 5 }))
    expect(card()?.seq).toBe(5)
    restoreChatConnect('r-none', null)
    expect(useChatConnects.getState()['r-none']).toBeUndefined()
  })
})

describe('answering a card', () => {
  beforeEach(() => restoreChatConnect(SID, request()))

  it('opens an app’s sign-in in the tab opened in the tap', async () => {
    const tab = { closed: false, close: vi.fn(), location: { replace: vi.fn() } }
    expect(await openChatSignIn(SID, 'slack', tab as never)).toBe(true)
    expect(tab.location.replace).toHaveBeenCalledWith(LINK)
    expect(calls).toEqual([])
  })

  it('makes a new link for one that failed or ran out, on the card’s own operation', async () => {
    useChatConnects.setState({
      [SID]: applyChatFrame(card()!, update(3, [target({ state: 'expired', connect_url: null })])),
    })
    const NEW = 'https://connect.composio.dev/link/lk_2'
    const again: ConnectorsConnectResult = {
      op_id: 'op123',
      seq: 5,
      deadline_at: 1_800_000_300,
      settled: false,
      settled_at: null,
      settled_by: null,
      targets: [target({ connect_url: NEW })],
    }
    routes['connectors.connect'] = () => again
    const tab = { closed: false, close: vi.fn(), location: { replace: vi.fn() } }
    expect(await openChatSignIn(SID, 'slack', tab as never)).toBe(true)
    expect(sent('connectors.connect')).toEqual([{ owner: { type: 'session', session_id: SID }, connectors: ['slack'] }])
    expect(tab.location.replace).toHaveBeenCalledWith(NEW)
  })

  it('closes the tab when there’s nothing to open', async () => {
    const tab = { closed: false, close: vi.fn(), location: { replace: vi.fn() } }
    expect(await openChatSignIn(SID, 'linear', tab as never)).toBe(false)
    expect(tab.close).toHaveBeenCalled()
  })

  it('lets apps go, and says when the person is done', async () => {
    routes['connection.respond'] = () => ({ status: 'ok', settled: false })
    await skipChatConnect(SID, ['slack'])
    await skipChatConnect(SID)
    await finishChatConnect(SID)
    expect(sent('connection.respond')).toEqual([
      {
        owner: { type: 'session', session_id: SID },
        op_id: 'op123',
        result: { targets: [{ name: 'slack', status: 'skipped' }] },
      },
      {
        owner: { type: 'session', session_id: SID },
        op_id: 'op123',
        result: {
          targets: [
            { name: 'slack', status: 'skipped' },
            { name: 'linear', status: 'skipped' },
          ],
        },
      },
      { owner: { type: 'session', session_id: SID }, op_id: 'op123', result: { settled_by: 'continue' } },
    ])
  })
})
