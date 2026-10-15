import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {} }))
vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn() }))

const { chatUsageOf, contextWorthShowing, money, slicesOf, summarizeWeek, tokensText } = await import('./insights')

const now = new Date(2026, 9, 15, 14, 0)

describe('the week', () => {
  it('lays out the last seven days, with quiet ones as zero', () => {
    const week = summarizeWeek(
      {
        daily: [
          { day: '2026-10-09', sessions: 3, estimated_cost: 0.3 },
          { day: '2026-10-12', sessions: 2, estimated_cost: 0.2 },
          { day: '2026-10-15', sessions: 5, estimated_cost: 0.5 },
        ],
      },
      now,
    )!
    expect(week.days.map((d) => d.key)).toEqual([
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
    ])
    expect(week.days.map((d) => d.chats)).toEqual([3, 0, 0, 2, 0, 0, 5])
    expect(week.chats).toBe(10)
  })

  it('adds up this month only, preferring what was actually billed', () => {
    const estimated = summarizeWeek(
      {
        daily: [
          { day: '2026-09-29', sessions: 4, estimated_cost: 9 },
          { day: '2026-10-02', sessions: 1, estimated_cost: 0.25 },
          { day: '2026-10-15', sessions: 1, estimated_cost: 0.5 },
        ],
      },
      now,
    )!
    expect(estimated.month).toEqual({ amount: 0.75, estimated: true })
    const billed = summarizeWeek(
      { daily: [{ day: '2026-10-15', sessions: 1, estimated_cost: 0.5, actual_cost: 0.42 }] },
      now,
    )!
    expect(billed.month).toEqual({ amount: 0.42, estimated: false })
  })

  it('groups tools by kind and keeps the top three', () => {
    const week = summarizeWeek(
      {
        daily: [{ day: '2026-10-15', sessions: 1 }],
        tools: [
          { tool: 'web_search', count: 17 },
          { tool: 'terminal', count: 9 },
          { tool: 'read_file', count: 5 },
          { tool: 'write_file', count: 8 },
          { tool: 'browser_navigate', count: 3 },
          { tool: 'clarify', count: 40 },
        ],
      },
      now,
    )!
    expect(week.tools).toEqual([
      { category: 'web', count: 17 },
      { category: 'file', count: 13 },
      { category: 'terminal', count: 9 },
    ])
  })

  it('is nothing at all until there’s been a chat this week', () => {
    expect(summarizeWeek({ daily: [{ day: '2026-10-01', sessions: 9 }] }, now)).toBeNull()
    expect(summarizeWeek({}, now)).toBeNull()
  })

  it('writes money plainly', () => {
    expect(money(1.9538)).toBe('$1.95')
    expect(money(0.004)).toBe('< $0.01')
    expect(money(0)).toBe('$0')
    expect(money(1234.5)).toBe('$1,235')
  })
})

describe('a chat', () => {
  it('reads how full it is and what it cost', () => {
    const u = chatUsageOf(
      { context_percent: 64, context_used: 82_000, context_max: 128_000, compressions: 1 },
      { estimated_cost_usd: 0.0412 },
    )
    expect(u).toEqual({ context: 64, used: 82_000, max: 128_000, cost: 0.0412, included: false, compressions: 1 })
    expect(contextWorthShowing(u)).toBe(true)
  })

  it('works the percentage out when Hermes leaves it off', () => {
    expect(chatUsageOf({ context_used: 32_000, context_max: 128_000 }, null).context).toBe(25)
  })

  it('prefers the live figure, then what was billed, then the estimate', () => {
    expect(chatUsageOf({ cost_usd: 0.09 }, { actual_cost_usd: 0.05, estimated_cost_usd: 0.04 }).cost).toBe(0.09)
    expect(chatUsageOf({}, { actual_cost_usd: 0.05, estimated_cost_usd: 0.04 }).cost).toBe(0.05)
  })

  it('has no bill when a plan covers it, and no ring before the agent has thought', () => {
    const plan = chatUsageOf({ context_max: 0 }, { estimated_cost_usd: 0, cost_status: 'included' })
    expect(plan.included).toBe(true)
    expect(plan.cost).toBeUndefined()
    expect(plan.context).toBeUndefined()
    expect(contextWorthShowing(plan)).toBe(false)
    expect(contextWorthShowing(chatUsageOf({ context_percent: 30, context_max: 100 }, null))).toBe(false)
  })

  it('folds Hermes’s categories into a few a person would name', () => {
    expect(
      slicesOf([
        { id: 'system_prompt', tokens: 3000 },
        { id: 'rules', tokens: 1000 },
        { id: 'tool_definitions', tokens: 9000 },
        { id: 'mcp', tokens: 2000 },
        { id: 'skills', tokens: 0 },
        { id: 'memory', tokens: 500 },
        { id: 'conversation', tokens: 40_000 },
      ]),
    ).toEqual([
      { id: 'chat', label: 'This chat', tokens: 40_000 },
      { id: 'tools', label: 'Tools', tokens: 11_000 },
      { id: 'instructions', label: 'Instructions', tokens: 4000 },
      { id: 'memory', label: 'Memory', tokens: 500 },
    ])
  })

  it('writes a window size the way model pages do', () => {
    expect(tokensText(128_000)).toBe('128K')
    expect(tokensText(1_050_000)).toBe('1.1M')
    expect(tokensText(900)).toBe('900')
  })
})
