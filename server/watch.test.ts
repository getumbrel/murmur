import { describe, expect, it } from 'vitest'
import { createWatcher, type Moment } from './watch.ts'
import { RpcError } from './socket.ts'

// A Hermes as the watcher sees it: the socket's methods and the REST reads
// it makes, with the shapes Hermes 0.22 answers (tui_gateway/methods_session.py,
// server_requests.py, hosted rooms).

type Row = { id: string; session_key: string; status: string; title?: string; message_count?: number }

function fakeHermes() {
  const state = {
    profiles: [
      { name: 'default', is_default: true },
      { name: 'atlas', is_default: false, display_name: 'Atlas' },
    ] as Record<string, unknown>[],
    live: [] as Row[],
    open: {} as Record<string, { id: string; method: string; params?: Record<string, unknown> }[]>,
    sessions: { default: [], atlas: [] } as Record<string, { id: string; source?: string }[]>,
    messages: {} as Record<string, { role: string; content: string | null; timestamp?: number }[]>,
    runs: { default: [], atlas: [] } as Record<string, { id: string; title?: string; started_at: number; end_reason?: string | null; cron_job_id?: string }[]>,
    jobs: { atlas: [] } as Record<string, { id: string; name?: string; deliver?: unknown }[]>,
    rooms: [] as { room_id: string; name?: string; members: { member_id: string; profile: string; handle: string }[]; latest_seq: number }[],
    logs: {} as Record<string, { seq: number; event_id: string; kind: string; actor: { kind: string; id: string }; payload: Record<string, unknown>; created_at: number }[]>,
    pending: {} as Record<string, { kind: string; task_id: string; request_id?: string; member_id?: string }[]>,
    /** REST reads Hermes doesn't answer. */
    failing: new Set<string>(),
    calls: [] as string[],
  }
  const call = async <T,>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    state.calls.push(params.session_id ? `${method} ${params.session_id}` : method)
    const answer = (value: unknown) => value as T
    switch (method) {
      case 'profiles.list':
        return answer({ profiles: state.profiles })
      case 'session.active_list':
        return answer({ sessions: state.live })
      case 'session.events.since':
        return answer({ events: [], open_requests: state.open[String(params.session_id)] ?? [] })
      case 'session.list':
        return answer({ sessions: state.sessions[String(params.profile)] ?? [] })
      case 'groups.list':
        return answer({ rooms: state.rooms })
      case 'groups.log': {
        const after = (state.logs[String(params.room_id)] ?? []).filter((e) => e.seq > Number(params.since_seq ?? 0))
        return answer({ events: after.slice(0, Number(params.limit ?? 100)) })
      }
      case 'groups.state':
        return answer({ driver_status: { pending_actions: state.pending[String(params.room_id)] ?? [] } })
    }
    throw new RpcError(-32601, `unknown method ${method}`)
  }
  const get = async <T,>(path: string): Promise<T | null> => {
    const url = new URL(path, 'http://hermes')
    if (state.failing.has(url.pathname)) return null
    const profile = url.searchParams.get('profile') ?? ''
    const messages = /^\/api\/sessions\/([^/]+)\/messages$/.exec(url.pathname)
    // Newest first, as order=latest gives them, each with the id Hermes stores it under.
    if (messages) return { messages: (state.messages[decodeURIComponent(messages[1])] ?? []).map((m, i) => ({ id: i + 1, ...m })).reverse() } as T
    if (url.pathname === '/api/sessions' && url.searchParams.get('source') === 'cron') return { sessions: state.runs[profile] ?? [] } as T
    if (url.pathname === '/api/cron/jobs') return (state.jobs[profile] ?? []) as T
    return null
  }
  const told: Moment[] = []
  const watcher = createWatcher({ call, get, tell: (m) => told.push(m), pause: async () => {} })
  return { state, told, watcher }
}

