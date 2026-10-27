// Murmur's server notices what agents do by itself, so a notification reaches
// a phone with every tab closed (server/watch.ts). What it reads from Hermes
// to notice is checked here against a real one, with the watcher itself on
// the server's own socket (server/socket.ts): a reply that finishes after the
// app has gone, a question left waiting (and still answerable once the person
// is back), a routine's news, and a group's round ending or waiting on an OK.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openSocket, type HermesSocket } from '../../server/socket.ts'
import { createWatcher, type Moment } from '../../server/watch.ts'
import { agentName, api, connect, MURMUR, newChat, q, sleep, turn, type Socket } from './client'
import { toolsTag } from './fake-model'

const agent = agentName('notify')
const p = q(agent)

let watching: Socket
let server: HermesSocket
let moments: Moment[] = []

beforeAll(async () => {
  watching = await connect()
  await watching.request('profiles.create', { name: agent, share_auth: true }, 120_000)
  await new Promise<void>((open) => {
    server = openSocket({ socketUrl: async () => new URL('/hermes/api/ws', MURMUR.replace(/^http/, 'ws')) }, { onOpen: open })
  })
})
afterAll(async () => {
  await api.call('DELETE', `/api/profiles/${agent}`)
  watching?.close()
  server?.close()
})

/** A watcher like the server's, with what it tells kept in `moments`. */
function watcher() {
  moments = []
  return createWatcher({
    call: server.call,
    get: (path) => api.get(path).catch(() => null),
    tell: (moment) => void moments.push(moment),
  })
}

/** Looks again every 300ms until `find` finds what was told. */
async function until<T>(look: () => Promise<void>, find: () => T | undefined, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await look()
    const found = find()
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`Not told in time; told: ${JSON.stringify(moments)}`)
    await sleep(300)
  }
}

const told = <K extends Moment['kind']>(kind: K, tag?: string) =>
  moments.find((m): m is Extract<Moment, { kind: K }> => m.kind === kind && (!tag || ('note' in m && m.note.tag === tag)))

describe('a chat', () => {
  it('is heard finishing after the app has gone', async () => {
    const watch = watcher()
    await watch.chats()
    const app = await connect()
    const { runtime, stored } = await newChat(app)
    await app.request('prompt.submit', { session_id: runtime, text: '[[slow: 150]] [[say: Booked a table for two at eight.]]', profile: 'default' })
    await watch.chats()
    expect(watch.busy()).toBe(true)
    // The person closes the app mid-reply; Hermes carries on.
    app.close()

    const { note } = await until(watch.chats, () => told('note', `murmur:chat:${stored}`))
    expect(note).toEqual({ title: 'Hermes', body: 'Booked a table for two at eight.', tag: `murmur:chat:${stored}`, href: `/chat/default/${stored}` })
    expect(watch.busy()).toBe(false)
  })

  it('is heard finishing between looks, but not for a chat opened again', async () => {
    const watch = watcher()
    await watch.chats()
    const app = await connect()
    const { runtime, stored } = await newChat(app)
    await turn(app, runtime, '[[say: That was quick.]]')
    app.close()
    const { note } = await until(watch.chats, () => told('note', `murmur:chat:${stored}`))
    expect(note.body).toBe('That was quick.')

    // Once nobody has had it open for a while, Hermes lets the chat go; opened again, it's back in the list.
    for (const deadline = Date.now() + 60_000; ; await sleep(1000)) {
      const { sessions } = await server.call<{ sessions: { id: string }[] }>('session.active_list')
      if (!sessions.some((s) => s.id === runtime)) break
      if (Date.now() > deadline) throw new Error('Hermes kept the chat')
    }
    await watch.chats()
    const back = await connect()
    const resumed = await back.request<{ session_id: string }>('session.resume', { session_id: stored, profile: 'default', source: 'desktop', omit_messages: true, lazy: true })
    expect(resumed.session_id).not.toBe(runtime)
    await watch.chats()
    expect(moments).toHaveLength(1)
    back.close()
  })

  it('is heard asking once the app has gone, and answered when the person is back', async () => {
    const watch = watcher()
    await watch.chats()
    const app = await connect()
    const { runtime, stored } = await newChat(app)
    // A first step that takes a moment, so the question comes once nobody's there to see it.
    const steps = toolsTag([
      { name: 'terminal', args: { command: 'sleep 2' } },
      { name: 'terminal', args: { command: 'rm -rf /opt/data/contract-notify' } },
    ])
    await app.request('prompt.submit', { session_id: runtime, text: `Tidy up ${steps}`, profile: 'default' })
    app.close()

    const ask = await until(watch.chats, () => told('ask', `murmur:chat:${stored}`))
    expect(ask).toEqual({
      kind: 'ask',
      key: expect.stringMatching(/^srq-/),
      note: { title: 'Hermes', body: 'Needs your OK', tag: `murmur:chat:${stored}`, href: `/chat/default/${stored}` },
    })
    // Looked at again, it's the same question: told once.
    await watch.chats()
    expect(moments.filter((m) => m.kind === 'ask')).toHaveLength(1)

    // The person opens the chat the way the app does, and answers the question still waiting.
    const back = await connect((r) => (r.method === 'approval' ? { choice: 'deny' } : undefined))
    await back.request('session.resume', { session_id: stored, profile: 'default', source: 'desktop', omit_messages: true, lazy: true })
    expect((await back.serverRequest('approval')).id).toBe(ask.key)
    expect(await until(watch.chats, () => told('answered'))).toEqual({ kind: 'answered', key: ask.key })
    back.close()
  })
})

