import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {} }))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('@/lib/upkeep', () => ({ upkeep: () => {}, rememberedSet: () => new Set() }))

const { hideDesktopToolsets, murmurDisplay, withHiddenToolsets } = await import('./toolsets')
const { api } = (await import('@/hermes/rest')) as unknown as { api: Record<string, unknown> }

describe('toolsets Murmur can’t show', () => {
  it('are added to what the agent already switched off', () => {
    expect(withHiddenToolsets(undefined)).toEqual(['catalog', 'project'])
    expect(withHiddenToolsets(['browser'])).toEqual(['browser', 'catalog', 'project'])
    expect(withHiddenToolsets('browser')).toEqual(['browser', 'catalog', 'project'])
    expect(withHiddenToolsets(['project'])).toEqual(['project', 'catalog'])
  })

  it('leave a list that has them', () => {
    expect(withHiddenToolsets(['project', 'catalog', 'browser'])).toBeNull()
  })
})

describe('desktop tips, tours and reactions', () => {
  it('switch tips and tours off and reactions on', () => {
    expect(murmurDisplay(undefined)).toEqual({ in_app_tips: false, in_app_tours: false, message_reactions: true })
    expect(murmurDisplay({ in_app_tips: true, message_reactions: true })).toEqual({
      in_app_tips: false,
      in_app_tours: false,
    })
  })

  it('leave an agent that was set not to react', () => {
    expect(murmurDisplay({ in_app_tips: false, in_app_tours: false, message_reactions: false })).toBeNull()
  })
})

describe('an agent’s config', () => {
  it('gets only the keys Murmur changes, merged into what’s there', async () => {
    const put = vi.fn(async (..._: unknown[]) => ({ ok: true }))
    Object.assign(api, {
      get: async () => ({ agent: { disabled_toolsets: ['browser'] }, display: { in_app_tips: false } }),
      put,
    })
    await hideDesktopToolsets('scout')
    expect(put).toHaveBeenCalledWith('/api/config?profile=scout', {
      config: {
        agent: { disabled_toolsets: ['browser', 'catalog', 'project'] },
        display: { in_app_tours: false, message_reactions: true },
      },
    })
  })

  it('is left alone once it’s in step', async () => {
    const put = vi.fn()
    Object.assign(api, {
      get: async () => ({
        agent: { disabled_toolsets: ['catalog', 'project'] },
        display: { in_app_tips: false, in_app_tours: false, message_reactions: true },
      }),
      put,
    })
    await hideDesktopToolsets('atlas')
    expect(put).not.toHaveBeenCalled()
  })
})
