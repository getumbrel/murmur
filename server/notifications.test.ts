import { createECDH } from 'node:crypto'
import http from 'node:http'
import type net from 'node:net'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Note } from '../shared/notes.ts'
import { useEnv } from './config.ts'
import { reload } from './connection.ts'
import { createNotifications, TAB_TTL_MS, type NativeNote } from './notifications.ts'
import type { Moment } from './watch.ts'
import type { PushResult, Subscription } from './web-push.ts'

// The API the app uses, through a real HTTP server, with Hermes watched and
// pushes sent by stand-ins: who hears what, and when.

const note: Note = { title: 'Atlas', body: 'Booked.', tag: 'murmur:chat:c1', href: '/chat/atlas/c1' }
const ask: Note = { title: 'Atlas', body: 'Needs your OK', tag: 'murmur:chat:c2', href: '/chat/atlas/c2' }

/** A browser's push key: a point on P-256. */
const pushKey = (() => {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return ecdh.getPublicKey('base64url')
})()

const subscription = (n: number): Subscription => ({
  endpoint: `https://push.example/send/device-${n}`,
  keys: { p256dh: pushKey, auth: Buffer.alloc(16, n).toString('base64url') },
})

let dir: string
let server: http.Server
let base: string
let stop: () => void
let tell: ((moment: Moment) => void) | undefined
let watching: number
let pushes: { endpoint: string; payload: Record<string, any>; urgency: string; ttl: number }[]
let shown: NativeNote[]
let answer: (endpoint: string) => PushResult

async function start({ native = false } = {}) {
  const notifications = createNotifications({
    file: () => join(dir, 'notifications.json'),
    notify: native ? (n) => void shown.push(n) : undefined,
    watch: (_hermes, onMoment) => {
      watching++
      tell = onMoment
      return {
        stop: () => {
          watching--
          tell = undefined
        },
      }
    },
    push: async (sub, payload, _keys, options) => {
      pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), urgency: options.urgency, ttl: options.ttl })
      return answer(sub.endpoint)
    },
  })
  server = http.createServer(async (req, res) => {
    if (!(await notifications.handle(req, res, new URL(req.url!, 'http://x').pathname))) res.writeHead(404).end()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
  stop = () => {
    notifications.stop()
    server.close()
  }
}

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://umbrel.local' }, body: JSON.stringify(body) })
const register = async (n: number) => ((await (await post('/murmur/notifications/devices', { subscription: subscription(n) })).json()) as { device: string }).device
const beat = (tab: string, body: Record<string, unknown>) => post('/murmur/presence', { tab, hermes: 'env', ...body })
const settle = () => new Promise((done) => setTimeout(done, 10))
const to = () => pushes.map((p) => p.endpoint.split('/').pop())

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'murmur-notify-'))
  useEnv({ DATA_DIR: dir, HERMES_URL: 'http://hermes.test:9119' })
  reload()
  watching = 0
  pushes = []
  shown = []
  answer = () => ({ status: 201, gone: false })
})

afterEach(() => {
  stop()
  useEnv(process.env)
  rmSync(dir, { recursive: true, force: true })
})

