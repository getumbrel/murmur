import { describe, expect, it } from 'vitest'
import { sinceWords } from './time'

describe('when something was last seen, as you’d say it', () => {
  const now = new Date(2026, 10, 11, 18, 0).getTime()
  const ago = (minutes: number) => now - minutes * 60_000

  it('counts minutes, then hours, within the day', () => {
    expect(sinceWords(ago(0), now)).toBe('a moment ago')
    expect(sinceWords(ago(1), now)).toBe('a moment ago')
    expect(sinceWords(ago(20), now)).toBe('20 minutes ago')
    expect(sinceWords(ago(75), now)).toBe('an hour ago')
    expect(sinceWords(ago(5 * 60), now)).toBe('5 hours ago')
  })

  it('names the day once it was another day', () => {
    expect(sinceWords(new Date(2026, 10, 10, 23, 30).getTime(), now)).toBe('yesterday')
    expect(sinceWords(new Date(2026, 10, 8, 9, 0).getTime(), now)).toMatch(/^on \p{L}+$/u)
    expect(sinceWords(new Date(2026, 9, 12, 9, 0).getTime(), now)).toMatch(/^on .*12/)
    expect(sinceWords(new Date(2025, 9, 12, 9, 0).getTime(), now)).toMatch(/2025/)
  })
})
