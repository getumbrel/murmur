import { afterEach, describe, expect, it, vi } from 'vitest'
import { queueOpeningLine, takeOpeningLine } from './opening-line'

afterEach(() => vi.useRealTimers())

describe('a question to open a chat with', () => {
  it('is taken once, by the agent it was for', () => {
    queueOpeningLine('atlas', 'What needs me in my inbox today?')
    expect(takeOpeningLine('sage')).toBeUndefined()
    expect(takeOpeningLine('atlas')).toBe('What needs me in my inbox today?')
    expect(takeOpeningLine('atlas')).toBeUndefined()
  })

  it('doesn’t wait around for a chat that never opened', () => {
    vi.useFakeTimers()
    queueOpeningLine('atlas', 'Hello')
    vi.advanceTimersByTime(20_000)
    expect(takeOpeningLine('atlas')).toBeUndefined()
  })

  it('gives way to a newer one', () => {
    queueOpeningLine('atlas', 'First')
    queueOpeningLine('atlas', 'Second')
    expect(takeOpeningLine('atlas')).toBe('Second')
  })
})
