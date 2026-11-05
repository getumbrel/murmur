import { describe, expect, it, vi } from 'vitest'

// Only the list logic is under test; the rest needs a Hermes.
vi.mock('@/hermes/rest', () => ({ api: {} }))

const { IMAGE_TOOL, PLAN_TOOL, nextDefer } = await import('./tool-search')

// Hermes 0.22's defaults, in short.
const DEFAULTS = ['browser_vault', 'image_generate', 'manage_catalog', 'set_theme', 'todo_list']
const PLAN = [PLAN_TOOL]
const BOTH = [PLAN_TOOL, IMAGE_TOOL]

describe('the plan, always to hand', () => {
  it('comes out of Hermes’s default list, for an agent that has none of its own', () => {
    expect(nextDefer(undefined, DEFAULTS, PLAN)).toEqual(['browser_vault', 'image_generate', 'manage_catalog', 'set_theme'])
  })

  it('comes out of the agent’s own list, keeping what it added', () => {
    expect(nextDefer([...DEFAULTS, 'my_tool'], DEFAULTS, PLAN)).toEqual([
      'browser_vault',
      'image_generate',
      'manage_catalog',
      'set_theme',
      'my_tool',
    ])
  })

  it('leaves a list that’s already right', () => {
    expect(nextDefer(['set_theme', 'manage_catalog', 'image_generate', 'browser_vault'], DEFAULTS, PLAN)).toBeNull()
  })

  it('leaves an agent set to keep every tool to hand', () => {
    expect(nextDefer([], DEFAULTS, PLAN)).toBeNull()
  })

  it('leaves an agent with no list when Hermes doesn’t say what its default is', () => {
    expect(nextDefer(undefined, undefined, PLAN)).toBeNull()
  })
})

describe('the image tool, to hand with pictures on', () => {
  it('comes out alongside the plan', () => {
    expect(nextDefer(DEFAULTS, DEFAULTS, BOTH)).toEqual(['browser_vault', 'manage_catalog', 'set_theme'])
  })

  it('catches a list an older Hermes wrote up with this one’s defaults', () => {
    // Written by Murmur on 0.21: no image_generate, an old default, and one the agent added.
    expect(nextDefer(['apply_layout', 'todo_list', 'my_tool'], DEFAULTS, BOTH)).toEqual([
      'browser_vault',
      'manage_catalog',
      'set_theme',
      'my_tool',
    ])
  })

  it('without the defaults, only takes the tools out', () => {
    expect(nextDefer(['image_generate', 'todo_list', 'apply_layout'], undefined, BOTH)).toEqual(['apply_layout'])
    expect(nextDefer(['apply_layout'], undefined, BOTH)).toBeNull()
  })
})
