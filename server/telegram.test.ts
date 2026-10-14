import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHermes } from './hermes.ts'
import { createPairings, MAX_BACKOFF_MS, POLL_MS, type TelegramHermes } from './telegram.ts'

// A Hermes dashboard's Telegram onboarding routes (hermes_cli/web_routers/messaging.py,
// the same in 0.21.5 and 0.22), reached through fetch with the shapes it answers.

const NOT_FOUND = 'Telegram setup session was not found. Start a new setup.'
const TTL_MS = 10 * 60_000

type Code = { expiresAt: number; ready?: { token: string; username: string; owner: string } }

function fakeHermes() {
  const state = {
    codes: new Map<string, Code>(),
    applied: [] as { id: string; query: string; body: { allowed_user_ids: string[]; profile?: string } }[],
    telegram: new Map<string, boolean>(),
    calls: [] as string[],
    up: true,
    failApply: 0,
    next: 0,
  }
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    state.calls.push(`${method} ${url.pathname}`)
    if (!state.up) throw new TypeError('fetch failed')
    if (url.pathname === '/api/status') return json(200, { version: '0.22.0', auth_required: false })
    if ((init.headers as Record<string, string>)['x-hermes-session-token'] !== 'secret') return json(401, { detail: 'Unauthorized' })
    // Hermes forgets codes past their time.
    for (const [id, code] of state.codes) if (code.expiresAt <= Date.now()) state.codes.delete(id)

    if (url.pathname === '/api/messaging/platforms') {
      const on = state.telegram.get(url.searchParams.get('profile') ?? 'default') ?? false
      return json(200, { platforms: [{ id: 'telegram', enabled: on, configured: on, gateway_running: true, state: null }] })
    }
    if (url.pathname === '/api/messaging/telegram/onboarding/start' && method === 'POST') {
      const id = `pair-${++state.next}`
      const expiresAt = Date.now() + TTL_MS
      state.codes.set(id, { expiresAt })
      return json(200, {
        pairing_id: id,
        suggested_username: 'atlas_bot',
        deep_link: `https://t.me/HermesSetupBot?start=${id}`,
        qr_payload: `https://t.me/HermesSetupBot?start=${id}`,
        expires_at: new Date(expiresAt).toISOString(),
      })
    }
    const match = url.pathname.match(/^\/api\/messaging\/telegram\/onboarding\/([^/]+)(\/apply)?$/)
    if (!match) return json(404, { detail: 'Not Found' })
    const id = decodeURIComponent(match[1])
    const code = state.codes.get(id)
    if (method === 'DELETE') {
      state.codes.delete(id)
      return json(200, { ok: true })
    }
    if (!code) return json(404, { detail: NOT_FOUND })
    const expires_at = new Date(code.expiresAt).toISOString()
    if (match[2]) {
      if (!code.ready) return json(409, { detail: 'Telegram setup is not ready yet.' })
      if (state.failApply > 0) {
        state.failApply--
        return json(500, { detail: 'Failed to save Telegram setup.' })
      }
      const body = JSON.parse(String(init.body))
      state.applied.push({ id, query: url.search, body })
      state.telegram.set(body.profile, true)
      state.codes.delete(id)
      return json(200, { ok: true, platform: 'telegram', bot_username: code.ready.username, needs_restart: false })
    }
    if (code.ready) return json(200, { status: 'ready', bot_username: code.ready.username, owner_user_id: code.ready.owner, expires_at })
    return json(200, { status: 'waiting', expires_at })
  })

  /** The person finishes in Telegram. */
  const finish = (id: string, owner = '424242') => {
    const code = state.codes.get(id)
    if (code) code.ready = { token: '123:abc', username: 'atlas_bot', owner }
  }
  /** The dashboard restarts: its pairings were only in memory. */
  const restart = () => state.codes.clear()
  const applies = () => state.calls.filter((c) => c.endsWith('/apply')).length
  const looks = () => state.calls.filter((c) => /^GET \/api\/messaging\/telegram\/onboarding\/[^/]+$/.test(c)).length
  return { state, fetch, finish, restart, applies, looks }
}

let dir: string
let fake: ReturnType<typeof fakeHermes>
let hermes: TelegramHermes & { peek: ReturnType<typeof vi.fn> }
const file = () => join(dir, 'telegram.json')
const open = (connections: Record<string, TelegramHermes | null> = { main: hermes }) =>
  createPairings({ hermes: (id) => connections[id] ?? null, file })
