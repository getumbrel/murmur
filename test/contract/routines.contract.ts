// Routines are Hermes's scheduled jobs, and every run is a chat Hermes keeps
// (src/state/routines.ts, src/features/routines/). Murmur reads whose a run
// is, and its title, brief and answer to tell results from quiet runs, so
// those are checked here against real runs, with Murmur's own readers.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import {
  along,
  failingOf,
  failureIn,
  findingIn,
  findingsOf,
  isQuiet,
  isRunBrief,
  madeRoutine,
  reportsTo,
  runTitle,
  toldIn,
} from '@shared/routines.ts'
import { parseSchedule, toSchedule, WEEKDAYS, type When } from '@/features/routines/schedule'
import { startGateway } from '@/state/hermes-gateway'
import { fetchRoutineRuns, fetchRunResult, runOf } from '@/state/routines'
import { placeLastChats, toAgent, type Profile } from '@/state/agents'
import { parseUserMessage } from '@/features/media/parse'
import { agentName, api, connect, modelRequests, newChat, q, removeAgent, sleep, turn, type Socket } from './client'
import { toolsTag } from './fake-model'

const agent = agentName('routines')
const p = q(agent)
const job = (id: string, action = '') => `/api/cron/jobs/${id}${action ? `/${action}` : ''}?${p}`

type Job = { id: string; name: string; prompt: string; state: string; enabled: boolean; schedule: { kind: string; display: string }; next_run_at: string | null; last_status: string | null; deliver: string; murmur_template?: string }
type Run = { id: string; title: string; source: string; started_at: number; ended_at: number | null; end_reason: string | null; last_active: number; is_active: boolean; message_count: number }
type Message = { id: number; role: string; content: string | null; timestamp: number }

let socket: Socket
beforeAll(async () => {
  socket = await connect()
  await socket.request('profiles.create', { name: agent, share_auth: true }, 120_000)
})
afterAll(async () => {
  await removeAgent(agent)
  socket?.close()
})

/** What Murmur sends for a routine made from a plain request (src/state/routines.ts). */
async function create(name: string, prompt: string, schedule = 'every 1h') {
  const made = await api.post<Job>(`/api/cron/jobs?${p}`, { name, prompt, schedule, deliver: 'local' })
  await api.put(job(made.id), { updates: { murmur_template: 'custom' } })
  return made
}

/** Runs it now. Hermes answers once the run is over. */
const trigger = (id: string) => api.post<Job>(job(id, 'trigger'))
const runs = async (id: string) => (await api.get<{ runs: Run[] }>(`${job(id, 'runs')}&limit=50`)).runs
const messages = async (session: string, limit = 20) =>
  (await api.get<{ messages: Message[] }>(`/api/sessions/${session}/messages?${p}&order=latest&limit=${limit}`)).messages

