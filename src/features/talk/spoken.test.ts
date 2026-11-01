import { describe, expect, it } from 'vitest'
import { reelShift } from './spoken'

describe('a long sentence in its box', () => {
  const room = 150
  const line = 30
  const height = 600

  it('stays put while what’s being said is near the top', () => {
    expect(reelShift(0, room, height, line)).toBe(0)
    expect(reelShift(30, room, height, line)).toBe(0)
  })

  it('moves up with the line being said, a whole line at a time', () => {
    expect(reelShift(120, room, height, line)).toBe(90)
    expect(reelShift(150, room, height, line)).toBe(120)
  })

  it('stops once the last line is in view', () => {
    expect(reelShift(570, room, height, line)).toBe(450)
  })

  it('never moves a sentence that fits', () => {
    expect(reelShift(90, room, 120, line)).toBe(0)
  })
})