const stored = () => JSON.parse(readFileSync(file(), 'utf8')).pairings
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  dir = mkdtempSync(join(tmpdir(), 'murmur-telegram-'))
  fake = fakeHermes()
  vi.stubGlobal('fetch', fake.fetch)
  hermes = Object.assign(createHermes({ id: 'main', name: 'Hermes', url: 'http://hermes.test:9119', source: 'saved', token: 'secret' }), {
    peek: vi.fn(async () => [{ ok: true }]),
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

describe('a pairing', () => {
  it('waits, then saves the bot for its agent once Telegram is done, with no tab watching', async () => {
    const store = open()
    const started = await store.start('main', 'atlas', 'Atlas')
    expect(started).toMatchObject({ profile: 'atlas', phase: 'waiting', link: expect.stringContaining('t.me'), qr: expect.any(String) })
    expect(started).not.toHaveProperty('id')
    expect(started.expiresAt).toBe(Date.now() + TTL_MS)

    await wait(POLL_MS * 3)
    expect(store.list('main')[0].phase).toBe('waiting')
    expect(fake.looks()).toBe(3)

    fake.finish('pair-1')
    await wait(POLL_MS)
    expect(store.list('main')).toEqual([expect.objectContaining({ profile: 'atlas', phase: 'connected', username: 'atlas_bot' })])
    // Exactly what the app sent: only the person who paired, on this agent.
    expect(fake.state.applied).toEqual([
      { id: 'pair-1', query: '?profile=atlas', body: { allowed_user_ids: ['424242'], profile: 'atlas' } },
    ])
    expect(fake.state.telegram.get('atlas')).toBe(true)
    // The bot's name goes where every device can read it.
    expect(hermes.peek).toHaveBeenCalledWith([
      ['profiles.configure', { name: 'atlas', ui_meta: { 'murmur-telegram': { username: 'atlas_bot', since: expect.any(Number) } } }],
    ])
    store.stop()
  })

  it('applies once, and stops asking', async () => {
    const store = open()
    await store.start('main', 'atlas', 'Atlas')
    fake.finish('pair-1')
    await wait(POLL_MS * 20)
    expect(fake.applies()).toBe(1)
    expect(fake.looks()).toBe(1)
    store.stop()
  })

  it('tries the save again when Hermes stumbles, and still saves once', async () => {
    const store = open()
    await store.start('main', 'atlas', 'Atlas')
    fake.finish('pair-1')
    fake.state.failApply = 2
    await wait(MAX_BACKOFF_MS * 2)
    expect(store.list('main')[0].phase).toBe('connected')
    expect(fake.applies()).toBe(3)
    expect(fake.state.applied).toHaveLength(1)
    store.stop()
  })

  it('is only for the Hermes it was started on', async () => {
    const store = open({ main: hermes, other: hermes })
    await store.start('main', 'atlas', 'Atlas')
    expect(store.list('other')).toEqual([])
    expect(store.list('main')).toHaveLength(1)
    store.stop()
  })

  it('a new code for an agent lets the old one go', async () => {
    const store = open()
    await store.start('main', 'atlas', 'Atlas')
    await store.start('main', 'atlas', 'Atlas')
    await wait(0)
    expect(fake.state.calls).toContain('DELETE /api/messaging/telegram/onboarding/pair-1')
    expect(store.list('main')).toHaveLength(1)
    fake.finish('pair-2')
    await wait(POLL_MS)
    expect(store.list('main')[0].phase).toBe('connected')
    store.stop()
  })
})

describe('surviving restarts', () => {
  it('carries on after Murmur restarts, and finishes', async () => {
    const before = open()
    await before.start('main', 'atlas', 'Atlas')
    before.stop()
    expect(stored()).toEqual([expect.objectContaining({ connection: 'main', profile: 'atlas', id: 'pair-1', phase: 'waiting' })])

    // Telegram finishes while Murmur is down.
    fake.finish('pair-1')
    await wait(POLL_MS * 4)
    expect(fake.applies()).toBe(0)

    const after = open()
    after.resume()
    await wait(0)
    expect(after.list('main')[0]).toMatchObject({ phase: 'connected', username: 'atlas_bot' })
    expect(fake.applies()).toBe(1)
    after.stop()
  })

  it('a save whose answer was lost, then a restart, still counts as connected', async () => {
    const before = open()
    await before.start('main', 'atlas', 'Atlas')
    fake.finish('pair-1')
    // Hermes saves the bot, but its answer never reaches Murmur, which then stops.
    const original = hermes.send
    hermes.send = (async (...args: Parameters<typeof original>) => {
      const res = await original(...args)
      if (String(args[1]).includes('/apply')) throw new Error('socket hang up')
      return res
    }) as typeof original
    await wait(POLL_MS)
    before.stop()
    hermes.send = original
    expect(stored()[0].phase).toBe('applying')
    expect(fake.state.applied).toHaveLength(1)

    const after = open()
    after.resume()
    await wait(0)
    expect(after.list('main')[0]).toMatchObject({ phase: 'connected', username: 'atlas_bot' })
    expect(fake.state.applied).toHaveLength(1)
    after.stop()
  })

  it('fails clearly when the Hermes dashboard restarted and forgot the code', async () => {
    const store = open()
    await store.start('main', 'atlas', 'Atlas')
    await wait(POLL_MS)
    fake.restart()
    await wait(POLL_MS)
    expect(store.list('main')[0]).toMatchObject({ phase: 'failed', message: 'Hermes restarted before Telegram finished.' })
    const looks = fake.looks()
    await wait(POLL_MS * 10)
    expect(fake.looks()).toBe(looks)
    store.stop()
  })

  it('a code an older Murmur tab saved itself counts as connected', async () => {
    const store = open()
    await store.start('main', 'atlas', 'Atlas')
    await wait(0) // Murmur notes Telegram was off
    fake.state.codes.delete('pair-1')
    fake.state.telegram.set('atlas', true)
    await wait(POLL_MS)
    expect(store.list('main')[0].phase).toBe('connected')
    store.stop()
  })

  it('a forgotten code isn’t taken for a finished one before Hermes says whether Telegram was on', async () => {
    const store = open()
    const original = hermes.send
    // Hermes is slow to list its platforms (15s and more is common).
    hermes.send = ((method: string, path: string, ...rest: unknown[]) =>
      path.startsWith('/api/messaging/platforms') ? new Promise(() => {}) : original(method, path, ...(rest as []))) as typeof original
    await store.start('main', 'atlas', 'Atlas')
    hermes.send = original
    fake.state.telegram.set('atlas', true)
    fake.restart()
    await wait(POLL_MS)
    expect(store.list('main')[0].phase).toBe('failed')
    store.stop()
  })

  it('a forgotten code isn’t taken for a finished one when Telegram was already on', async () => {
    fake.state.telegram.set('atlas', true)
    const store = open()
    await store.start('main', 'atlas', 'Atlas')
    fake.restart()
    await wait(POLL_MS)
    expect(store.list('main')[0]).toMatchObject({ phase: 'failed', message: 'Hermes restarted before Telegram finished.' })
    store.stop()
  })

  it('forgets a pairing whose Hermes was removed from Murmur', async () => {
    const before = open()
    await before.start('main', 'atlas', 'Atlas')
    before.stop()
    const after = open({})
    after.resume()
    await wait(0)
    expect(after.list('main')).toEqual([])
    expect(stored()).toEqual([])
    after.stop()
  })
})

describe('running out', () => {
  it('expires with the code, and stops asking', async () => {
    const store = open()
    const { expiresAt } = await store.start('main', 'atlas', 'Atlas')
    await wait(expiresAt - Date.now() + POLL_MS)
    expect(store.list('main')[0].phase).toBe('expired')
    expect(stored()[0].phase).toBe('expired')
    const looks = fake.looks()
    await wait(POLL_MS * 10)
    expect(fake.looks()).toBe(looks)
    store.stop()
  })

  it('reads as expired the moment the time is up, between looks', async () => {
    const store = open()
    const { expiresAt } = await store.start('main', 'atlas', 'Atlas')
    store.stop() // nobody looking
    vi.setSystemTime(expiresAt)
    expect(store.list('main')[0].phase).toBe('expired')
  })

  it('backs off while Hermes is unreachable, then picks up where it was', async () => {
    const store = open()
    await store.start('main', 'atlas', 'Atlas')
    fake.state.up = false
    const before = fake.state.calls.length
    await wait(60_000)
    // 5s, 10s, 20s, then every 30s: a handful of tries, not twenty-four.
    expect(fake.state.calls.length - before).toBeLessThanOrEqual(5)
    fake.state.up = true
    fake.finish('pair-1')
    await wait(MAX_BACKOFF_MS)
    expect(store.list('main')[0].phase).toBe('connected')
    store.stop()
  })
})

describe('cancelling', () => {
  it('lets the code go at Hermes and stops asking', async () => {
    const store = open()
    await store.start('main', 'atlas', 'Atlas')
    store.cancel('main', 'atlas')
    await wait(0)
    expect(fake.state.calls).toContain('DELETE /api/messaging/telegram/onboarding/pair-1')
    expect(store.list('main')).toEqual([])
    expect(stored()).toEqual([])
    await wait(POLL_MS * 4)
    expect(fake.looks()).toBe(0)
    store.stop()
  })

  it('forgets a finished one without telling Hermes', async () => {
    const store = open()
    await store.start('main', 'atlas', 'Atlas')
    fake.finish('pair-1')
    await wait(POLL_MS)
    store.cancel('main', 'atlas')
    await wait(0)
    expect(fake.state.calls.filter((c) => c.startsWith('DELETE'))).toEqual([])
    expect(store.list('main')).toEqual([])
  })
})

describe('starting', () => {
  it('says so when Hermes can’t reach the setup service', async () => {
    const original = fake.fetch.getMockImplementation()!
    fake.fetch.mockImplementation(async (input, init) =>
      String(input).endsWith('/onboarding/start')
        ? new Response(JSON.stringify({ detail: 'Telegram setup service is unavailable. Try again shortly.' }), { status: 502 })
        : original(input, init),
    )
    const store = open()
    await expect(store.start('main', 'atlas', 'Atlas')).rejects.toMatchObject({
      status: 502,
      message: 'Telegram setup isn’t reachable right now. Try again in a moment.',
    })
    expect(store.list('main')).toEqual([])
  })
})