describe('making routines', () => {
  it('offers blueprints with the fields the sheet draws', async () => {
    const { blueprints } = await api.get(`/api/cron/blueprints?${p}`)
    expect(blueprints.length).toBeGreaterThan(0)
    for (const b of blueprints) {
      expect(b).toMatchObject({ key: expect.any(String), title: expect.any(String), description: expect.any(String), category: expect.any(String), schedule: expect.any(String), scheduleHuman: expect.any(String) })
      for (const f of b.fields) {
        expect(['time', 'enum', 'text', 'weekdays']).toContain(f.type)
        expect(f).toMatchObject({ name: expect.any(String), label: expect.any(String) })
      }
    }
  })

  it('makes one from a blueprint', async () => {
    const { blueprints } = await api.get(`/api/cron/blueprints?${p}`)
    const blueprint = blueprints.find((b: { fields: { optional?: boolean; default?: string }[] }) => b.fields.every((f) => f.optional || f.default !== undefined))
    const values = Object.fromEntries(blueprint.fields.filter((f: { default?: string }) => f.default !== undefined).map((f: { name: string; default: string }) => [f.name, f.default]))
    const made = await api.post(`/api/cron/blueprints/instantiate?${p}`, { blueprint: blueprint.key, values })
    const id = made.id ?? made.job?.id
    expect(id).toEqual(expect.any(String))
    await api.delete(job(id))
  })

  it('lists where results can go', async () => {
    const { targets } = await api.get(`/api/cron/delivery-targets?${p}`)
    expect(Array.isArray(targets)).toBe(true)
    for (const t of targets) expect(t.id).toEqual(expect.any(String))
  })

  it('reads back every schedule Murmur writes as the same schedule', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000)
    tomorrow.setHours(9, 30, 0, 0)
    const whens: When[] = [
      { kind: 'time', hour: 8, minute: 0, days: [0, 1, 2, 3, 4, 5, 6] },
      { kind: 'time', hour: 7, minute: 45, days: WEEKDAYS },
      { kind: 'time', hour: 18, minute: 5, days: [0, 6] },
      { kind: 'every', minutes: 120 },
      { kind: 'every', minutes: 30 },
      { kind: 'every', minutes: 120, from: 9, to: 17, days: WEEKDAYS },
      { kind: 'once', at: tomorrow.getTime() },
    ]
    for (const when of whens) {
      const made = await api.post<Job & { schedule: Parameters<typeof parseSchedule>[0] }>(`/api/cron/jobs?${p}`, { name: 'Schedule', prompt: 'x', schedule: toSchedule(when), deliver: 'local' })
      expect(parseSchedule(made.schedule), toSchedule(when)).toEqual(when)
      expect(made.schedule!.display).toEqual(expect.any(String))
      await api.delete(job(made.id))
    }
  })

  it('keeps Murmur’s own fields, and takes a pinned next run', async () => {
    const made = await create('Pinned', 'x', '0 8 * * *')
    const next = new Date(Date.now() + 3 * 86_400_000)
    next.setUTCHours(8, 0, 0, 0)
    await api.put(job(made.id), { updates: { next_run_at: next.toISOString(), name: 'Renamed' } })
    const listed = (await api.get<Job[]>(`/api/cron/jobs?${p}`)).find((j) => j.id === made.id)!
    expect(listed).toMatchObject({ name: 'Renamed', murmur_template: 'custom', deliver: 'local', enabled: true, state: 'scheduled' })
    expect(Date.parse(listed.next_run_at!)).toBe(next.getTime())
    await api.delete(job(made.id))
  })

  it('pauses and resumes', async () => {
    const made = await create('Pausing', 'x')
    expect(await api.post(job(made.id, 'pause'))).toMatchObject({ state: 'paused' })
    let listed = (await api.get<Job[]>(`/api/cron/jobs?${p}`)).find((j) => j.id === made.id)!
    expect(listed.state === 'paused' || listed.enabled === false).toBe(true)
    await api.post(job(made.id, 'resume'))
    listed = (await api.get<Job[]>(`/api/cron/jobs?${p}`)).find((j) => j.id === made.id)!
    expect(listed).toMatchObject({ state: 'scheduled', enabled: true })
    await api.delete(job(made.id))
    expect((await api.get<Job[]>(`/api/cron/jobs?${p}`)).map((j) => j.id)).not.toContain(made.id)
  })
})