describe('devices', () => {
  it('watches Hermes only while a device wants telling', async () => {
    await start()
    expect(watching).toBe(0)
    const id = await register(1)
    expect(watching).toBe(1)
    const known = await (await fetch(`${base}/murmur/notifications?device=${id}`)).json()
    expect(known).toMatchObject({ known: true, native: false, key: expect.stringMatching(/^[A-Za-z0-9_-]{87}$/) })
    await fetch(`${base}/murmur/notifications/devices/${id}`, { method: 'DELETE' })
    expect(watching).toBe(0)
    expect(await (await fetch(`${base}/murmur/notifications?device=${id}`)).json()).toMatchObject({ known: false })
  })

  it('keeps its push key and devices, owner-only, across restarts', async () => {
    await start()
    const { key } = (await (await fetch(`${base}/murmur/notifications`)).json()) as { key: string }
    const id = await register(1)
    stop()
    await start()
    expect(await (await fetch(`${base}/murmur/notifications?device=${id}`)).json()).toMatchObject({ key, known: true })
    expect(watching).toBe(1)
    // Windows keeps no owner-only permissions for a file, only whether it's read-only.
    if (process.platform !== 'win32') expect(statSync(join(dir, 'notifications.json')).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(join(dir, 'notifications.json'), 'utf8')).devices[0]).toMatchObject({ id, origin: 'https://umbrel.local' })
  })

  it('takes only a subscription a browser could have made', async () => {
    await start()
    const offCurve = { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: subscription(1).keys.auth }
    const bad = [
      {},
      { ...subscription(1), endpoint: 'http://push.example/x' },
      { ...subscription(1), keys: { p256dh: 'short', auth: 'x' } },
      { ...subscription(1), keys: offCurve },
    ]
    for (const subscription of bad) expect((await post('/murmur/notifications/devices', { subscription })).status).toBe(422)
    expect((await post('/murmur/notifications/devices', { native: true })).status).toBe(404)
  })

  it('takes a renewed subscription in place of the one it replaces', async () => {
    await start()
    const old = await register(1)
    const renewed = await post('/murmur/notifications/devices', { subscription: subscription(2), previous: subscription(1).endpoint })
    const { device } = (await renewed.json()) as { device: string }
    expect(device).not.toBe(old)
    expect(await (await fetch(`${base}/murmur/notifications?device=${old}`)).json()).toMatchObject({ known: false })
    tell!({ kind: 'note', note })
    expect(to()).toEqual(['device-2'])
  })

  it('makes room by letting go of the device signed up longest ago', async () => {
    await start()
    const first = await register(1)
    for (let n = 2; n <= 25; n++) await register(n)
    expect(await (await fetch(`${base}/murmur/notifications?device=${first}`)).json()).toMatchObject({ known: false })
    tell!({ kind: 'note', note })
    expect(pushes).toHaveLength(24)
  })

  it('forgets a device its push service says is gone', async () => {
    await start()
    const id = await register(1)
    answer = () => ({ status: 410, gone: true })
    tell!({ kind: 'note', note })
    await settle()
    expect(await (await fetch(`${base}/murmur/notifications?device=${id}`)).json()).toMatchObject({ known: false })
    expect(watching).toBe(0)
  })

  it('forgets a device whose push service turns Murmur’s key away, but not one that’s just busy', async () => {
    await start()
    const id = await register(1)
    answer = () => ({ status: 429, gone: false })
    for (let i = 0; i < 3; i++) tell!({ kind: 'note', note })
    await settle()
    expect(await (await fetch(`${base}/murmur/notifications?device=${id}`)).json()).toMatchObject({ known: true })
    answer = () => ({ status: 403, gone: false })
    for (let i = 0; i < 3; i++) tell!({ kind: 'note', note })
    await settle()
    expect(await (await fetch(`${base}/murmur/notifications?device=${id}`)).json()).toMatchObject({ known: false })
  })

  it('changes nothing once stopped, even as pushes it sent come back', async () => {
    await start()
    const id = await register(1)
    let gone!: (result: PushResult) => void
    const pending = new Promise<PushResult>((done) => (gone = done))
    answer = () => pending as unknown as PushResult
    tell!({ kind: 'note', note })
    stop()
    gone({ status: 410, gone: true })
    await settle()
    await start()
    expect(await (await fetch(`${base}/murmur/notifications?device=${id}`)).json()).toMatchObject({ known: true })
    expect(watching).toBe(1)
  })
})

