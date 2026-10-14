import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {} }))

const { withHiddenToolsets } = await import('./toolsets')

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
