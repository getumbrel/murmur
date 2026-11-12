import { describe, expect, it, vi } from 'vitest'

const rpc = vi.fn((..._args: unknown[]) => Promise.resolve({}))
const heard: ((ev: unknown) => void)[] = []
vi.mock('@/hermes/gateway', () => ({
  rpc: (...args: unknown[]) => rpc(...args),
  gateway: { onEvent: (fn: (ev: unknown) => void) => heard.push(fn), onState: () => {} },
}))
vi.mock('@/hermes/rest', () => ({ api: { get: vi.fn(), put: vi.fn() } }))

const { SCREEN_PLUGIN_SOURCE, addScreenPlugin } = await import('./screen')

describe('murmur-screen for a Hermes without it', () => {
  it('is installed with Hermes’s own installer, at the pinned commit, once however often it’s asked for', async () => {
    await Promise.all([addScreenPlugin('scout'), addScreenPlugin('scout')])
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(
      'plugins.manage',
      {
        action: 'install',
        identifier: 'getumbrel/hermes-agent-umbrel/umbrel-context/plugins/murmur-screen',
        ref: SCREEN_PLUGIN_SOURCE.ref,
        enable: true,
        profile: 'scout',
      },
      300_000,
    )
  })

  it('is pinned to a full commit, the only ref Hermes’s installer takes', () => {
    expect(SCREEN_PLUGIN_SOURCE.ref).toMatch(/^[0-9a-f]{40}$/)
  })

  it('stays quiet when it can’t be added, and tries again next time', async () => {
    rpc.mockClear()
    rpc.mockRejectedValueOnce(new Error('no way to github.com'))
    await expect(addScreenPlugin('default')).resolves.toBeUndefined()
    await addScreenPlugin('default')
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
