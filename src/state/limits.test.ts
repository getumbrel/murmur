import { describe, expect, it } from 'vitest'
import { planFromAccountLines, planUsage, planUsageLine, reportsPlanAsText, restingUntil, untilText } from './limits'

// Provider rows as /api/model/options sends them (hermes_cli/inventory.py _apply_usage/_apply_limits).
const codex = {
  windows: [
    { label: 'Session', used_percent: 12.5, resets_at: '2026-10-15T17:00:00+00:00', scope: 'account' },
    { label: 'Weekly', used_percent: 4, resets_at: '2026-10-20T05:01:00+00:00', scope: 'account' },
  ],
}

describe('plan usage', () => {
  it('reads each window as what’s left', () => {
    const plan = planUsage(codex)!
    expect(plan.windows.map((w) => [w.label, w.left])).toEqual([
      ['Session', 88],
      ['Weekly', 96],
    ])
    expect(plan.windows[0].resetsAt?.toISOString()).toBe('2026-10-15T17:00:00.000Z')
  })

  it('leaves out windows that cap a model family, not the account', () => {
    const plan = planUsage({
      windows: [
        { label: 'Current week', used_percent: 30, resets_at: null, scope: 'account' },
        { label: 'Opus week', used_percent: 99, resets_at: null, scope: 'model' },
      ],
    })!
    expect(plan.windows.map((w) => w.label)).toEqual(['Current week'])
  })

  it('with several accounts, answers with the one that has the most room', () => {
    const plan = planUsage({
      accounts: [
        { id: 'a', state: 'limited', windows: [{ label: 'Weekly', used_percent: 100, scope: 'account' }] },
        { id: 'b', state: 'ready', windows: [{ label: 'Weekly', used_percent: 40, scope: 'account' }] },
        { id: 'c', state: 'unavailable', windows: [{ label: 'Weekly', used_percent: 0, scope: 'account' }] },
      ],
    })!
    expect(plan.windows[0].left).toBe(60)
  })

  it('says nothing when Hermes hasn’t looked yet', () => {
    expect(planUsage(undefined)).toBeNull()
    expect(planUsage({ windows: [] })).toBeNull()
    expect(planUsage({ accounts: [{ id: 'a', state: 'unknown', windows: [] }] })).toBeNull()
  })

  it('leads with the tightest window', () => {
    const now = new Date(2026, 9, 15, 9, 0)
    const line = planUsageLine(
      {
        windows: [
          { label: 'Weekly', left: 96 },
          { label: 'Session', left: 12, resetsAt: new Date(2026, 9, 15, 17, 0) },
        ],
      },
      now,
    )
    expect(line.low).toBe(true)
    expect(line.left).toBe(12)
    expect(line.text).toMatch(/^12% left · resets 5/)
  })

  it('reads a roomy week calmly', () => {
    const now = new Date(2026, 9, 15, 9, 0)
    const line = planUsageLine({ windows: [{ label: 'Weekly', left: 96, resetsAt: new Date(2026, 9, 20, 5, 1) }] }, now)
    expect(line.parts).toMatchObject({ lead: 'Plenty left', scope: 'this week' })
    expect(line.text).toMatch(/^Plenty left this week · resets \w+/)
  })
})

