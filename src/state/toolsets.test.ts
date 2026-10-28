import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {} }))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('@/lib/upkeep', () => ({ upkeep: () => {}, rememberedSet: () => new Set() }))
const hostedAppsAllowed = vi.fn(async () => false)
vi.mock('./hosted-apps-consent', () => ({ hostedAppsAllowed }))

const { allowHostedApps, hideDesktopToolsets, murmurDisplay, withHiddenToolsets } = await import('./toolsets')
const { api } = (await import('@/hermes/rest')) as unknown as { api: Record<string, unknown> }

beforeEach(() => hostedAppsAllowed.mockClear())

describe('toolsets Murmur can’t show', () => {
  it('are added to what the agent already switched off', () => {
    expect(withHiddenToolsets(undefined)).toEqual(['catalog', 'project', 'connections'])
    expect(withHiddenToolsets(['browser'])).toEqual(['browser', 'catalog', 'project', 'connections'])
    expect(withHiddenToolsets('browser')).toEqual(['browser', 'catalog', 'project', 'connections'])
    expect(withHiddenToolsets(['project'])).toEqual(['project', 'catalog', 'connections'])
  })

  it('leave a list that has them', () => {
    expect(withHiddenToolsets(['project', 'catalog', 'connections', 'browser'])).toBeNull()
  })
})

describe('apps through Nous', () => {
  it('stay out of reach until the person agrees, since an agent could make a Nous account otherwise', () => {
    expect(withHiddenToolsets(['catalog', 'project'], false)).toEqual(['catalog', 'project', 'connections'])
  })

  it('come within reach once they agree, keeping what else was switched off', () => {
    expect(withHiddenToolsets(['browser', 'connections', 'catalog', 'project'], true)).toEqual([
      'browser',
      'catalog',
      'project',
    ])
    expect(withHiddenToolsets(undefined, true)).toEqual(['catalog', 'project'])
    expect(withHiddenToolsets(['catalog', 'project'], true)).toBeNull()
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
    expect(hostedAppsAllowed).toHaveBeenCalled()
    expect(put).toHaveBeenCalledWith('/api/config?profile=scout', {
      config: {
        agent: { disabled_toolsets: ['browser', 'catalog', 'project', 'connections'] },
        display: { in_app_tours: false, message_reactions: true },
      },
    })
  })

  it('is left alone once it’s in step', async () => {
    const put = vi.fn()
    Object.assign(api, {
      get: async () => ({
        agent: { disabled_toolsets: ['catalog', 'project', 'connections'] },
        display: { in_app_tips: false, in_app_tours: false, message_reactions: true },
      }),
      put,
    })
    await hideDesktopToolsets('atlas')
    expect(put).not.toHaveBeenCalled()
  })

  it('gets apps through Nous back for every agent once the person agrees', async () => {
    const put = vi.fn(async (..._: unknown[]) => ({ ok: true }))
    Object.assign(api, {
      get: async () => ({
        agent: { disabled_toolsets: ['catalog', 'project', 'connections'] },
        display: { in_app_tips: false, in_app_tours: false, message_reactions: true },
      }),
      put,
    })
    await allowHostedApps(['default', 'scout'])
    expect(hostedAppsAllowed).not.toHaveBeenCalled()
    expect(put.mock.calls).toEqual([
      ['/api/config?profile=default', { config: { agent: { disabled_toolsets: ['catalog', 'project'] } } }],
      ['/api/config?profile=scout', { config: { agent: { disabled_toolsets: ['catalog', 'project'] } } }],
    ])
  })
})
