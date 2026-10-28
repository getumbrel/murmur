// Models (src/state/models.ts, readiness.ts, use-models.ts): finding and
// connecting a model server the way onboarding does, switching models, and
// the readiness check. The fake model stands in for Ollama or LM Studio.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { connectServer, findServer, setMainModel, updateServer, type Service } from '@/state/models'
import { MODEL_KEY, MODELS } from './fake-model'
import { api, connect, modelRequests, newChat, turn, type Socket } from './client'

let socket: Socket
const forHermes = inject('model').forHermes

beforeAll(async () => {
  startGateway()
  socket = await connect()
})
afterAll(async () => {
  // Leave the main agent on the model the other files expect.
  const { providers } = await api.get('/api/model/options')
  await setMainModel(providers.find((p: { is_user_defined: boolean }) => p.is_user_defined).slug, MODELS[0])
  socket?.close()
  stopGateway()
})

describe('a model server', () => {
  it('is found at its address, with its models', async () => {
    const server = await findServer(forHermes.replace(/\/v1$/, ''))
    expect(server.baseUrl).toBe(forHermes)
    expect(server.models.map((m) => m.id)).toEqual(MODELS)
  })

  it('is reported unreachable when nothing answers', async () => {
    const res = await api.post('/api/providers/validate', { key: 'OPENAI_BASE_URL', value: 'http://host.docker.internal:9/v1' })
    expect(res).toMatchObject({ reachable: false })
    await expect(findServer('host.docker.internal:9')).rejects.toThrow(/Couldn’t reach/)
  })

  it('is connected as the main model, once, however often it’s picked', async () => {
    const server = await findServer(forHermes)
    await connectServer(server, server.models[1])
    await connectServer(server, server.models[1])
    const { endpoints, current } = await api.get('/api/providers/custom-endpoints')
    expect(endpoints.filter((e: { base_url: string }) => e.base_url === forHermes)).toHaveLength(1)
    expect(endpoints[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), base_url: forHermes, model: expect.any(String) })
    expect(current).toMatchObject({ model: MODELS[1] })
  })
})

describe('a model server that wants a key', () => {
  const keyed = forHermes.replace(/\/v1$/, '/keyed/v1')
  type Saved = { id: string; name: string; base_url: string; model: string; has_api_key: boolean; api_key_preview: string | null }
  const saved = async () => (await api.get('/api/providers/custom-endpoints')).endpoints as Saved[]
  /** The keyed server, as Settings → Models sees it. */
  const service = async (): Promise<Service> => {
    const e = (await saved()).find((e) => e.base_url.includes('/keyed') || e.name === 'Moved')!
    const { provider } = await api.get('/api/model/options')
    return { slug: e.id, name: e.name, detail: '', models: MODELS, current: provider === e.id, server: { id: e.id, baseUrl: e.base_url, hasKey: e.has_api_key, model: e.model } }
  }

  // Back to the fake model the way the tests before left it.
  afterAll(async () => {
    for (const e of await saved()) if (e.base_url.includes('/keyed') || e.name === 'Moved') await api.delete(`/api/providers/custom-endpoints/${e.id}`)
    await setMainModel((await saved()).find((e) => e.base_url === forHermes)!.id, MODELS[1])
  })

  it('asks for one, turns a wrong one down, and lists its models for the right one', async () => {
    await expect(findServer(keyed)).rejects.toMatchObject({ kind: 'needs-key', field: 'key' })
    await expect(findServer(keyed, 'not-the-key')).rejects.toMatchObject({ kind: 'bad-key' })
    const server = await findServer(keyed, MODEL_KEY)
    expect(server).toMatchObject({ baseUrl: keyed, apiKey: MODEL_KEY })
    expect(server.models.map((m) => m.id)).toEqual(MODELS)
  })

  it('is saved with its key, which chats carry and Hermes never hands back', async () => {
    const server = await findServer(keyed, MODEL_KEY)
    await connectServer(server, server.models[0])
    const endpoints = await saved()
    expect(endpoints.find((e) => e.base_url === keyed)).toMatchObject({ has_api_key: true, model: MODELS[0] })
    expect(JSON.stringify(endpoints)).not.toContain(MODEL_KEY)
    expect(JSON.stringify(await api.get('/api/env'))).not.toContain(MODEL_KEY)

    const { runtime } = await newChat(socket)
    await turn(socket, runtime, 'Hi [[say: through a key]]')
    const last = (await modelRequests()).at(-1)
    expect(last).toMatchObject({ path: '/v1/chat/completions', auth: `Bearer ${MODEL_KEY}` })
  })

  it('takes a new key, and lets one go only where it isn’t needed', async () => {
    await expect(updateServer(await service(), { address: keyed, apiKey: 'not-the-key' })).rejects.toMatchObject({ kind: 'bad-key' })
    await expect(updateServer(await service(), { address: keyed, apiKey: '' })).rejects.toMatchObject({ kind: 'needs-key' })
    await updateServer(await service(), { address: keyed, apiKey: MODEL_KEY })
    expect((await saved()).find((e) => e.base_url === keyed)).toMatchObject({ has_api_key: true })

    // Moved somewhere that wants no key, it keeps its name and the main agent follows it.
    const before = await service()
    await updateServer({ ...before, name: 'Moved' }, { address: forHermes, apiKey: '' }, MODELS[1])
    const moved = (await saved()).find((e) => e.id === before.slug)
    expect(moved).toMatchObject({ name: 'Moved', base_url: forHermes, has_api_key: false })
    expect(await api.get('/api/model/options')).toMatchObject({ provider: before.slug, model: MODELS[1] })
  })
})