describe('chats', () => {
  it('tells a reply that finished, quoting it under the agent’s name', async () => {
    const { state, told, watcher } = fakeHermes()
    state.sessions.atlas = [{ id: 'c1', source: 'tui' }]
    state.live = [{ id: 'rt1', session_key: 'c1', status: 'working', title: 'Trip' }]
    await watcher.chats()
    expect(watcher.busy()).toBe(true)
    expect(told).toEqual([])

    state.messages.c1 = [
      { role: 'user', content: 'Plan a trip', timestamp: 1 },
      { role: 'assistant', content: '**Booked.** Lisbon, Friday to Sunday.', timestamp: 2 },
    ]
    state.live = [{ id: 'rt1', session_key: 'c1', status: 'idle', title: 'Trip' }]
    await watcher.chats()
    expect(told).toEqual([
      { kind: 'note', note: { title: 'Atlas', body: 'Booked. Lisbon, Friday to Sunday.', tag: 'murmur:chat:c1', href: '/chat/atlas/c1' } },
    ])
    expect(watcher.busy()).toBe(false)
  })

  it('tells a reply whose chat Hermes let go of as soon as it finished', async () => {
    const { state, told, watcher } = fakeHermes()
    state.sessions.default = [{ id: 'c2' }]
    state.live = [{ id: 'rt2', session_key: 'c2', status: 'working' }]
    await watcher.chats()
    state.messages.c2 = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' }]
    state.live = []
    await watcher.chats()
    expect(told).toMatchObject([{ kind: 'note', note: { title: 'Hermes', body: 'Hello!' } }])
  })

  it('says nothing of a turn that never answered (stopped, or failed)', async () => {
    const { state, told, watcher } = fakeHermes()
    state.sessions.atlas = [{ id: 'c3' }]
    state.live = [{ id: 'rt3', session_key: 'c3', status: 'working' }]
    await watcher.chats()
    state.messages.c3 = [{ role: 'user', content: 'go' }]
    state.live = [{ id: 'rt3', session_key: 'c3', status: 'idle' }]
    await watcher.chats()
    expect(told).toEqual([])
  })

  it('never tells a chat that was idle all along', async () => {
    const { state, told, watcher } = fakeHermes()
    state.sessions.atlas = [{ id: 'c4' }]
    state.messages.c4 = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Old news' }]
    state.live = [{ id: 'rt4', session_key: 'c4', status: 'idle' }]
    await watcher.chats()
    await watcher.chats()
    expect(told).toEqual([])
  })

  it('tells a reply that came and went between looks, but not a chat opened again', async () => {
    const { state, told, watcher } = fakeHermes()
    const now = Date.now() / 1000
    state.sessions.atlas = [{ id: 'c7' }, { id: 'c8' }, { id: 'c9' }]
    state.live = [{ id: 'rt7', session_key: 'c7', status: 'idle', message_count: 2 }]
    await watcher.chats()
    // c7 answered again, quickly; c8 is new and already answered; c9 is an old chat opened again.
    state.messages.c7 = [{ role: 'user', content: 'hi', timestamp: now - 600 }, { role: 'assistant', content: 'Hello', timestamp: now - 600 }, { role: 'user', content: 'And?', timestamp: now }, { role: 'assistant', content: 'And done.', timestamp: now }]
    state.messages.c8 = [{ role: 'user', content: 'Quick one', timestamp: now }, { role: 'assistant', content: 'Quick answer.', timestamp: now }]
    state.messages.c9 = [{ role: 'user', content: 'Long ago', timestamp: now - 86400 }, { role: 'assistant', content: 'Old news', timestamp: now - 86400 }]
    state.live = [
      { id: 'rt7', session_key: 'c7', status: 'idle', message_count: 4 },
      { id: 'rt8', session_key: 'c8', status: 'idle', message_count: 2 },
      { id: 'rt9', session_key: 'c9', status: 'idle', message_count: 2 },
    ]
    await watcher.chats()
    expect(told.map((m) => m.kind === 'note' && m.note.body)).toEqual(['And done.', 'Quick answer.'])
    await watcher.chats()
    expect(told).toHaveLength(2)
  })

  it('follows a long chat that Hermes compacts under a new id', async () => {
    const { state, told, watcher } = fakeHermes()
    state.sessions.atlas = [{ id: 'c10' }]
    state.live = [{ id: 'rt10', session_key: 'c10', status: 'working' }]
    await watcher.chats()
    state.sessions.atlas = [{ id: 'c11' }, { id: 'c10' }]
    state.messages.c11 = [{ role: 'user', content: 'Carry on' }, { role: 'assistant', content: 'All caught up.' }]
    state.live = [{ id: 'rt10', session_key: 'c11', status: 'idle' }]
    await watcher.chats()
    expect(told).toEqual([{ kind: 'note', note: { title: 'Atlas', body: 'All caught up.', tag: 'murmur:chat:c11', href: '/chat/atlas/c11' } }])
  })

  it('tells a question once, and that it was answered', async () => {
    const { state, told, watcher } = fakeHermes()
    state.sessions.atlas = [{ id: 'c5' }]
    state.live = [{ id: 'rt5', session_key: 'c5', status: 'waiting' }]
    state.open.rt5 = [{ id: 'srq-1', method: 'clarify', params: { session_id: 'rt5', questions: [{ qid: 'q0', question: 'Which day works?' }] } }]
    await watcher.chats()
    await watcher.chats()
    expect(told).toEqual([
      { kind: 'ask', key: 'srq-1', note: { title: 'Atlas', body: 'Which day works?', tag: 'murmur:chat:c5', href: '/chat/atlas/c5' } },
    ])
    state.open.rt5 = []
    state.live = [{ id: 'rt5', session_key: 'c5', status: 'working' }]
    await watcher.chats()
    expect(told.at(-1)).toEqual({ kind: 'answered', key: 'srq-1' })
  })

  it('tells the next question when one follows another', async () => {
    const { state, told, watcher } = fakeHermes()
    state.sessions.atlas = [{ id: 'c6' }]
    state.live = [{ id: 'rt6', session_key: 'c6', status: 'waiting' }]
    state.open.rt6 = [{ id: 'srq-1', method: 'approval', params: { command: 'rm -rf /tmp/x' } }]
    await watcher.chats()
    state.open.rt6 = [{ id: 'srq-2', method: 'vault.save_login', params: { site: 'example.com' } }]
    await watcher.chats()
    expect(told.map((m) => (m.kind === 'answered' ? `answered ${m.key}` : `${m.kind} ${m.note.body}`))).toEqual([
      'ask Needs your OK',
      'answered srq-1',
      'ask Needs your login for example.com',
    ])
  })

  it('leaves out what Murmur can’t answer, groups’ own chats and routine runs', async () => {
    const { state, told, watcher } = fakeHermes()
    state.sessions.atlas = [{ id: 'c7' }, { id: 'run1', source: 'cron' }]
    state.live = [
      { id: 'rt7', session_key: 'c7', status: 'waiting' },
      { id: 'rt8', session_key: 'room-session', status: 'waiting', title: 'Group: room-1' },
      { id: 'rt9', session_key: 'run1', status: 'working' },
    ]
    state.open.rt7 = [{ id: 'srq-3', method: 'terminal.read', params: {} }]
    state.open.rt8 = [{ id: 'srq-4', method: 'approval', params: {} }]
    await watcher.chats()
    state.messages.run1 = [{ role: 'user', content: 'You are running as a scheduled cron job' }, { role: 'assistant', content: 'Found it' }]
    state.live = []
    await watcher.chats()
    expect(told).toEqual([])
    expect(state.calls).not.toContain('session.events.since rt8')
  })

  it('tells a routine’s run like any chat once the person replies in it', async () => {
    const { state, told, watcher } = fakeHermes()
    state.sessions.atlas = [{ id: 'run2', source: 'cron' }]
    const brief = { role: 'user', content: 'You are running as a scheduled cron job. Check the weather.' }
    state.messages.run2 = [brief, { role: 'assistant', content: 'Rain at 4.' }, { role: 'user', content: 'Clear by 6?' }]
    state.live = [{ id: 'rt12', session_key: 'run2', status: 'waiting' }]
    state.open.rt12 = [{ id: 'srq-5', method: 'clarify', params: { question: 'Which town?' } }]
    await watcher.chats()
    state.open.rt12 = []
    state.messages.run2 = [...state.messages.run2, { role: 'assistant', content: 'Yes, by half five.' }]
    state.live = [{ id: 'rt12', session_key: 'run2', status: 'idle' }]
    await watcher.chats()
    expect(told.map((m) => (m.kind === 'answered' ? `answered ${m.key}` : `${m.kind} ${m.note.body}`))).toEqual([
      'ask Which town?',
      'answered srq-5',
      'note Yes, by half five.',
    ])
  })
})

