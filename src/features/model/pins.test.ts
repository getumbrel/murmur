import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@/state/agents'
import { arrange, pinsOf } from './pins'
import type { ModelGroup } from './use-models'

vi.mock('@/state/agents', () => ({ agentsKey: ['agents'], useAgents: vi.fn() }))
vi.mock('@/state/records', () => ({}))

const model = (id: string) => ({ id, reasoning: true })
const groups: ModelGroup[] = [
  { provider: 'anthropic', name: 'Anthropic', models: [model('claude-fable-5.1'), model('claude-opus-5')] },
  {
    provider: 'openrouter',
    name: 'OpenRouter',
    models: [model('anthropic/claude-opus-5'), model('openai/gpt-6.1-sol')],
  },
]
const ids = (list: { id: string }[]) => list.map((m) => m.id)

describe('pinned models', () => {
  it('reads only well-formed pins, once each', () => {
    const main = { pinsMeta: ['anthropic::claude-opus-5', 42, 'junk', 'anthropic::claude-opus-5'] } as unknown as Agent
    expect(pinsOf(main)).toEqual(['anthropic::claude-opus-5'])
    expect(pinsOf({ pinsMeta: 'anthropic::claude-opus-5' } as unknown as Agent)).toEqual([])
    expect(pinsOf(undefined)).toEqual([])
  })

  it('lists pins first, in the order they were pinned, and in their services too', () => {
    const { pinned, groups: rest } = arrange(groups, ['openrouter::openai/gpt-6.1-sol', 'anthropic::claude-opus-5'])
    expect(ids(pinned)).toEqual(['openai/gpt-6.1-sol', 'claude-opus-5'])
    expect(rest.map((g) => [g.name, ids(g.models)])).toEqual([
      ['Anthropic', ['claude-fable-5.1', 'claude-opus-5']],
      ['OpenRouter', ['anthropic/claude-opus-5', 'openai/gpt-6.1-sol']],
    ])
  })

  it('names the service only when the pins come from more than one', () => {
    expect(arrange(groups, ['anthropic::claude-opus-5', 'openrouter::anthropic/claude-opus-5']).mixed).toBe(true)
    expect(arrange(groups, ['anthropic::claude-opus-5', 'anthropic::claude-fable-5.1']).mixed).toBe(false)
  })

  it('keeps a pin whose service is away, without showing it', () => {
    const { pinned } = arrange(groups, ['gemini::gemini-4-pro', 'anthropic::claude-opus-5'])
    expect(ids(pinned)).toEqual(['claude-opus-5'])
  })

  it('narrows pins and services alike when searching', () => {
    const {
      pinned,
      groups: rest,
      mixed,
    } = arrange(groups, ['anthropic::claude-opus-5', 'openrouter::openai/gpt-6.1-sol'], 'opus')
    expect(ids(pinned)).toEqual(['claude-opus-5'])
    expect(rest.map((g) => [g.name, ids(g.models)])).toEqual([
      ['Anthropic', ['claude-opus-5']],
      ['OpenRouter', ['anthropic/claude-opus-5']],
    ])
    // Still says which service: the other pin is only hidden by the search.
    expect(mixed).toBe(true)
    expect(ids(arrange(groups, [], 'openrouter').groups.flatMap((g) => g.models))).toHaveLength(2)
  })
})