describe('a run', () => {
  let chatty: Job
  let first: Run
  let second: Run

  beforeAll(async () => {
    chatty = await create('Flight watch', 'Check my flight [[say: Your flight to Lisbon moved to 14:10]]')
    expect(await trigger(chatty.id)).toMatchObject({ last_status: 'ok' })
    // Up to Hermes 0.22.2 a run is named to the second, and two that start in the same second share one chat.
    await sleep(1100)
    await trigger(chatty.id)
    ;[second, first] = await runs(chatty.id)
  })

  it('is a chat named after the routine and the time it ran, which says whose it is', async () => {
    for (const run of [first, second]) {
      expect(run.source).toBe('cron')
      expect(runTitle(run.title)).toBe('Flight watch')
      // Up to Hermes 0.22.2 its id says (`cron_<routine>_<when>`); after that, its own row.
      const row = await api.get<Run & { cron_job_id?: string }>(`/api/sessions/${run.id}?${p}`)
      expect(row.source).toBe('cron')
      if (!run.id.startsWith('cron_')) expect(row.cron_job_id).toBe(chatty.id)
      expect(await runOf(agent, run.id)).toEqual({ routineId: chatty.id })
    }
    expect(first.title).toMatch(/^Flight watch · [A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2}$/)
    // Two runs in one minute: the second title is taken, so Hermes numbers it.
    if (second.title.startsWith(first.title)) expect(second.title).toBe(`${first.title} #2`)
  })

  it('is finished, with the row fields the run list reads', () => {
    expect(first).toMatchObject({ end_reason: 'cron_complete', is_active: false, message_count: 2, started_at: expect.any(Number), ended_at: expect.any(Number), last_active: expect.any(Number) })
  })

  it('opens with Hermes’s brief, then the answer', async () => {
    const [brief, answer] = [...(await messages(first.id))].sort((a, b) => a.id - b.id)
    expect(brief.role).toBe('user')
    expect(isRunBrief(brief.content!)).toBe(true)
    expect(brief.content).toContain('Check my flight')
    expect(answer).toMatchObject({ role: 'assistant', content: 'Your flight to Lisbon moved to 14:10' })
    expect(isQuiet(answer.content!)).toBe(false)
  })

  it('reads newest first with order=latest, so limit=1 is the answer', async () => {
    expect((await messages(first.id, 1)).map((m) => m.content)).toEqual(['Your flight to Lisbon moved to 14:10'])
  })

  it('is listed among the agent’s cron sessions, and kept out of search', async () => {
    const { sessions } = await api.get<{ sessions: Run[] }>(`/api/sessions?${p}&source=cron&order=recent&limit=100`)
    expect(sessions.map((s) => s.id)).toEqual(expect.arrayContaining([first.id, second.id]))
    expect(sessions.find((s) => s.id === first.id)).toMatchObject({ end_reason: 'cron_complete', is_active: false, message_count: 2, last_active: expect.any(Number) })

    // The chat list leaves runs out by their source.
    const { sessions: chats } = await socket.request<{ sessions: { id: string; source: string }[] }>('session.list', { profile: agent, limit: 100 })
    for (const s of chats.filter((c) => c.id === first.id || c.id === second.id)) expect(s.source).toBe('cron')

    const { results } = await api.get(`/api/sessions/search?q=Lisbon&${p}&limit=15&exclude_sources=cron,bot_room`)
    expect(results.map((r: { session_id?: string; id?: string }) => r.session_id ?? r.id)).not.toContain(first.id)
  })

  it('shows on the agent as its newest chat, with an 80-character preview', async () => {
    const { profiles } = await socket.request('profiles.list', { include_sessions: true })
    const row = profiles.find((r: { name: string }) => r.name === agent)
    expect(row.last_session).toMatchObject({ id: second.id, preview: 'Your flight to Lisbon moved to 14:10' })
    const [placed] = await placeLastChats([row as Profile])
    expect(toAgent(placed).lastChat).toMatchObject({
      id: second.id,
      routine: true,
      title: 'Flight watch · Your flight to Lisbon moved to 14:10',
    })
  })

  it('isn’t mistaken for one by any other chat', async () => {
    const { runtime, stored } = await newChat(socket, agent)
    await turn(socket, runtime, 'Hello [[say: Hi]]', agent)
    expect(await runOf(agent, stored)).toBeNull()
  })

  it('stays finished when opened, and reopens when replied to', async () => {
    const resumed = await socket.request('session.resume', { session_id: first.id, profile: agent, source: 'desktop', omit_messages: true, lazy: true })
    expect((await runs(chatty.id)).find((r) => r.id === first.id)).toMatchObject({ end_reason: 'cron_complete' })

    await turn(socket, resumed.session_id, 'Thanks [[say: Any time]]', agent)
    expect((await runs(chatty.id)).find((r) => r.id === first.id)).toMatchObject({ end_reason: null, ended_at: null, message_count: 4 })
  })

  it('refuses a second run while one is going, with 409', async () => {
    const slow = await create('Slow', 'Take your time [[slow: 400]] [[say: one two three four five six]]')
    const running = trigger(slow.id)
    await sleep(500)
    expect((await api.call('POST', job(slow.id, 'trigger'))).status).toBe(409)
    await running
    await api.delete(job(slow.id))
  })
})

