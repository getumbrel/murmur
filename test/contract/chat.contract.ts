// A chat, the way src/state/chats.ts holds one: made over the socket, streamed
// as events, read back over REST, and stopped, edited, reacted to and deleted.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearUnread } from '@/state/chats'
import { api, connect, modelRequests, newChat, q, sleep, turn, whenIdle, type Socket } from './client'

let socket: Socket
beforeAll(async () => {
  socket = await connect()
})
afterAll(() => socket?.close())

type Row = { id: number; role: string; content: string | null; timestamp: number; tool_calls?: unknown[]; tool_call_id?: string; tool_name?: string; display_kind?: string | null }

/** A chat's saved messages, the way the app loads them (oldest first). */
async function history(stored: string, agent = 'default') {
  const res = await api.get<{ messages: Row[] }>(`/api/sessions/${stored}/messages?${q(agent)}&order=latest&limit=500`)
  return [...res.messages].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)
}

describe('a turn', () => {
  it('makes a chat with a runtime id and a stored id, and the model it uses', async () => {
    const { runtime, stored, created } = await newChat(socket)
    expect(runtime).toMatch(/^[0-9a-f]{8}$/)
    expect(stored).toMatch(/^\d{8}_\d{6}_[0-9a-f]+$/)
    expect(created.info).toMatchObject({ model: 'murmur-fake-small' })
  })

  it('names the provider once the chat is live', async () => {
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, 'Hi [[say: Hi]]')
    const info = await socket.event('session.info', runtime)
    expect(info.payload).toMatchObject({ model: 'murmur-fake-small', provider: expect.stringContaining('fake'), reasoning_effort: expect.any(String) })
  })

  it('streams the answer, then completes it with usage and the saved row ids', async () => {
    const { runtime } = await newChat(socket)
    const done = await turn(socket, runtime, 'Hi [[say: Hello from the contract suite]]')
    const types = socket.of(runtime).map((e) => e.type)
    expect(types).toContain('message.start')
    expect(types.indexOf('message.start')).toBeLessThan(types.indexOf('message.complete'))
    const streamed = socket.of(runtime).filter((e) => e.type === 'message.delta').map((e) => (e.payload as { text: string }).text).join('')
    expect(streamed).toBe('Hello from the contract suite')
    expect(done.payload).toMatchObject({
      text: 'Hello from the contract suite',
      status: 'complete',
      usage: expect.objectContaining({ context_max: expect.any(Number) }),
      persisted_turn: { user_row_id: expect.any(Number), final_assistant_row_id: expect.any(Number) },
    })
  })

  it('names the chat from the first message, then from the model', async () => {
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, 'Plan a picnic [[say: Sure]]')
    const title = await socket.until('a model-made title', () =>
      socket.of(runtime).find((e) => e.type === 'session.title' && (e.payload as { title: string }).title.startsWith('Contract test')),
    )
    expect(title.payload).toMatchObject({ title: expect.stringMatching(/^Contract test/) })
    expect(await socket.request('session.title', { session_id: runtime })).toMatchObject({ title: expect.stringMatching(/^Contract test/) })
  })

  it('saves the turn as rows the app can read back', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'Remember this [[say: Noted]]')
    const rows = await history(stored)
    expect(rows.map((r) => [r.role, r.content])).toEqual([
      ['user', 'Remember this [[say: Noted]]'],
      ['assistant', 'Noted'],
    ])
    expect(rows[0].timestamp * 1000).toBeGreaterThan(Date.now() - 600_000)
  })

  it('shows a tool call as start and complete events, and as rows', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'Run it [[tool: terminal {"command":"echo murmur-contract"}]]')
    const start = socket.of(runtime).find((e) => e.type === 'tool.start')!.payload as Record<string, unknown>
    const complete = socket.of(runtime).find((e) => e.type === 'tool.complete')!.payload as Record<string, unknown>
    expect(start).toMatchObject({ name: 'terminal', tool_id: expect.any(String), args: { command: 'echo murmur-contract' } })
    expect(complete).toMatchObject({ name: 'terminal', tool_id: start.tool_id })
    expect(JSON.stringify(complete.result)).toContain('murmur-contract')

    const rows = await history(stored)
    const call = rows.find((r) => r.role === 'assistant' && r.tool_calls?.length)!
    expect(call.tool_calls![0]).toMatchObject({ function: { name: 'terminal', arguments: expect.stringContaining('murmur-contract') } })
    const callId = (call.tool_calls![0] as { id?: string; call_id?: string }).id ?? (call.tool_calls![0] as { call_id?: string }).call_id
    const result = rows.find((r) => r.role === 'tool')!
    expect(result.tool_call_id).toBe(callId)
    expect(result.content).toContain('murmur-contract')
    expect(rows.at(-1)).toMatchObject({ role: 'assistant', content: '[[tool done]]' })
  })

  it('reports a model that refuses as an error, saved as a failed turn', async () => {
    const { runtime, stored } = await newChat(socket)
    const done = await turn(socket, runtime, 'Hello? [[fail]]')
    expect(done.payload).toMatchObject({ status: 'error', text: expect.stringContaining('refused this request') })
    expect((await history(stored)).at(-1)).toMatchObject({ role: 'assistant', display_kind: 'failed_turn' })
  })
})

