import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: { get: vi.fn(), put: vi.fn() }, HermesError: class extends Error {} }))
vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn() }))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('@/lib/upkeep', () => ({ upkeep: () => Promise.resolve(), rememberedSet: () => new Set() }))
vi.mock('@/state/connection', () => ({ useHermesConnection: vi.fn() }))

const { findUmbrelKey, maskKey, stopAskingFirst, umbrelOf } = await import('./umbrel-mcp')
const { api } = await import('@/hermes/rest')
const get = vi.mocked(api.get)
const put = vi.mocked(api.put)

const KEY = `umbrelmcp_${'a1'.repeat(16)}_${'b2'.repeat(32)}`

describe('an umbrelOS key', () => {
  it('is found in the message umbrelOS shows, in a snippet, or on its own', () => {
    const message = `Hey! My Umbrel has an MCP server. The HTTP endpoint is http://10.21.0.1/mcp and the auth header is Authorization: Bearer ${KEY}. Once it's set up, say hello.`
    expect(findUmbrelKey(message)).toBe(KEY)
    expect(findUmbrelKey(`mcp_servers:\n  umbrel:\n    headers:\n      Authorization: "Bearer ${KEY}"`)).toBe(KEY)
    expect(findUmbrelKey(`  ${KEY}\n`)).toBe(KEY)
  })

  it('is not anything that only looks like one', () => {
    expect(findUmbrelKey('umbrelmcp_123')).toBeNull()
    expect(findUmbrelKey(`umbrelmcp_${'z'.repeat(32)}_${'b2'.repeat(32)}`)).toBeNull()
    expect(findUmbrelKey('Say hello to my Umbrel')).toBeNull()
  })

  it('shows enough to recognise and no more', () => {
    expect(maskKey(KEY)).toBe(`umbrelmcp_a1a1…2b2b2`)
    expect(maskKey(KEY)).not.toContain('b2b2b2b2')
  })
})

describe('the Umbrel a Hermes runs on', () => {
  const page = { protocol: 'https:', hostname: 'umbrel.tail1234.ts.net' }

  it('is this Umbrel when Hermes is a container beside Murmur', () => {
    for (const url of ['http://murmur_hermes_1:9119', 'http://hermes-agent_web_1:18789'])
      expect(umbrelOf(url, page)).toEqual({ name: 'this Umbrel', settingsUrl: 'https://umbrel.tail1234.ts.net/settings/mcp' })
  })

  it('is your Umbrel, at Hermes’s own host, when Murmur runs somewhere else', () => {
    const desktop = { protocol: 'http:', hostname: '127.0.0.1' }
    expect(umbrelOf('http://umbrel.local:18789', desktop)).toEqual({ name: 'your Umbrel', settingsUrl: 'http://umbrel.local/settings/mcp' })
    expect(umbrelOf('http://192.168.1.20:18789', desktop).settingsUrl).toBe('http://192.168.1.20/settings/mcp')
  })
})

describe('an Umbrel connected by Murmur 0.5.1 to 0.7', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stops asking first', async () => {
    get.mockResolvedValueOnce({ mcp_servers: { umbrel: { url: 'http://10.21.0.1/mcp', trust: 'untrusted' } } })
    expect(await stopAskingFirst('ada')).toBe(true)
    expect(put).toHaveBeenCalledWith('/api/config?profile=ada', {
      config: { mcp_servers: { umbrel: { trust: 'full' } } },
    })
  })

  it('leaves any other trust, and agents without an Umbrel, alone', async () => {
    get.mockResolvedValueOnce({ mcp_servers: { umbrel: { url: 'http://10.21.0.1/mcp' } } })
    expect(await stopAskingFirst('ada')).toBe(false)
    get.mockResolvedValueOnce({ mcp_servers: { umbrel: { url: 'http://10.21.0.1/mcp', trust: 'full' } } })
    expect(await stopAskingFirst('ada')).toBe(false)
    get.mockResolvedValueOnce({ mcp_servers: { github: { trust: 'untrusted' } } })
    expect(await stopAskingFirst('ada')).toBe(false)
    get.mockResolvedValueOnce({})
    expect(await stopAskingFirst('ada')).toBe(false)
    expect(put).not.toHaveBeenCalled()
  })
})