describe('who hears a note', () => {
  it('every device, when the person isn’t in Murmur anywhere', async () => {
    await start()
    await register(1)
    await register(2)
    tell!({ kind: 'note', note })
    expect(to()).toEqual(['device-1', 'device-2'])
    expect(pushes[0]).toMatchObject({
      payload: {
        notification: {
          title: 'Atlas',
          body: 'Booked.',
          tag: 'murmur:chat:c1',
          timestamp: expect.any(Number),
          navigate: 'https://umbrel.local/chat/atlas/c1?hermes=env',
          data: { id: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/), href: '/chat/atlas/c1', hermes: 'env' },
        },
      },
    })
    expect(pushes[1].payload.notification.data.id).not.toBe(pushes[0].payload.notification.data.id)
    // Not Safari's declarative form: one Safari shows by itself loads its link when tapped, Murmur open or not.
    expect(pushes[0].payload).not.toHaveProperty('web_push')
  })

  it('only the device they’re using, while they’re using one', async () => {
    await start()
    const phone = await register(1)
    const laptop = await register(2)
    await beat('t1', { device: laptop, active: true, viewing: 'murmur:chat:other' })
    await beat('t2', { device: phone, active: false })
    tell!({ kind: 'note', note })
    expect(to()).toEqual(['device-2'])
  })

  it('nobody, when they’re looking at that chat', async () => {
    await start()
    const phone = await register(1)
    await beat('t1', { device: phone, active: true, viewing: 'murmur:chat:c1' })
    tell!({ kind: 'note', note })
    expect(pushes).toEqual([])
  })

  it('nobody, when they’re active where notifications are off: they’ll see it there', async () => {
    await start()
    await register(1)
    await beat('t1', { active: true })
    tell!({ kind: 'note', note })
    expect(pushes).toEqual([])
  })

  it('the device they’re at, though not in Murmur there, and the others once they’ve gone', async () => {
    await start()
    const phone = await register(1)
    const laptop = await register(2)
    // Another app in front on the laptop, Murmur touched a minute ago.
    await beat('t1', { device: laptop, active: false, here: true, viewing: 'murmur:chat:c1' })
    await beat('t2', { device: phone, active: false, here: false })
    tell!({ kind: 'note', note: { ...note, body: 'First.' } })
    tell!({ kind: 'note', note })
    tell!({ kind: 'note', note: { ...note, tag: 'murmur:chat:c3', href: '/chat/atlas/c3' } })
    expect(to()).toEqual(['device-2', 'device-2', 'device-2'])
    await beat('t1', { device: laptop, active: false, here: true })
    expect(pushes).toHaveLength(3)
    // Two minutes on: gone. The phone hears what's still not looked at, the newest for each chat.
    await beat('t1', { device: laptop, active: false, here: false })
    expect(to().slice(3)).toEqual(['device-1', 'device-1'])
    expect(pushes.slice(3).map((p) => p.payload.notification.body)).toEqual(['Booked.', 'Booked.'])
    expect(pushes.slice(3).map((p) => p.payload.notification.tag)).toEqual(['murmur:chat:c1', 'murmur:chat:c3'])
    // Once.
    await beat('t1', { device: laptop, active: false, here: true })
    await beat('t1', { device: laptop, active: false, here: false })
    expect(pushes).toHaveLength(5)
  })

  it('not the others, once they’re back in Murmur before they go, or for what came while they were in it', async () => {
    await start()
    await register(1)
    const laptop = await register(2)
    await beat('t1', { device: laptop, active: false, here: true })
    tell!({ kind: 'note', note })
    tell!({ kind: 'note', note: { ...note, tag: 'murmur:chat:c3', href: '/chat/atlas/c3' } })
    // Back in Murmur, on another chat.
    await beat('t1', { device: laptop, active: true, here: true, viewing: 'murmur:chat:other' })
    tell!({ kind: 'note', note: { ...note, tag: 'murmur:chat:c4', href: '/chat/atlas/c4' } })
    await beat('t1', { device: laptop, active: false, here: true })
    await beat('t1', { device: laptop, active: false, here: false })
    expect(to()).toEqual(['device-2', 'device-2', 'device-2'])
  })

  it('the others, once the computer they were at goes quiet (asleep, say)', async () => {
    await start()
    await register(1)
    const laptop = await register(2)
    await beat('t1', { device: laptop, active: false, here: true })
    tell!({ kind: 'note', note })
    expect(to()).toEqual(['device-2'])
    const now = Date.now
    Date.now = () => now() + TAB_TTL_MS + 1
    try {
      await beat('t2', { active: false, here: false })
    } finally {
      Date.now = now
    }
    expect(to()).toEqual(['device-2', 'device-1'])
  })

  it('every device again once the tab they were using goes quiet', async () => {
    await start()
    const phone = await register(1)
    await beat('t1', { device: phone, active: true, viewing: 'murmur:chat:c1' })
    const now = Date.now
    Date.now = () => now() + TAB_TTL_MS + 1
    try {
      tell!({ kind: 'note', note })
    } finally {
      Date.now = now
    }
    expect(to()).toEqual(['device-1'])
  })
})

describe('each push', () => {
  it('wakes a sleeping phone, reply or question; a question keeps for an hour, a reply for a day', async () => {
    await start()
    await register(1)
    tell!({ kind: 'note', note })
    tell!({ kind: 'ask', key: 'srq-1', note: ask })
    expect(pushes.map((p) => [p.urgency, p.ttl])).toEqual([
      ['high', 24 * 60 * 60],
      ['high', 60 * 60],
    ])
  })
})