describe('resting', () => {
  const now = Date.parse('2026-10-15T09:00:00Z')

  it('knows when a whole account is back', () => {
    const at = restingUntil({ scope: 'account', resets_at: '2026-10-15T17:00:00+00:00' }, undefined, now)
    expect(at?.toISOString()).toBe('2026-10-15T17:00:00.000Z')
    // Every model rests with it.
    expect(restingUntil({ scope: 'account', resets_at: '2026-10-15T17:00:00+00:00' }, 'gpt-5.5', now)).toEqual(at)
  })

  it('knows which models are resting, and only those', () => {
    const limit = { scope: 'models', models: { 'gpt-5.5': '2026-10-15T12:00:00+00:00' } }
    expect(restingUntil(limit, 'gpt-5.5', now)?.toISOString()).toBe('2026-10-15T12:00:00.000Z')
    expect(restingUntil(limit, 'gpt-5.5-mini', now)).toBeUndefined()
    expect(restingUntil(limit, undefined, now)).toBeUndefined()
  })

  it('forgets a rest that’s already over', () => {
    expect(restingUntil({ scope: 'account', resets_at: '2026-10-15T08:00:00+00:00' }, undefined, now)).toBeUndefined()
    expect(restingUntil(undefined, undefined, now)).toBeUndefined()
  })

  it('says when, briefly', () => {
    const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m)
    const today = at(15, 9)
    expect(untilText(at(15, 17), today)).toMatch(/^5\s?pm$/i)
    expect(untilText(at(15, 17, 30), today)).toMatch(/^5:30\s?pm$/i)
    expect(untilText(at(16, 9), today)).toMatch(/^9\s?am tomorrow$/i)
    expect(untilText(at(19, 9), today)).toBe(at(19, 9).toLocaleDateString(undefined, { weekday: 'short' }))
  })
})

describe('the plan line', () => {
  const now = new Date(2026, 9, 15, 9, 0)
  const line = (left: number, label: string, resetsAt?: Date) =>
    planUsageLine({ windows: [{ label, left, resetsAt }] }, now)

  it('says when it’s all used, and drops the scope when it’s low', () => {
    expect(line(0, 'Weekly').text).toBe('All used')
    expect(line(12, 'Weekly').parts).toMatchObject({ lead: '12% left', scope: '' })
    expect(line(35, 'Monthly').text).toBe('35% left this month')
    expect(line(80, 'Current week').text).toBe('Plenty left this week')
    expect(line(80, 'Session').text).toBe('Plenty left')
  })

  it('counts down the last hour in minutes', () => {
    expect(line(5, 'Session', new Date(2026, 9, 15, 9, 25)).text).toBe('5% left · resets in 25 min')
    expect(line(5, 'Session', new Date(2026, 9, 15, 9, 0, 10)).parts.reset).toBe('resets in 1 min')
  })

  it('says tomorrow, a weekday, or a date further out', () => {
    expect(line(60, 'Weekly', new Date(2026, 9, 16, 9)).parts.reset).toBe('resets tomorrow')
    expect(line(60, 'Monthly', new Date(2026, 10, 1)).parts.reset).toBe(
      `resets ${new Date(2026, 10, 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    )
  })

  it('writes a rest far off as a date', () => {
    const at = new Date(2026, 9, 25, 9)
    expect(untilText(at, now)).toBe(at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
  })
})

describe('the plan on Hermes before 0.22', () => {
  // session.usage's account_lines, as 0.21 writes them.
  const lines = [
    'Provider: openai-codex (Plus)',
    'Session: 87% remaining (13% used) • resets in 3h 10m (2026-10-15 17:00 UTC)',
    'Weekly: 96% remaining (4% used) • resets in 6d 15h (2026-10-20 05:01 UTC)',
  ]

  it('reads the windows from the lines', () => {
    const plan = planFromAccountLines(lines, 0)!
    expect(plan.windows.map((w) => [w.label, w.left])).toEqual([
      ['Session', 87],
      ['Weekly', 96],
    ])
    expect(plan.windows[0].resetsAt?.getTime()).toBe((3 * 60 + 10) * 60_000)
  })

  it('says nothing for another service, or for lines that aren’t a plan', () => {
    expect(planFromAccountLines(['Provider: openrouter', ...lines.slice(1)])).toBeNull()
    expect(planFromAccountLines(['Credits: $4.20'])).toBeNull()
    expect(planFromAccountLines(undefined)).toBeNull()
  })

  it('asks that way only before 0.22', () => {
    expect(reportsPlanAsText('0.21.5')).toBe(true)
    expect(reportsPlanAsText('0.22.0')).toBe(false)
    expect(reportsPlanAsText('1.0.0')).toBe(false)
    expect(reportsPlanAsText(undefined)).toBe(false)
  })
})