describe('a routine', () => {
  const job = (id: string, action = '') => `/api/cron/jobs/${id}${action ? `/${action}` : ''}?${p}`

  async function create(name: string, prompt: string) {
    const made = await api.post<{ id: string }>(`/api/cron/jobs?${p}`, { name, prompt, schedule: 'every 1h', deliver: 'local' })
    await api.put(job(made.id), { updates: { murmur_template: 'custom' } })
    return made
  }

  it('is heard when a run finds something, and not when it’s quiet', async () => {
    const watch = watcher()
    await watch.runs()
    const news = await create('Flight watch', 'Check my flight [[say: Your flight to Lisbon moved to 14:10]]')
    const quiet = await create('Inbox sweep', 'Anything new? [[silent]]')
    await api.post(job(quiet.id, 'trigger'))
    await api.post(job(news.id, 'trigger'))
    const { note } = await until(watch.runs, () => told('note'))
    const [run] = (await api.get<{ runs: { id: string }[] }>(`${job(news.id, 'runs')}&limit=1`)).runs
    expect(note).toEqual({ title: 'Flight watch', body: 'Your flight to Lisbon moved to 14:10', tag: `murmur:chat:${run.id}`, href: `/chat/${agent}/${run.id}` })
    await watch.runs()
    expect(moments).toHaveLength(1)
  })

  it('is heard like any chat once the person replies in a run', async () => {
    const watch = watcher()
    await watch.runs()
    await watch.chats()
    const weather = await create('Weather', 'Check the weather [[say: Rain at 4.]]')
    await api.post(job(weather.id, 'trigger'))
    const { note } = await until(watch.runs, () => told('note'))
    const run = note.tag.replace('murmur:chat:', '')

    // The person opens the run and asks a follow-up, the way the app does, then closes it.
    moments = []
    const app = await connect()
    const { session_id } = await app.request<{ session_id: string }>('session.resume', { session_id: run, profile: agent, source: 'desktop', omit_messages: true, lazy: true })
    await app.request('prompt.submit', { session_id, text: 'Clear by six? [[slow: 150]] [[say: Yes, by half five.]]', profile: agent })
    app.close()
    const reply = await until(watch.chats, () => told('note', `murmur:chat:${run}`))
    expect(reply.note).toMatchObject({ body: 'Yes, by half five.', href: `/chat/${agent}/${run}` })
  })
})

describe('a group', () => {
  const room = `murmur-notify-${Date.now().toString(36)}`

  afterAll(() => watching.request('groups.disband', { room_id: room }).catch(() => {}))

  it('is heard when a round ends, with who said what last', async () => {
    await watching.request('groups.create', {
      room_id: room,
      name: 'Dinner plans',
      members: [
        { member_id: 'default', profile: 'default', handle: 'hermes', display_name: 'Hermes' },
        { member_id: agent, profile: agent, handle: 'scout', display_name: 'Scout' },
      ],
    })
    const watch = watcher()
    await watch.groups()
    await watching.request('groups.send', {
      room_id: room,
      event_id: 'notify-1',
      payload: { text: '@hermes where shall we eat? [[slow: 150]] [[say: Somewhere with a garden, I think.]]', thread_id: 'main' },
    })
    await until(watch.groups, () => (watch.rounds() ? true : undefined))
    const { note } = await until(watch.groups, () => told('note'), 90_000)
    expect(note).toEqual({ title: 'Dinner plans', body: 'Hermes: Somewhere with a garden, I think.', tag: `murmur:group:${room}`, href: `/group/${room}` })
  })

  it('is heard when one of its agents needs an OK, and answered when it’s given', async () => {
    const watch = watcher()
    await watch.groups()
    await watching.request('groups.send', {
      room_id: room,
      event_id: 'notify-2',
      payload: { text: '@hermes tidy up [[tool: terminal {"command":"rm -rf /opt/data/contract-notify"}]]', thread_id: 'main' },
    })
    const ask = await until(watch.groups, () => told('ask', `murmur:group:${room}`), 90_000)
    expect(ask).toEqual({
      kind: 'ask',
      key: expect.stringMatching(new RegExp(`^group:${room}:.+`)),
      note: { title: 'Dinner plans', body: 'Hermes needs your OK', tag: `murmur:group:${room}`, href: `/group/${room}` },
    })

    // Answered the way the app answers it (approveInGroup in src/state/groups.ts).
    type Action = { kind: string; member_id: string; task_id?: string; execution_generation?: number; request_id?: string; approval?: { request_id?: string } }
    const { driver_status } = await watching.request<{ driver_status: { pending_actions: Action[] } }>('groups.state', { room_id: room })
    const action = driver_status.pending_actions.find((a) => a.kind === 'approval')!
    await watching.request('groups.approve', {
      room_id: room,
      member_id: action.member_id,
      task_id: action.task_id,
      execution_generation: action.execution_generation,
      choice: 'deny',
      request_id: action.request_id ?? action.approval?.request_id,
    })
    expect(await until(watch.groups, () => told('answered'))).toEqual({ kind: 'answered', key: ask.key })
  })
})
