import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: class extends Error {} }))
vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn() }))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('@/lib/upkeep', () => ({ upkeep: () => Promise.resolve(), rememberedSet: () => new Set() }))

const { findUmbrelKey, maskKey } = await import('./umbrel-mcp')

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