describe('catching up', () => {
  const shownOn = async (n: number, id?: string) =>
    ((await (await post('/murmur/notifications/shown', { endpoint: subscription(n).endpoint, id })).json()) as { missed: { body: string; data: { id: string } }[] }).missed
  const idOf = (i: number) => pushes[i].payload.notification.data.id as string
  const reply = (chat: string, body: string): Moment => ({ kind: 'note', note: { ...note, body, tag: `murmur:chat:${chat}`, href: `/chat/atlas/${chat}` } })

  it('a device that shows one note is handed the others it was sent, oldest first, once', async () => {
    await start()
    await register(1)
    tell!(reply('a', 'First'))
    tell!(reply('b', 'Second'))
    tell!(reply('c', 'Third'))
    const missed = await shownOn(1, idOf(0))
    expect(missed.map((m) => m.body)).toEqual(['Second', 'Third'])
    expect(missed[0]).toMatchObject({ tag: 'murmur:chat:b', navigate: 'https://umbrel.local/chat/atlas/b?hermes=env', data: { id: idOf(1) } })
    expect(await shownOn(1, idOf(1))).toEqual([])
  })

  it('a question says so, so it still buzzes when it comes by a catch-up', async () => {
    await start()
    await register(1)
    tell!(reply('a', 'First'))
    tell!({ kind: 'ask', key: 'srq-1', note: ask })
    const [question] = await shownOn(1, idOf(0))
    expect(question).toMatchObject({ body: ask.body, data: { ask: true } })
    expect(pushes[0].payload.notification.data).not.toHaveProperty('ask')
    expect(pushes[1].payload.notification.data).toMatchObject({ ask: true })
  })

  it('only the newest note for each chat', async () => {
    await start()
    await register(1)
    tell!(reply('a', 'Working on it'))
    tell!(reply('b', 'Other'))
    tell!(reply('a', 'Done'))
    expect((await shownOn(1, idOf(1))).map((m) => m.body)).toEqual(['Done'])
  })

  it('leaves out a question since answered, and a chat since looked at', async () => {
    await start()
    await register(1)
    const laptop = await register(2)
    tell!({ kind: 'ask', key: 'srq-1', note: ask })
    tell!(reply('a', 'Seen on the laptop'))
    tell!(reply('b', 'Still news'))
    tell!({ kind: 'answered', key: 'srq-1' })
    await beat('t1', { device: laptop, active: true, viewing: 'murmur:chat:a' })
    expect((await shownOn(1)).map((m) => m.body)).toEqual(['Still news'])
  })

  it('nothing for a device Murmur doesn’t know, or one it forgot', async () => {
    await start()
    const phone = await register(1)
    tell!(reply('a', 'First'))
    tell!(reply('b', 'Second'))
    expect(await shownOn(9)).toEqual([])
    await fetch(`${base}/murmur/notifications/devices/${phone}`, { method: 'DELETE', headers: { origin: 'https://umbrel.local' } })
    expect(await shownOn(1)).toEqual([])
  })

  it('says which device it is', async () => {
    await start()
    expect((await post('/murmur/notifications/shown', {})).status).toBe(422)
  })
})

describe('questions', () => {
  it('are told everywhere, once, when the person goes away without answering', async () => {
    await start()
    await register(1)
    const laptop = await register(2)
    await beat('t1', { device: laptop, active: true, viewing: 'murmur:chat:c2' })
    tell!({ kind: 'ask', key: 'srq-1', note: ask })
    expect(pushes).toEqual([])

    await beat('t1', { device: laptop, active: false })
    expect(to()).toEqual(['device-1', 'device-2'])
    expect(pushes[0].urgency).toBe('high')

    await beat('t1', { device: laptop, active: true })
    await post('/murmur/presence', { tab: 't1', gone: true })
    expect(pushes).toHaveLength(2)
  })

  it('wait, like replies, while the person’s still at a device', async () => {
    await start()
    await register(1)
    const laptop = await register(2)
    await beat('t1', { device: laptop, active: false, here: true })
    tell!({ kind: 'ask', key: 'srq-1', note: ask })
    expect(to()).toEqual(['device-2'])
    await beat('t1', { device: laptop, active: false, here: false })
    expect(to()).toEqual(['device-2', 'device-1', 'device-2'])
    expect(pushes.every((p) => p.ttl === 60 * 60)).toBe(true)
  })

  it('not once they’re answered', async () => {
    await start()
    const laptop = await register(2)
    await beat('t1', { device: laptop, active: true, viewing: 'murmur:chat:c2' })
    tell!({ kind: 'ask', key: 'srq-1', note: ask })
    tell!({ kind: 'answered', key: 'srq-1' })
    await post('/murmur/presence', { tab: 't1', gone: true })
    expect(pushes).toEqual([])
  })
})

describe('the desktop app', () => {
  it('shows notes itself, as a device like any other', async () => {
    await start({ native: true })
    expect(await (await post('/murmur/notifications/devices', { native: true })).json()).toEqual({ device: 'desktop' })
    expect(watching).toBe(1)
    await register(1)
    await beat('t1', { device: 'desktop', active: true })
    tell!({ kind: 'note', note })
    expect(shown).toEqual([{ ...note, hermes: 'env' }])
    expect(pushes).toEqual([])
    await fetch(`${base}/murmur/notifications/devices/desktop`, { method: 'DELETE' })
    await post('/murmur/presence', { tab: 't1', gone: true })
    tell!({ kind: 'note', note })
    expect(shown).toHaveLength(1)
    expect(to()).toEqual(['device-1'])
  })
})