describe('a quiet run', () => {
  it('answers [SILENT], which Murmur reads as quiet, and still counts as ok', async () => {
    const quiet = await create('Inbox watch', 'Check the inbox [[silent]]')
    expect(await trigger(quiet.id)).toMatchObject({ last_status: 'ok' })
    const [run] = await runs(quiet.id)
    expect(run.end_reason).toMatch(/^cron_/)
    const [answer] = await messages(run.id, 1)
    expect(answer).toMatchObject({ role: 'assistant', content: '[SILENT]' })
    expect(isQuiet(answer.content!)).toBe(true)
    await api.delete(job(quiet.id))
  })

  it('is told apart the way Hermes tells it apart', async () => {
    // The cases Murmur's port is tested with (src/features/routines/runs.test.ts),
    // asked of Hermes's own gateway/response_filters.is_autonomous_silence_response.
    const answers = [
      '[SILENT]', ' [silent] ', 'SILENT', 'NO_REPLY', 'no reply', '*NO_REPLY*', '.SILENT.', '[静默]', '沉默',
      'Nothing changed since this morning.\n[SILENT]', 'NO_REPLY\n\nInbox is empty.', '[SILENT] No new mail.',
      'The agent replied [SILENT] when there was nothing new.', 'Silent retry succeeded', '[SILENT', '',
      'Good morning! Octopuses have three hearts.',
    ]
    const script = 'import json,sys\nfrom gateway.response_filters import is_autonomous_silence_response as quiet\nprint(json.dumps([quiet(a) for a in json.loads(sys.argv[1])]))'
    const { stdout } = await promisify(execFile)('docker', ['exec', '-w', '/opt/hermes', inject('hermes').container, 'python', '-c', script, JSON.stringify(answers)])
    const hermes: boolean[] = JSON.parse(stdout)
    expect(Object.fromEntries(answers.map((a) => [a, isQuiet(a)]))).toEqual(Object.fromEntries(answers.map((a, i) => [a, hermes[i]])))
  })
})

describe('an agent’s runs', () => {
  it('are each placed with their routine, many new ones at once, and ones whose routine is gone', async () => {
    const tides = await create('Tide watch', 'Check the tides [[say: High tide at 6]]')
    for (let i = 0; i < 4; i++) {
      expect(await trigger(tides.id)).toMatchObject({ last_status: 'ok' })
      await sleep(1100)
    }
    const theirs = (await runs(tides.id)).map((r) => r.id)
    expect(theirs).toHaveLength(4)

    const listed = await fetchRoutineRuns(agent)
    expect(listed.filter((r) => r.routineId === tides.id).map((r) => r.id)).toEqual(theirs)
    // The quiet run's routine was deleted; its run still says whose it was.
    expect(listed.find((r) => r.title === 'Inbox watch')?.routineId).toEqual(expect.any(String))
  })
})

describe('the gateway that runs them', () => {
  it('says it’s running for each agent, and asking to start it again is harmless', async () => {
    expect(await api.get(`/api/status?${p}`)).toMatchObject({ gateway_running: true })
    expect(await startGateway(agent)).toMatchObject({ gateway_running: true })
    expect(await api.get(`/api/status?${p}`)).toMatchObject({ gateway_running: true })
  })
})