describe('routines', () => {
  it('tells a run that lands with something to say, under the routine’s name', async () => {
    const { state, told, watcher } = fakeHermes()
    state.runs.atlas = [{ id: 'cron_old', title: 'Brief · Oct 25 08:00', started_at: 100, end_reason: 'cron_complete', cron_job_id: 'j1' }]
    state.jobs.atlas = [{ id: 'j1', name: 'Morning brief', deliver: 'local' }]
    await watcher.runs()
    expect(told).toEqual([])

    state.runs.atlas = [{ id: 'cron_new', title: 'Brief · Oct 26 08:00', started_at: 200, end_reason: 'cron_complete', cron_job_id: 'j1' }, ...state.runs.atlas]
    state.messages.cron_new = [
      { role: 'user', content: 'You are running as a scheduled cron job. Brief me.' },
      { role: 'assistant', content: '## Rain at 4\nTake an umbrella.' },
    ]
    await watcher.runs()
    expect(told).toEqual([{ kind: 'note', note: { title: 'Morning brief', body: 'Rain at 4', tag: 'murmur:chat:cron_new', href: '/chat/atlas/cron_new' } }])
  })

  it('stays quiet for nothing to report, and for results Telegram already has', async () => {
    const { state, told, watcher } = fakeHermes()
    await watcher.runs()
    state.runs.atlas = [
      { id: 'cron_a', started_at: 300, end_reason: 'cron_complete', cron_job_id: 'j1' },
      { id: 'cron_b', started_at: 301, end_reason: 'cron_complete', cron_job_id: 'j2' },
    ]
    state.jobs.atlas = [{ id: 'j1', name: 'Quiet one' }, { id: 'j2', name: 'Sent elsewhere', deliver: 'telegram' }]
    state.messages.cron_a = [{ role: 'assistant', content: '[SILENT]' }]
    state.messages.cron_b = [{ role: 'assistant', content: 'News!' }]
    await watcher.runs()
    expect(told).toEqual([])
  })

  it('tries a run again when Hermes didn’t answer about it', async () => {
    const { state, told, watcher } = fakeHermes()
    await watcher.runs()
    state.runs.atlas = [{ id: 'cron_c', started_at: 400, end_reason: 'cron_complete', cron_job_id: 'j1' }]
    state.jobs.atlas = [{ id: 'j1', name: 'Flight watch' }]
    state.messages.cron_c = [{ role: 'assistant', content: 'Your flight moved to 14:10.' }]
    state.failing.add('/api/sessions/cron_c/messages')
    await watcher.runs()
    expect(told).toEqual([])
    state.failing.clear()
    await watcher.runs()
    await watcher.runs()
    expect(told).toMatchObject([{ kind: 'note', note: { title: 'Flight watch', body: 'Your flight moved to 14:10.' } }])
  })
})

