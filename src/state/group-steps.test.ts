import { describe, expect, it, vi } from 'vitest'

// A group's steps, read from each agent's copy of the room the way Hermes
// 0.23 keeps it: every turn opens with the request Hermes handed the agent,
// named for the room's task, and the agent's message in the room's log names
// the same task.

const get = vi.fn()
const rpc = vi.fn()
vi.mock('@/hermes/rest', () => ({
  api: { get: (path: string) => get(path) },
  hermesHeaders: () => ({}),
  HermesError: class extends Error {},
}))
vi.mock('@/hermes/gateway', () => ({
  gateway: { onEvent: () => {}, onRequest: () => {}, onState: () => {} },
  rpc: (method: string, params: unknown) => rpc(method, params),
  useConnection: Object.assign(() => undefined, { getState: () => ({ state: 'open' }) }),
  whenOpen: async () => {},
}))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.stubGlobal('document', { cookie: '', addEventListener: () => {}, visibilityState: 'visible' })
vi.stubGlobal('window', { addEventListener: () => {}, setTimeout })
vi.stubGlobal('addEventListener', () => {})
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })

const { joinSteps, readTurns, taskOf, turnsIn } = await import('./group-steps')
const { prefetchGroup, useGroupLive } = await import('./groups')

const ROOM = 'murmur-room'
const named = (task: string, attempt = 1) =>
  `hosted:${JSON.stringify([{ room_id: ROOM, task_id: task, thread_id: 'main', turn_id: `turn-${task}` }, attempt])}`

// Rows as Hermes 0.23.1 serves an agent's copy (GET /api/sessions/{id}/messages).
const request = (id: number, task: string) => ({
  id,
  role: 'user',
  content: '[Discussion: "Trip"] You are @alpha, one participant with @beta and the user.',
  display_metadata: { submission_id: named(task) },
  timestamp: id,
})
const call = (id: number, callId: string, url: string) => ({
  id,
  role: 'assistant',
  content: '',
  tool_calls: [
    {
      id: callId,
      call_id: callId,
      type: 'function',
      function: { name: 'browser_navigate', arguments: JSON.stringify({ url }) },
    },
  ],
  timestamp: id,
})
const result = (id: number, callId: string) => ({
  id,
  role: 'tool',
  content: '{"success": true}',
  tool_call_id: callId,
  tool_name: 'browser_navigate',
  timestamp: id,
})
const said = (id: number, text: string) => ({ id, role: 'assistant', content: text, timestamp: id })

const ids = (steps: { id: string; status: string }[] = []) => steps.map((s) => `${s.id} ${s.status}`)

