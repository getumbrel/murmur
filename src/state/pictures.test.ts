import { describe, expect, it, vi } from 'vitest'

// Only the list logic is under test; the rest needs a browser and a Hermes.
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('@/hermes/rest', () => ({ api: {} }))
vi.mock('@/hermes/gateway', () => ({ rpc: () => {} }))
vi.mock('@/hermes/compat', () => ({ listProfileNames: () => [] }))
vi.mock('@/lib/upkeep', () => ({ upkeep: () => {}, rememberedSet: () => new Set() }))

const { nextDefer } = await import('./pictures')

// Hermes 0.22's defaults, in short.
const DEFAULTS = ['browser_vault', 'image_generate', 'manage_catalog', 'set_theme', 'text_to_speech']

describe('the image tool, always to hand', () => {
  it('comes out of a list that has it', () => {
    expect(nextDefer(DEFAULTS, DEFAULTS)).toEqual(['browser_vault', 'manage_catalog', 'set_theme', 'text_to_speech'])
  })

  it('catches a list an older Hermes wrote up with this one’s defaults', () => {
    // Written by Murmur on 0.21: no image_generate, an old default, and one the agent added.
    expect(nextDefer(['apply_layout', 'text_to_speech', 'my_tool'], DEFAULTS)).toEqual([
      'browser_vault',
      'manage_catalog',
      'set_theme',
      'text_to_speech',
      'my_tool',
    ])
  })

  it('leaves a list that’s already right', () => {
    expect(nextDefer(['text_to_speech', 'set_theme', 'manage_catalog', 'browser_vault'], DEFAULTS)).toBeNull()
    expect(nextDefer(undefined, DEFAULTS)).toBeNull()
  })

  it('without the defaults, only takes the image tool out', () => {
    expect(nextDefer(['image_generate', 'apply_layout'], undefined)).toEqual(['apply_layout'])
    expect(nextDefer(['apply_layout'], undefined)).toBeNull()
  })
})
