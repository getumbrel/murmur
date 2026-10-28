// Apps through Nous (src/state/hosted-apps.ts): Hermes's connectors.* methods
// the way Murmur uses them, with every agent's connections toolset in step.
//
// Never a Nous account. Hermes makes one (a guest identity at Nous Research)
// on the first connect, so this file only calls a method that could make one
// where Hermes refuses it before getting that far: parameters it can't read,
// or an agent with apps through Nous switched off (and guests switched off too,
// in case a later Hermes checks in another order). Reading must never make
// one, and that's checked on disk.
//
// Nous's catalog comes from Nous over the internet. Offline, Hermes answers
// that it's unavailable: the catalog test checks that answer is the one Murmur
// reads as "unreachable", then skips the rest. CI is online, so there it runs.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { composeSoul, createAgent } from '@/state/agents'
import type { CatalogApp } from '@/state/apps'
import { arrangeApps, readHostedAccounts, readHostedCatalog, reasonOf } from '@/state/hosted-apps'
import { CONSENT_KEY, forgetHostedConsent, hostedConsent, recordHostedConsent } from '@/state/hosted-apps-consent'
import { allowHostedApps, hideDesktopToolsets, HOSTED_TOOLSET } from '@/state/toolsets'
import { agentName, api, connect, modelRequests, newChat, q, turn, type Socket } from './client'

const run = promisify(execFile)
const ACCOUNT = { type: 'account' }
const SLUG = /^[a-z0-9][a-z0-9_-]*$/

let socket: Socket
const made: string[] = []

beforeAll(async () => {
  startGateway()
  socket = await connect()
})
afterAll(async () => {
  await socket.request('profiles.configure', { name: 'default', ui_meta: { [CONSENT_KEY]: null } }).catch(() => {})
  for (const agent of made) await api.call('DELETE', `/api/profiles/${agent}`)
  socket?.close()
  stopGateway()
})

/** Whether Hermes has a Nous identity anywhere on disk: the main agent's auth.json, or the store all agents share. */
async function nousOnDisk() {
  const script = [
    'import json, os',
    'auth = "/opt/data/auth.json"',
    'store = json.load(open(auth)) if os.path.exists(auth) else {}',
    'print(json.dumps({"auth": "nous" in (store.get("providers") or {}), "shared": os.path.exists("/opt/data/shared/nous_auth.json")}))',
  ].join('\n')
  const { stdout } = await run('docker', ['exec', inject('hermes').container, 'python', '-c', script])
  return JSON.parse(stdout) as { auth: boolean; shared: boolean }
}

/** How long `call` takes, in ms, and what it answered. */
async function timed<T>(call: () => Promise<T>) {
  const start = performance.now()
  const value = await call()
  return { value, ms: performance.now() - start }
}

describe('reading, before any app is connected', () => {
  it('lists no accounts and nothing connected, at once, without asking Nous', async () => {
    const list = await timed(() => socket.request('connectors.list', { profile: 'default', owner: ACCOUNT }))
    expect(list.value).toEqual({ available: true, connectors: [] })
    const accounts = await timed(() => socket.request('connectors.accounts', { profile: 'default' }))
    expect(accounts.value).toEqual({ accounts: [] })
    // No identity means no call to Nous: well under a round trip to anywhere.
    expect(list.ms).toBeLessThan(3000)
    expect(accounts.ms).toBeLessThan(3000)
    expect(await readHostedAccounts()).toEqual([])
  })

  it('lists Nous’s public catalog, in the shape Murmur reads', async ({ skip }) => {
    let raw: { connectors: Record<string, unknown>[] }
    try {
      raw = await socket.request('connectors.catalog', { profile: 'default' })
    } catch (error) {
      // Offline: the answer Murmur shows as "can't reach Nous right now".
      expect((error as { code?: number }).code).toBe(5034)
      expect(reasonOf(error)).toBe('CATALOG_UNAVAILABLE')
      expect(await readHostedCatalog()).toEqual({ available: true, apps: [], unreachable: true })
      return skip('Nous Research can’t be reached from here')
    }
    expect(raw.connectors.length).toBeGreaterThan(0)
    for (const row of raw.connectors) {
      expect(Object.keys(row).sort()).toEqual(['category', 'description', 'logo_url', 'name', 'slug'])
      expect(row).toMatchObject({
        slug: expect.stringMatching(SLUG),
        name: expect.any(String),
        description: expect.any(String),
        category: expect.any(String),
      })
    }

    const catalog = await readHostedCatalog()
    expect(catalog.available).toBe(true)
    expect(catalog.apps.length).toBe(raw.connectors.length)

    // Merged with Hermes's own catalog, no app shows twice.
    const direct = (await api.get<{ entries: CatalogApp[] }>('/api/mcp/catalog')).entries
    const { everyday, developer } = arrangeApps(direct, catalog.apps, (n) => n)
    const tiles = [...everyday, ...developer]
    const brand = (tile: (typeof tiles)[number]) =>
      (tile.kind === 'direct' ? tile.app.name : tile.app.slug)
        .toLowerCase()
        .replace(/_mcp$/, '')
        .replace(/[^a-z0-9]/g, '')
    const brands = tiles.map(brand)
    expect(brands.length).toBe(new Set(brands).size)
    expect(tiles.filter((t) => t.kind === 'hosted').length).toBeGreaterThan(0)
    // Asana can't sign in through Hermes; it comes through Nous when Nous has it.
    if (catalog.apps.some((a) => a.slug === 'asana'))
      expect(tiles.find((t) => brand(t) === 'asana')?.kind).toBe('hosted')
  })

  it('makes no Nous identity', async () => {
    expect(await nousOnDisk()).toEqual({ auth: false, shared: false })
    const status = await socket.request<{ has_guest: boolean }>('free_tier.status', { profile: 'default' })
    expect(status.has_guest).toBe(false)
  })
})

