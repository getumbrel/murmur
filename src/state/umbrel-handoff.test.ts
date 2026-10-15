import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: class extends Error {} }))
vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn() }))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('@/lib/upkeep', () => ({ upkeep: () => Promise.resolve(), rememberedSet: () => new Set() }))

const KEY = `umbrelmcp_${'a1'.repeat(16)}_${'b2'.repeat(32)}`

/** Murmur opened from umbrelOS's "Connect in Murmur", with the key in the fragment. */
async function openWith(hash: string) {
  vi.resetModules()
  const replaceState = vi.fn()
  vi.stubGlobal('location', { hash, pathname: '/settings/umbrel', search: '' })
  vi.stubGlobal('history', { state: null, replaceState })
  return { ...(await import('./umbrel-mcp')), replaceState }
}

afterEach(() => vi.unstubAllGlobals())

describe('a key handed over by umbrelOS', () => {
  it('is wiped from the address the moment Murmur loads', async () => {
    const { replaceState } = await openWith(`#token=${KEY}&url=http%3A%2F%2F10.21.0.1%2Fmcp`)
    expect(replaceState).toHaveBeenCalledWith(null, '', '/settings/umbrel')
  })

  it('survives a render React throws away, and is gone once the screen that showed it clears it', async () => {
    const { handoffKey, clearHandoffKey } = await openWith(`#token=${KEY}`)
    // A suspended first render calls the state initializer, then the real one calls it again.
    expect(handoffKey()).toBe(KEY)
    expect(handoffKey()).toBe(KEY)
    clearHandoffKey()
    expect(handoffKey()).toBeNull()
  })

  it('takes only a well-formed key', async () => {
    const { handoffKey } = await openWith('#token=umbrelmcp_nope')
    expect(handoffKey()).toBeNull()
  })
})
