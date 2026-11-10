import { describe, expect, it } from 'vitest'
import { dayName, picksUp, timeHeaders } from './times'

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()
const now = new Date(2026, 10, 10, 15)

describe('dayName', () => {
  it('names today, yesterday and the days of this week', () => {
    expect(dayName(at(10, 9), now)).toBe('Today')
    expect(dayName(at(9, 23, 59), now)).toBe('Yesterday')
    expect(dayName(at(6, 9), now)).toBe(new Date(at(6, 9)).toLocaleDateString(undefined, { weekday: 'long' }))
  })

  it('gives the date further back, with the year once it is another one', () => {
    expect(dayName(at(1, 9), now)).not.toMatch(/2026/)
    expect(dayName(new Date(2025, 2, 3).getTime(), now)).toMatch(/2025/)
  })
})

describe('picksUp', () => {
  it('after an hour, or on a new day', () => {
    expect(picksUp(0, at(10, 9))).toBe(true)
    expect(picksUp(at(10, 9), at(10, 9, 59))).toBe(false)
    expect(picksUp(at(10, 9), at(10, 10))).toBe(true)
    expect(picksUp(at(9, 23, 50), at(10, 0, 5))).toBe(true)
  })
})

describe('timeHeaders', () => {
  type Row = { id: string; starts?: number; ends?: number }
  const headers = (rows: Row[]) => [...timeHeaders(rows, (r) => r).keys()]

  it('opens the thread, and each exchange that follows a pause', () => {
    expect(
      headers([
        { id: 'a', starts: at(9, 9) },
        { id: 'a-reply', ends: at(9, 9, 1) },
        { id: 'b', starts: at(9, 9, 20) },
        { id: 'b-reply', ends: at(9, 9, 21) },
        { id: 'c', starts: at(10, 14) },
      ]),
    ).toEqual(['a', 'c'])
  })

  it('counts the pause from the end of a long reply, not from its start', () => {
    expect(
      headers([
        { id: 'a', starts: at(10, 9) },
        { id: 'a-reply', ends: at(10, 9, 50) },
        { id: 'b', starts: at(10, 10, 30) },
      ]),
    ).toEqual(['a'])
  })

  it('never puts a time between a message and its reply, or on a row without one', () => {
    expect(
      headers([
        { id: 'reply', ends: at(10, 9) },
        { id: 'notice' },
        { id: 'a', starts: at(10, 9, 5) },
      ]),
    ).toEqual([])
  })
})