describe('around a turn', () => {
  it('takes a picture and a file, and serves them back', async () => {
    const { runtime, stored } = await newChat(socket)
    const dot = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const image = await socket.request('image.attach_bytes', { session_id: runtime, content_base64: dot, filename: 'dot.png' })
    expect(image.path).toMatch(/\.png$/)
    const file = await socket.request('file.attach', { session_id: runtime, name: 'notes.txt', data_url: 'data:text/plain;base64,aGVsbG8gbXVybXVy' })
    expect(file.ref_text).toMatch(/^@file:/)
    expect(file.path).toEqual(expect.any(String))

    await turn(socket, runtime, `${file.ref_text} Have a look [[say: Seen]]`)

    const read = await api.get(`/api/fs/read-text?${new URLSearchParams({ path: file.path })}`)
    expect(read).toMatchObject({ text: 'hello murmur', truncated: false, binary: false, byteSize: 12 })
    // As src/features/media/files.ts links it, once the chat is saved: by its stored id (a runtime id is a 404).
    const download = await fetch(`/hermes/api/fs/download?${new URLSearchParams({ path: image.path, session_id: stored, profile: 'default' })}`)
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('image/png')
  })

  it('answers a side question without touching the chat', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'Main thread [[say: Main answer]]')
    const { task_id } = await socket.request('prompt.btw', { session_id: runtime, text: 'Quick one [[say: Side answer]]' })
    const done = await socket.until('the side answer', () => socket.of(runtime).find((e) => e.type === 'btw.complete' && (e.payload as { task_id: string }).task_id === task_id))
    expect(done.payload).toMatchObject({ task_id, text: 'Side answer' })
    expect((await history(stored)).map((r) => r.content)).toEqual(['Main thread [[say: Main answer]]', 'Main answer'])
  })

  it('switches one chat’s model and thinking, leaving the agent’s alone', async () => {
    const { runtime } = await newChat(socket)
    const { provider } = await api.get('/api/model/options')
    // What chats.ts sends when a chat's model is picked.
    const set = await socket.request('config.set', { session_id: runtime, key: 'model', value: `murmur-fake-large --provider ${provider} --session` })
    expect(set).toMatchObject({ value: 'murmur-fake-large', confirm_required: false })
    await socket.request('config.set', { session_id: runtime, key: 'reasoning', value: 'high' })
    await turn(socket, runtime, 'Which model? [[say: Large]]')
    expect((await modelRequests()).filter((r) => r.body.tools?.length).at(-1)?.body.model).toBe('murmur-fake-large')
    expect((await api.get('/api/model/info')).model).toBe('murmur-fake-small')
  })

  it('has no goal set on a new chat', async () => {
    const { runtime } = await newChat(socket)
    const { control } = await socket.request('session.control.read', { session_id: runtime, profile: 'default' })
    expect(control).toHaveProperty('goal', null)
  })
})