describe('a routine an agent sets up in a chat', () => {
  type Row = Message & { tool_name?: string | null }
  let chat: { runtime: string; stored: string }
  let made: string
  let live: string | undefined

  beforeAll(async () => {
    chat = await newChat(socket, agent)
    await turn(socket, chat.runtime, 'hello', agent)
    // As the agent reaches it: directly when it's among the tools, else through Hermes's tool_call.
    const tools = ((await modelRequests()).at(-1)?.body.tools ?? []) as { function: { name: string } }[]
    const direct = ['cronjob_manage', 'cronjob'].find((name) => tools.some((t) => t.function.name === name))
    const args = { action: 'create', name: 'Reply watch', prompt: 'Look for a reply [[say: AIS replied. Thursday at 2 PM works.]]', schedule: 'every 1h' }
    const call = direct ? { name: direct, args } : { name: 'tool_call', args: { calls: [{ name: 'cronjob_manage', arguments: args }] } }
    const from = socket.events.length
    await turn(socket, chat.runtime, toolsTag([call]), agent)
    const done = socket.events.slice(from).find((e) => e.type === 'tool.complete' && e.session_id === chat.runtime)
    const payload = (done?.payload ?? {}) as { name?: string; result?: unknown }
    live = madeRoutine(String(payload.name ?? ''), payload.result)
    made = (await api.get<Job[]>(`/api/cron/jobs?${p}`)).find((j) => j.name === 'Reply watch')!.id
  })

  it('is told apart from the step that made it, live and from the history', async () => {
    expect(live).toBe(made)
    const rows = (await api.get<{ messages: Row[] }>(`/api/sessions/${chat.stored}/messages?${p}&order=oldest&limit=50`)).messages
    const tools = rows.filter((r) => r.role === 'tool')
    expect(tools.map((r) => madeRoutine(r.tool_name || 'cronjob', r.content))).toContain(made)
  })

  it('keeps the chat Murmur notes on it, through its runs, and its schedule with it', async () => {
    const was = await api.get<Job>(job(made))
    expect(was.deliver).toBe('local')
    await api.put(job(made), { updates: { murmur_chat: chat.stored } })
    const noted = await api.get<Job & { murmur_chat?: string }>(job(made))
    expect(reportsTo(noted)).toBe(chat.stored)
    expect(noted.schedule.display).toBe(was.schedule.display)
    expect(noted.next_run_at).toBe(was.next_run_at)
    await trigger(made)
    expect(reportsTo(await api.get<Job & { murmur_chat?: string }>(job(made)))).toBe(chat.stored)
  })

  it('says what a run found, and keeps what Murmur writes down of it', async () => {
    const [run] = await runs(made)
    const read = await api.get<{ messages: Message[] }>(`/api/sessions/${run.id}/messages?${p}&order=oldest&limit=100&inline_images=false`)
    expect(findingIn(read.messages)).toBe('AIS replied. Thursday at 2 PM works.')
    const kept = [{ run: run.id, at: run.ended_at! * 1000 }]
    await api.put(job(made), { updates: { murmur_findings: kept, murmur_read: run.started_at * 1000 } })
    const after = await api.get<Job & { murmur_findings?: unknown; murmur_read?: unknown }>(job(made))
    expect(findingsOf(after)).toEqual(kept)
    expect(after.murmur_read).toBe(run.started_at * 1000)
  })

  it('goes to the agent with your next message, which reads back as just what you wrote', async () => {
    const extra = along({ found: [{ routine: 'Reply watch', when: 'today at 9:15 AM', text: 'AIS replied.' }], note: true })
    await turn(socket, chat.runtime, `What did they say?\n\n${extra}`, agent)
    const sent = (await modelRequests()).at(-1)!.body.messages as { role: string; content: unknown }[]
    expect(JSON.stringify(sent.filter((m) => m.role === 'user').at(-1)?.content)).toContain('AIS replied.')
    const rows = (await api.get<{ messages: Row[] }>(`/api/sessions/${chat.stored}/messages?${p}&order=latest&limit=10`)).messages
    const mine = rows.filter((r) => r.role === 'user').at(-1)!.content!
    expect(toldIn(mine)).toBe(true)
    expect(parseUserMessage(mine).text).toBe('What did they say?')
  })

  afterAll(async () => {
    if (made) await api.delete(job(made))
  })
})

describe('a failed run', () => {
  const read = async (run: string) =>
    (await api.get<{ messages: Message[] }>(`/api/sessions/${run}/messages?${p}&order=oldest&limit=100&inline_images=false`)).messages
  const lastRun = async (id: string) => Date.parse((await api.get<{ last_run_at: string }>(job(id))).last_run_at)

  it('isn’t a result, though Hermes’s apology is its answer, and says why; its routine counts it', async () => {
    const made = await create('Turned away', 'Look [[fail]]')
    await trigger(made.id)
    await sleep(1100)
    await trigger(made.id)
    const [run] = await runs(made.id)
    const said = await read(run.id)
    expect(findingIn(said)).toBe('')
    expect(failureIn(said)).toMatch(/refused/)
    expect(await fetchRunResult(agent, run.id)).toMatchObject({ text: '', failed: expect.stringMatching(/refused/) })
    expect(failingOf(await api.get(job(made.id)))).toMatchObject({ times: 2, why: expect.stringMatching(/^HTTP 400: .*refused/) })
    // Counted once its routine's last run is no older than the run (server/watch.ts).
    expect(await lastRun(made.id)).toBeGreaterThanOrEqual(run.started_at * 1000)
    await api.delete(job(made.id))
  })

  it('the agent marks failed says why, and its routine keeps that', async () => {
    const made = await create('Marked failed', 'Look [[say: [CRON_FAILURE]\nThe Gmail sign-in expired.]]')
    await trigger(made.id)
    const [run] = await runs(made.id)
    const said = await read(run.id)
    expect(findingIn(said)).toBe('')
    expect(failureIn(said)).toBe('The Gmail sign-in expired.')
    expect(failingOf(await api.get(job(made.id)))).toMatchObject({ times: 1, why: 'The Gmail sign-in expired.' })
    await api.delete(job(made.id))
  })
})