describe('connecting, as far as it goes without Nous', () => {
  it('refuses a connect it can’t read, before anything else', async () => {
    for (const params of [
      { profile: 'default', owner: ACCOUNT, connectors: ['Not a slug'] },
      { profile: 'default', owner: ACCOUNT, connectors: [] },
      { profile: 'default', connectors: ['slack'] },
      // A repair names one account of one app.
      { profile: 'default', owner: ACCOUNT, connectors: ['slack', 'box'], reconnect: true, connection_id: 'ca_1' },
    ]) {
      const error = await socket.failure('connectors.connect', params)
      expect(error.code, JSON.stringify(params)).toBe(4000)
      expect(reasonOf(error)).toBe('INVALID_PARAMS')
    }
    expect(await nousOnDisk()).toEqual({ auth: false, shared: false })
  })

  it('answers for an operation it doesn’t have', async () => {
    const op = { profile: 'default', owner: ACCOUNT, op_id: 'murmur-contract' }
    for (const [method, params] of [
      ['connectors.operation.status', op],
      ['connectors.operation.wake', op],
      ['connection.respond', { ...op, result: { settled_by: 'continue' } }],
    ] as const) {
      const error = await socket.failure(method, params)
      expect(error.code, method).toBe(4004)
      expect(reasonOf(error), method).toBe('UNKNOWN_OPERATION')
    }
  })

  it('refuses a cancel it can’t read', async () => {
    const error = await socket.failure('connection.respond', {
      profile: 'default',
      owner: ACCOUNT,
      op_id: 'murmur-contract',
      result: { settled_by: 'whenever' },
    })
    expect(error.code).toBe(4002)
    expect(reasonOf(error)).toBe('INVALID_ANSWER')
  })
})

describe('an agent with apps through Nous switched off in Hermes', () => {
  const agent = agentName('nous-off')

  beforeAll(async () => {
    await socket.request('profiles.create', { name: agent, share_auth: true }, 120_000)
    made.push(agent)
    await api.put(`/api/config?${q(agent)}`, {
      config: { tools: { connectors: { enabled: false } }, nous: { guest: false } },
    })
    const config = await api.get(`/api/config?${q(agent)}&include_defaults=false`)
    expect(config).toMatchObject({ tools: { connectors: { enabled: false } }, nous: { guest: false } })
  })

  it('lists nothing, and says they’re unavailable', async () => {
    expect(await socket.request('connectors.list', { profile: agent, owner: ACCOUNT })).toEqual({
      available: false,
      connectors: [],
    })
    for (const [method, params] of [
      ['connectors.catalog', { profile: agent }],
      ['connectors.accounts', { profile: agent }],
      ['connectors.connect', { profile: agent, owner: ACCOUNT, connectors: ['slack'] }],
      ['connectors.accounts.remove', { profile: agent, connection_id: 'ca_contract' }],
      ['connectors.operation.status', { profile: agent, owner: ACCOUNT, op_id: 'murmur-contract' }],
    ] as const) {
      const error = await socket.failure(method, params)
      expect(error.code, method).toBe(4031)
      expect(reasonOf(error), method).toBe('CONNECTORS_UNAVAILABLE')
    }
    expect(await nousOnDisk()).toEqual({ auth: false, shared: false })
  })
})