describe('groups', () => {
  const at = Date.now() / 1000
  const ev = (seq: number, kind: string, payload: Record<string, unknown> = {}) => ({
    seq,
    event_id: `e${seq}`,
    kind,
    actor: { kind: 'member', id: String(payload.member_id ?? 'you') },
    payload,
    created_at: at,
  })

  it('tells a round that ended with the last word from its agents', async () => {
    const { state, told, watcher } = fakeHermes()
    state.rooms = [{ room_id: 'room-1', name: 'Trip', members: [{ member_id: 'm1', profile: 'atlas', handle: 'atlas' }, { member_id: 'm2', profile: 'default', handle: 'hermes' }], latest_seq: 1 }]
    state.logs['room-1'] = [ev(1, 'message.user', { text: '@atlas thoughts?' })]
    await watcher.groups()
    expect(watcher.rounds()).toBe(true)

    state.pending['room-1'] = [{ kind: 'approval', task_id: 't1', request_id: 'apr-1', member_id: 'm1' }]
    await watcher.groups()
    expect(told).toEqual([{ kind: 'ask', key: 'group:room-1:apr-1', note: { title: 'Trip', body: 'Atlas needs your OK', tag: 'murmur:group:room-1', href: '/group/room-1' } }])

    state.pending['room-1'] = []
    state.rooms[0].latest_seq = 3
    state.logs['room-1'] = [...state.logs['room-1'], ev(2, 'message.member', { member_id: 'm1', text: 'Lisbon, @hermes?' }), ev(3, 'room.activity')]
    await watcher.groups()
    expect(told.slice(1)).toEqual([
      { kind: 'answered', key: 'group:room-1:apr-1' },
      { kind: 'note', note: { title: 'Trip', body: 'Atlas: Lisbon, @Hermes?', tag: 'murmur:group:room-1', href: '/group/room-1' } },
    ])
    expect(watcher.rounds()).toBe(false)
  })

  it('follows a round longer than its last few messages until it ends', async () => {
    const { state, told, watcher } = fakeHermes()
    state.rooms = [{ room_id: 'room-2', name: 'Debate', members: [{ member_id: 'm1', profile: 'atlas', handle: 'atlas' }, { member_id: 'm2', profile: 'default', handle: 'hermes' }], latest_seq: 1 }]
    state.logs['room-2'] = [ev(1, 'message.user', { text: '@atlas @hermes trains or planes?' })]
    await watcher.groups()
    for (let seq = 2; seq <= 30; seq++) state.logs['room-2'].push(ev(seq, 'message.member', { member_id: seq % 2 ? 'm1' : 'm2', text: `Point ${seq}` }))
    state.rooms[0].latest_seq = 30
    await watcher.groups()
    expect(watcher.rounds()).toBe(true)
    expect(told).toEqual([])

    state.logs['room-2'].push(ev(31, 'room.activity'))
    state.rooms[0].latest_seq = 31
    await watcher.groups()
    expect(told).toEqual([{ kind: 'note', note: { title: 'Debate', body: 'Hermes: Point 30', tag: 'murmur:group:room-2', href: '/group/room-2' } }])
  })

  it('needs no groups at all on a Hermes from before them', async () => {
    const { state, watcher } = fakeHermes()
    state.rooms = undefined as never
    await expect(watcher.groups()).resolves.toBeUndefined()
  })
})