describe('reading a turn from an agent’s copy', () => {
  it('knows the room task a request runs, and only from a request Hermes named', () => {
    expect(taskOf(request(1, 'dtask:a'))).toBe('dtask:a')
    expect(taskOf({ role: 'user', content: 'hi', display_metadata: { submission_id: 'tui-123' } })).toBeUndefined()
    expect(taskOf({ role: 'user', content: 'hi', display_metadata: { submission_id: 'hosted:{oops' } })).toBeUndefined()
    expect(
      taskOf({ role: 'assistant', content: '', display_metadata: { submission_id: named('dtask:a') } }),
    ).toBeUndefined()
  })

  it('gives each turn its own steps, named for their calls as the live stream names them', () => {
    const turns = turnsIn([
      request(1, 'dtask:a'),
      said(2, 'Hello!'),
      request(3, 'dtask:b'),
      call(4, 'call_1', 'https://example.com/flights'),
      result(5, 'call_1'),
      call(6, 'call_2', 'https://example.com/hotels'),
      said(7, 'Found one.'),
    ])
    expect(turns.map((t) => [t.task, t.whole, ids(t.steps)])).toEqual([
      ['dtask:a', true, []],
      ['dtask:b', true, ['tool-call_1 done', 'tool-call_2 running']],
    ])
    expect(turns[1].steps[0]).toMatchObject({ callId: 'call_1', page: 'https://example.com/flights' })
  })

  it('reads rows before the first request as the end of the turn the agent was on, when it knows which', () => {
    const tail = [result(5, 'call_1'), call(6, 'call_2', 'https://example.com/b')]
    expect(turnsIn(tail)).toEqual([])
    expect(turnsIn(tail, 'dtask:b').map((t) => [t.task, t.whole, ids(t.steps)])).toEqual([
      ['dtask:b', false, ['tool-call_2 running']],
    ])
  })

  it('joins a turn read in part to what was known of it', () => {
    const [a, b] = turnsIn([request(1, 't'), call(2, 'x', 'https://a.com'), call(3, 'y', 'https://b.com')])[0].steps
    const done = { ...a, status: 'done' as const }
    expect(ids(joinSteps([a], [done, b]))).toEqual(['tool-x done', 'tool-y running'])
    expect(ids(joinSteps([a, b], [done]))).toEqual(['tool-x done', 'tool-y running'])
  })

  it('reads back a page at a time until the turns it wants start, and no further', async () => {
    rpc.mockImplementation(async (method: string) =>
      method === 'session.list' ? { sessions: [{ id: 'copy-1', title: `Group: ${ROOM}` }] } : {},
    )
    const rows = [
      request(1, 'dtask:a'),
      call(2, 'call_1', 'https://a.com'),
      result(3, 'call_1'),
      said(4, 'A'),
      request(5, 'dtask:b'),
      said(6, 'B'),
    ]
    get.mockImplementation(async (path: string) => {
      const offset = Number(/offset=(\d+)/.exec(path)?.[1] ?? 0)
      const limit = Number(/limit=(\d+)/.exec(path)?.[1])
      expect(path).toContain('inline_images=false')
      return { messages: rows.slice(Math.max(0, rows.length - offset - limit), rows.length - offset) }
    })
    const read = await readTurns(ROOM, 'alpha', { wanted: ['dtask:a'], page: 2 })
    expect(read?.turns.map((t) => [t.task, ids(t.steps)])).toEqual([
      ['dtask:a', ['tool-call_1 done']],
      ['dtask:b', []],
    ])
    // Three pages of two: back to the first request, and no further.
    expect(get).toHaveBeenCalledTimes(3)
  })

  it('leaves alone a copy whose requests aren’t named (an older Hermes)', async () => {
    rpc.mockImplementation(async (method: string) =>
      method === 'session.list' ? { sessions: [{ id: 'copy-2', title: 'Group: old-room' }] } : {},
    )
    get.mockResolvedValue({ messages: [{ id: 1, role: 'user', content: 'Hi' }, said(2, 'Hello')] })
    expect(await readTurns('old-room', 'alpha', { wanted: ['dtask:x'] })).toEqual({ turns: [], unnamed: true })
  })

  it('has nothing to read before the agent has a copy', async () => {
    rpc.mockImplementation(async () => ({ sessions: [] }))
    expect(await readTurns('new-room', 'alpha', {})).toBeUndefined()
  })
})

