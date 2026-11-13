import { describe, expect, it } from 'vitest'
import { limitLiftsAt, limitWait } from './errors'

describe('limitLiftsAt', () => {
  const now = Date.UTC(2026, 10, 12, 20, 0)
  const s = now / 1000

  it('reads the time the service named, in seconds', () => {
    expect(limitLiftsAt({ layer: 'provider', code: 'rate_limit', retryable: true, resets_at: s + 3900 }, now)).toBe(now + 3_900_000)
  })
  it('reads a plan window that carries its own', () => {
    expect(limitLiftsAt({ code: 'usage_window', usage_limit: { resets_at_ms: now + 7_200_000 } }, now)).toBe(now + 7_200_000)
  })
  it('leaves a moment’s wait, a time gone by, and no time at all alone', () => {
    expect(limitLiftsAt({ code: 'rate_limit', resets_at: s + 6 }, now)).toBeUndefined()
    expect(limitLiftsAt({ code: 'rate_limit', resets_at: s - 60 }, now)).toBeUndefined()
    expect(limitLiftsAt({ code: 'rate_limit' }, now)).toBeUndefined()
    expect(limitLiftsAt({ code: 'rate_limit', resets_at: '4:44' }, now)).toBeUndefined()
    expect(limitLiftsAt(null, now)).toBeUndefined()
  })
})

describe('limitWait', () => {
  const now = 1_000_000
  it('reads when Hermes tries again from its wait line', () => {
    expect(limitWait('⏳ rate limited — resets in ~1h 4m, retrying in 600s (attempt 1/3)', now)).toBe(now + 600_000)
    expect(limitWait('⏳ the free model is busy — retrying in 90s (attempt 2/3)', now)).toBe(now + 90_000)
  })
  it('leaves short waits, other waits and the spinner to "Thinking"', () => {
    expect(limitWait('⏳ rate limited — retrying in 12s (attempt 1/3)', now)).toBeUndefined()
    expect(limitWait('⏳ waiting on provider — retrying in 600s (attempt 1/3)', now)).toBeUndefined()
    expect(limitWait('(¬_¬) mulling...', now)).toBeUndefined()
    expect(limitWait('', now)).toBeUndefined()
  })
})
