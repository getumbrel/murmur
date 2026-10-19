// Models (src/state/models.ts, readiness.ts, use-models.ts): finding and
// connecting a model server the way onboarding does, switching models, and
// the readiness check. The fake model stands in for Ollama or LM Studio.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { connectLocal, findServer, setMainModel } from '@/state/models'
import { MODELS } from './fake-model'
import { api, connect, type Socket } from './client'

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
    await connectLocal(server, server.models[1])
    await connectLocal(server, server.models[1])
    const { endpoints, current } = await api.get('/api/providers/custom-endpoints')
    expect(endpoints.filter((e: { base_url: string }) => e.base_url === forHermes)).toHaveLength(1)
    expect(endpoints[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), base_url: forHermes, model: expect.any(String) })
    expect(current).toMatchObject({ model: MODELS[1] })
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
