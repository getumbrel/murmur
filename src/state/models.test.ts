import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, HermesError: class extends Error {} }))
vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn() }))
vi.mock('@/features/model/use-models', () => ({ freshenModels: vi.fn() }))

const { findLocalServers } = await import('./models')
const { api } = await import('@/hermes/rest')
const post = vi.mocked(api.post)

/** Murmur's server finding `beside`, and Hermes reaching what `answers` lists, with its models. */
function network(beside: unknown[], answers: Record<string, string[]>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ servers: beside }))))
  post.mockImplementation(async (_path: string, body: unknown) => {
    const url = (body as { value: string }).value
    const models = answers[url]
    return models ? { ok: true, reachable: true, models, resolved_base_url: url } : { ok: false, reachable: false }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('model servers Hermes can use without being told where', () => {
  it('Ollama and LM Studio on the computer Hermes runs on', async () => {
    network([], { 'http://localhost:11434/v1': ['qwen3:8b'], 'http://localhost:1234/v1': ['qwen3.5-9b'] })
    expect(await findLocalServers()).toEqual([
      { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', models: [{ id: 'qwen3:8b', size: null, parameters: null }] },
      { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', models: [{ id: 'qwen3.5-9b', size: null, parameters: null }] },
    ])
  })

  it('from inside Docker, on the computer around it', async () => {
    network([], { 'http://host.docker.internal:11434/v1': ['qwen3:8b'] })
    expect(await findLocalServers()).toMatchObject([{ name: 'Ollama', baseUrl: 'http://host.docker.internal:11434/v1' }])
  })

  it('Ollama beside it on an Umbrel, with its sizes, once however many ways Hermes reaches it', async () => {
    const ollama = {
      name: 'Ollama',
      baseUrl: 'http://ollama_ollama_1:11434/v1',
      models: [{ id: 'llama3.2:3b', size: 2_019_393_189, parameters: '3.2B' }],
    }
    network([ollama], { 'http://ollama_ollama_1:11434/v1': ['llama3.2:3b'], 'http://host.docker.internal:11434/v1': ['llama3.2:3b'] })
    expect(await findLocalServers()).toEqual([ollama])
  })

  it('not what Murmur’s server can reach but Hermes can’t, like an Umbrel’s Ollama for a Hermes on a laptop', async () => {
    network([{ name: 'Ollama', baseUrl: 'http://ollama_ollama_1:11434/v1', models: [] }], {})
    expect(await findLocalServers()).toEqual([])
  })
})