describe('agents and apps through Nous', () => {
  /** The tools Hermes offered the model on its last request. */
  async function lastTools() {
    const last = (await modelRequests()).filter((r) => r.body.tools?.length).at(-1)
    const tools = (last?.body.tools ?? []) as { function: { name: string; description: string } }[]
    return new Map(tools.map((t) => [t.function.name, t.function.description]))
  }
  const disabled = async (agent: string) =>
    ((await api.get(`/api/config?${q(agent)}&include_defaults=false`)).agent?.disabled_toolsets ?? []) as string[]
  const toolset = async (agent: string) =>
    (await api.get<{ name: string; enabled: boolean }[]>(`/api/tools/toolsets?${q(agent)}`)).find(
      (t) => t.name === HOSTED_TOOLSET,
    )
  // A chat with each kind of agent, for the cards below.
  const chats = { off: '', on: '' }

  it('keeps a new agent from reaching them until the person agrees', async () => {
    forgetHostedConsent()
    expect(await hostedConsent()).toBe(false)
    const agent = await createAgent({
      name: `Nous ${Date.now().toString(36)}`,
      hue: 200,
      role: 'Helps',
      soul: composeSoul('Nous', 'Helps', 'warm'),
      template: 'scout',
    })
    made.push(agent)
    // createAgent puts it in step without waiting.
    for (let i = 0; i < 40 && !(await disabled(agent)).includes(HOSTED_TOOLSET); i++)
      await new Promise((r) => setTimeout(r, 250))
    expect(await disabled(agent)).toEqual(expect.arrayContaining(['catalog', 'project', HOSTED_TOOLSET]))
    expect((await toolset(agent))?.enabled).toBe(false)

    // So the agent has no manage_connections, and no way to reach Nous's apps.
    const { runtime } = await newChat(socket, agent)
    chats.off = runtime
    await turn(socket, runtime, 'Hello', agent)
    const tools = await lastTools()
    expect(tools.has('manage_connections')).toBe(false)
    expect([...tools.values()].join('\n')).not.toContain('connectors__')
  })

  it('puts an agent made elsewhere in step, and lets every agent reach them once the person agrees', async () => {
    const agent = agentName('nous-on')
    await socket.request('profiles.create', { name: agent, share_auth: true }, 120_000)
    made.push(agent)
    expect(await disabled(agent)).not.toContain(HOSTED_TOOLSET)
    // Hermes gives a new agent manage_connections: with it, a chat could make a Nous account.
    const before = await newChat(socket, agent)
    await turn(socket, before.runtime, 'Hello', agent)
    expect((await lastTools()).has('manage_connections')).toBe(true)

    await hideDesktopToolsets(agent)
    expect(await disabled(agent)).toEqual(expect.arrayContaining(['catalog', 'project', HOSTED_TOOLSET]))

    await recordHostedConsent()
    forgetHostedConsent()
    expect(await hostedConsent()).toBe(true)
    await allowHostedApps([agent])
    expect(await disabled(agent)).toEqual(expect.arrayContaining(['catalog', 'project']))
    expect(await disabled(agent)).not.toContain(HOSTED_TOOLSET)
    expect((await toolset(agent))?.enabled).toBe(true)

    // manage_connections is what lets an agent reach the apps connected through
    // Nous: tool_search only searches them, and tool_call only runs them, while
    // it's among the agent's tools (tools/connectors/search.py: connections_in_scope).
    const after = await newChat(socket, agent)
    chats.on = after.runtime
    await turn(socket, after.runtime, 'Hello', agent)
    const tools = await lastTools()
    expect(tools.has('manage_connections')).toBe(true)
    expect(tools.get('tool_search')).toContain('connectors__')

    // Still no Nous account: none is made until an app is connected.
    expect(await nousOnDisk()).toEqual({ auth: false, shared: false })
  })

  it('answers a chat’s card only for that chat, and only while one is open', async () => {
    // What state/hosted-apps-chat.ts sends: a new link for an app on the card, a skip, a Done.
    const connect = (session_id: string) =>
      socket.failure('connectors.connect', { owner: { type: 'session', session_id }, connectors: ['slack'] })
    const respond = (session_id: string) =>
      socket.failure('connection.respond', {
        owner: { type: 'session', session_id },
        op_id: 'murmur-contract',
        result: { settled_by: 'continue' },
      })

    for (const error of [await connect('r-no-such-chat'), await respond('r-no-such-chat')]) {
      expect(error.code).toBe(4001)
      expect(reasonOf(error)).toBe('NOT_OWNER')
    }
    // An agent kept from apps through Nous can't reach them from its chat either.
    const off = await connect(chats.off)
    expect(off.code).toBe(4031)
    expect(reasonOf(off)).toBe('CONNECTORS_UNAVAILABLE')
    // A chat's connect only makes a new link for a card that's open: it never starts one.
    const on = await connect(chats.on)
    expect(on.code).toBe(4004)
    expect(reasonOf(on)).toBe('UNKNOWN_OPERATION')
    const answer = await respond(chats.on)
    expect(answer.code).toBe(4004)
    expect(reasonOf(answer)).toBe('UNKNOWN_OPERATION')
    expect(await nousOnDisk()).toEqual({ auth: false, shared: false })
  })

  it('keeps the answer on the main agent, where every browser reads it', async () => {
    const { profiles } = await socket.request<{
      profiles: { name: string; is_default: boolean; ui_meta?: Record<string, unknown> }[]
    }>('profiles.list')
    const main = profiles.find((p) => p.is_default)
    expect(main?.name).toBe('default')
    expect(main?.ui_meta?.[CONSENT_KEY]).toEqual({ since: expect.any(Number) })
  })
})