describe('a running turn', () => {
  it('says it is busy, and stops when interrupted', async () => {
    const { runtime, stored } = await newChat(socket)
    await socket.request('prompt.submit', { session_id: runtime, text: `Count [[slow: 300]] [[say: ${'one two three four five six seven eight nine ten '.repeat(3)}]]` })
    await socket.event('message.delta', runtime)

    const { sessions } = await socket.request<{ sessions: { session_key: string; status: string }[] }>('session.active_list', {})
    expect(sessions.find((s) => s.session_key === stored)?.status).toMatch(/^(working|starting)$/)

    await socket.request('session.interrupt', { session_id: runtime })
    const done = await socket.event('message.complete', runtime)
    expect(done.payload?.status).toBe('interrupted')
  })

  it('takes a nudge mid-turn with session.steer', async () => {
    const { runtime } = await newChat(socket)
    await socket.request('prompt.submit', { session_id: runtime, text: 'Go [[slow: 200]] [[say: a b c d e f g h]]' })
    await socket.event('message.delta', runtime)
    await expect(socket.request('session.steer', { session_id: runtime, text: 'Shorter please' })).resolves.toBeDefined()
    await socket.event('message.complete', runtime)
  })
})

describe('coming back to a chat', () => {
  it('resumes a stored chat lazily under a new runtime id', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'Hello [[say: Hi]]')
    await socket.request('session.close', { session_id: runtime })

    const resumed = await socket.request('session.resume', { session_id: stored, profile: 'default', source: 'desktop', omit_messages: true, lazy: true })
    expect(resumed.session_id).toEqual(expect.any(String))
    expect(resumed.running === undefined || typeof resumed.running === 'boolean').toBe(true)
    expect(resumed.info).toMatchObject({ model: expect.any(String) })

    const next = await turn(socket, resumed.session_id, 'Again [[say: Hi again]]')
    expect(next.payload?.text).toBe('Hi again')
  })

  it('refuses an unknown runtime id with code 4001, which the app re-attaches on', async () => {
    const error = await socket.failure('prompt.submit', { session_id: 'deadbeef', text: 'hi' })
    expect(error.code).toBe(4001)
  })

  it('lists chats with what the agent page and sidebar read', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'List me [[say: Listed]]')
    const { sessions } = await socket.request<{ sessions: Record<string, unknown>[] }>('session.list', { profile: 'default', limit: 50 })
    const row = sessions.find((s) => s.id === stored || s.resolved_id === stored)
    expect(row).toMatchObject({ title: expect.any(String), started_at: expect.any(Number), message_count: 2, source: 'desktop' })

    const rest = await api.get(`/api/sessions?${q('default')}&limit=60&order=recent`)
    expect(rest.sessions.find((s: { id: string }) => s.id === stored)).toMatchObject({ last_active: expect.any(Number) })
  })

  it('finds chats by what was said in them', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'The word is periwinkle [[say: Got it]]')
    const { results } = await api.get(`/api/sessions/search?q=periwinkle&${q('default')}&limit=15&exclude_sources=cron,bot_room`)
    const hit = results.find((r: { session_id?: string; id?: string }) => (r.session_id ?? r.id) === stored)
    expect(hit).toBeDefined()
    expect(hit.snippet ?? hit.preview).toContain('periwinkle')
  })

  it('clears the unread mark Hermes Desktop keeps', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'Hi [[say: Hi]]')
    const unread = async () => {
      const { sessions } = await api.get(`/api/sessions?${q('default')}&limit=20&order=recent`)
      return sessions.find((s: { id: string }) => s.id === stored)?.unread
    }
    // Marked the way Desktop marks it: from Hermes 0.22.3, against the chat's revision.
    const snapshot = await api.call('GET', `/api/sessions/${stored}/mutation-snapshot?${q('default')}`)
    const fence =
      snapshot.status === 200
        ? { request_id: `unread-${stored}`, expected_revision: snapshot.body.runtime_revision }
        : {}
    await api.patch(`/api/sessions/${stored}`, { unread: true, profile: 'default', ...fence })
    expect(await unread()).toBe(true)

    await clearUnread(stored, 'default')
    expect(await unread()).toBe(false)
  })

  it('reports a chat’s cost fields', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'Hi [[say: Hi]]')
    const session = await api.get(`/api/sessions/${stored}?${q('default')}`)
    expect(session).toHaveProperty('estimated_cost_usd')
    expect(session).toHaveProperty('cost_status')
  })
})