describe('the model list', () => {
  it('has each service with its models, and which is current', async () => {
    const options = await api.get('/api/model/options')
    const row = options.providers.find((p: { is_user_defined: boolean }) => p.is_user_defined)
    expect(row).toMatchObject({
      slug: expect.any(String),
      name: expect.any(String),
      is_current: true,
      models: MODELS,
      authenticated: true,
      source: expect.any(String),
      aliases: expect.any(Array),
      capabilities: { [MODELS[0]]: { reasoning: expect.any(Boolean) } },
    })
    expect(options).toMatchObject({ model: expect.any(String), provider: row.slug })
  })

  it('lists sign-ins and keys Murmur can offer', async () => {
    const oauth = await api.get('/api/providers/oauth')
    expect(oauth.providers).toContainEqual(expect.objectContaining({ id: 'openai-codex', status: expect.objectContaining({ logged_in: false }) }))
    const env = await api.get('/api/env')
    for (const key of ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY']) {
      expect(env[key], key).toMatchObject({ is_set: false, category: 'provider' })
    }
  })

  it('switches the main model, and recommends one for a service', async () => {
    const options = await api.get('/api/model/options')
    const slug = options.provider
    expect(await setMainModel(slug, MODELS[0])).toBe(true)
    expect(await api.get('/api/model/info')).toMatchObject({ model: MODELS[0] })
    expect(await api.get(`/api/model/recommended-default?provider=${slug}`)).toMatchObject({ model: expect.any(String) })
  })
})

describe('readiness', () => {
  it('reports a working model', async () => {
    expect(await socket.request('setup.runtime_check', { profile: 'default' }, 20_000)).toMatchObject({ ok: true, model: MODELS[0], provider: expect.any(String) })
    expect(await socket.request('setup.status', {})).toMatchObject({ provider_configured: true })
  })

  it('reads and sets the thinking level', async () => {
    const before = await socket.request('config.get', { profile: 'default', key: 'reasoning' })
    expect(before.value).toEqual(expect.any(String))
    await socket.request('config.set', { profile: 'default', key: 'reasoning', value: 'low', scope: 'global' })
    expect((await socket.request('config.get', { profile: 'default', key: 'reasoning' })).value).toBe('low')
    await socket.request('config.set', { profile: 'default', key: 'reasoning', value: before.value, scope: 'global' })
  })
})

describe('models on this machine', () => {
  it('reports the local runtime’s status', async () => {
    const res = await api.call('GET', '/api/local-models/status')
    // Murmur hides the option when Hermes answers 404 or 405.
    if (res.status === 404 || res.status === 405) return
    expect(res.body).toMatchObject({ runtime_installed: expect.any(Boolean), models: expect.any(Array), loaded_models: expect.any(Object) })
  })
})