describe('a group showing its agents’ steps', () => {
  const room = {
    room_id: 'g1',
    name: 'Trip',
    members: [
      { member_id: 'alpha', profile: 'alpha', handle: 'alpha' },
      { member_id: 'beta', profile: 'beta', handle: 'beta' },
    ],
    created_at: 1,
    updated_at: 1,
  }
  const ev = (seq: number, kind: string, payload: Record<string, unknown> = {}, actor = 'alpha') => ({
    seq,
    event_id: `e${seq}`,
    kind,
    actor: { kind: 'member', id: actor },
    payload: { thread_id: 'main', ...payload },
    created_at: Date.now() / 1000,
  })

  let log: ReturnType<typeof ev>[] = []
  let driver: Record<string, unknown> = {}
  let copy: Record<string, unknown>[] = []
  const reload = () => {
    useGroupLive.setState((s) => ({ rooms: { ...s.rooms, g1: { ...s.rooms.g1, loaded: false } } }))
    prefetchGroup('g1')
  }

  it('shows the steps an agent is taking while it takes them, and keeps them with its words', async () => {
    rpc.mockImplementation(async (method: string, params: { profile?: string }) => {
      if (method === 'groups.state') return { room, driver_status: driver }
      if (method === 'groups.log') return { events: log, cursor: log.at(-1)?.seq ?? 0 }
      if (method === 'session.list')
        return params.profile === 'alpha'
          ? { sessions: [{ id: 'alpha-copy', title: `Group: ${room.room_id}` }] }
          : { sessions: [] }
      return {}
    })
    get.mockImplementation(async () => ({ messages: copy }))

    // Alpha is at work: one step done, one under way.
    log = [ev(1, 'message.user', { text: '@alpha find flights' }, 'desktop')]
    driver = { working: true, member_activity: [{ member_id: 'alpha', status: 'running' }] }
    copy = [
      request(10, 'dtask:1'),
      call(11, 'call_a', 'https://a.com'),
      result(12, 'call_a'),
      call(13, 'call_b', 'https://b.com'),
    ]
    prefetchGroup('g1')
    await vi.waitFor(() => expect(useGroupLive.getState().rooms.g1?.streams.alpha).toBeDefined())
    const stream = useGroupLive.getState().rooms.g1.streams.alpha
    expect(stream.task).toBe('dtask:1')
    expect(ids(stream.tools)).toEqual(['tool-call_a done', 'tool-call_b running'])

    // Its words land in the log: the steps stay with them, finished.
    log = [
      ...log,
      ev(2, 'message.member', { task_id: 'dtask:1', member_id: 'alpha', text: 'Found two.' }),
      ev(3, 'turn.settled', { task_id: 'dtask:1', member_id: 'alpha' }),
    ]
    driver = { working: false }
    copy = [...copy, result(14, 'call_b'), said(15, 'Found two.')]
    reload()
    await vi.waitFor(() =>
      expect(ids(useGroupLive.getState().rooms.g1.steps['dtask:1'])).toEqual(['tool-call_a done', 'tool-call_b done']),
    )
    const live = useGroupLive.getState().rooms.g1
    expect(live.streams.alpha).toBeUndefined()
    // The message keeps the place the turn being written had, so nothing redraws.
    expect(live.aliases.e2).toBe(`${stream.id}-a`)
  })

  it('finds each message’s steps after a reload, by the task both name', async () => {
    room.room_id = 'g2'
    log = [
      ev(1, 'message.user', { text: 'Everyone: plan it' }, 'desktop'),
      ev(2, 'message.member', { task_id: 'dtask:9', member_id: 'alpha', text: 'Booked.' }),
      ev(3, 'message.member', { task_id: 'dtask:10', member_id: 'beta', text: 'Nice.' }, 'beta'),
    ]
    driver = { working: false }
    copy = [request(20, 'dtask:9'), call(21, 'call_z', 'https://z.com'), result(22, 'call_z'), said(23, 'Booked.')]
    prefetchGroup('g2')
    await vi.waitFor(() =>
      expect(ids(useGroupLive.getState().rooms.g2?.steps['dtask:9'])).toEqual(['tool-call_z done']),
    )
    // Beta has no copy here (it's on another Hermes): its message just has no steps.
    expect(useGroupLive.getState().rooms.g2.steps['dtask:10']).toBeUndefined()
  })

  it('opens with its steps in place, not a moment after the words', async () => {
    room.room_id = 'g3'
    let release = () => {}
    const slow = new Promise<void>((r) => (release = r))
    get.mockImplementation(async () => {
      await slow
      return { messages: copy }
    })
    prefetchGroup('g3')
    await vi.waitFor(() => expect(useGroupLive.getState().rooms.g3?.loaded).toBe(true))
    // Its words are in, its steps aren't yet: it waits.
    expect(useGroupLive.getState().rooms.g3.opening).toBe(true)
    release()
    await vi.waitFor(() => expect(useGroupLive.getState().rooms.g3.opening).toBe(false))
    expect(ids(useGroupLive.getState().rooms.g3.steps['dtask:9'])).toEqual(['tool-call_z done'])
  })
})