describe('changing a chat', () => {
  it('edits and resends from a row, dropping what came after', async () => {
    const { runtime, stored } = await newChat(socket)
    const first = await turn(socket, runtime, 'First [[say: One]]')
    await turn(socket, runtime, 'Second [[say: Two]]')
    await whenIdle(() =>
      socket.request('prompt.submit', {
        session_id: runtime,
        text: 'First, edited [[say: Edited]]',
        truncate_before_row_id: first.payload!.persisted_turn!.user_row_id,
        confirm_truncate: true,
        confirm_empty_truncate: true,
      }),
    )
    await socket.until('the edited turn', () => socket.of(runtime).filter((e) => e.type === 'message.complete').length === 3 || undefined)
    expect((await history(stored)).map((r) => r.content)).toEqual(['First, edited [[say: Edited]]', 'Edited'])
  })

  it('undoes the last turn', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'Keep [[say: Kept]]')
    await turn(socket, runtime, 'Drop [[say: Dropped]]')
    const undone = await whenIdle(() => socket.request('session.undo', { session_id: runtime }))
    expect(undone.removed).toBeGreaterThan(0)
    expect((await history(stored)).map((r) => r.content)).toEqual(['Keep [[say: Kept]]', 'Kept'])
  })

  it('reacts to the newest answer, and keeps the reaction on its row', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'Hi [[say: Hi]]')
    const reacted = await socket.request('message.react', { session_id: runtime, newest_role: 'assistant', emoji: '👍' })
    expect(reacted).toMatchObject({ row_id: expect.any(Number), reactions: [expect.objectContaining({ emoji: '👍' })] })
    const row = (await history(stored)).find((r) => r.id === reacted.row_id) as Row & { display_metadata?: { reactions?: unknown[] } }
    expect(row.display_metadata?.reactions).toContainEqual(expect.objectContaining({ emoji: '👍' }))
  })

  it('branches a stored chat into a new one', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'Fork me [[say: Forked]]')
    const branch = await socket.request('session.branch_stored', { profile: 'default', parent_session_id: stored, source: 'desktop' })
    expect(branch.stored_session_id).toEqual(expect.any(String))
    expect((await history(branch.stored_session_id)).map((r) => r.content)).toContain('Forked')
  })

  it('runs a slash command', async () => {
    const { runtime } = await newChat(socket)
    const result = await socket.request('slash.exec', { session_id: runtime, command: '/help', profile: 'default' }).catch((e) => e)
    // Hermes either runs it here, or (4018) points the app to command.dispatch.
    if (result instanceof Error) expect((result as { code?: number }).code).toBe(4018)
    else expect(result).toHaveProperty('output')
  })

  it('closes and deletes a chat', async () => {
    const { runtime, stored } = await newChat(socket)
    await turn(socket, runtime, 'Bye [[say: Bye]]')
    await socket.request('session.close', { session_id: runtime })
    await socket.request('session.delete', { session_id: stored, profile: 'default' })
    await sleep(200)
    expect((await api.call('GET', `/api/sessions/${stored}/messages?${q('default')}`)).status).toBe(404)
  })
})
