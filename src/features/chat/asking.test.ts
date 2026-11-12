import { describe, expect, it } from 'vitest'
import { unaskedOf } from './asking'

describe('unaskedOf', () => {
  it('is unset until Hermes says, so nothing is offered on a Hermes that never does', () => {
    expect(unaskedOf(undefined)).toBeUndefined()
    expect(unaskedOf(null)).toBeUndefined()
    expect(unaskedOf({})).toBeUndefined()
    expect(unaskedOf({ approval_mode: 'manual' })).toBeUndefined()
  })

  it('asks by default', () => {
    expect(unaskedOf({ yolo: false, approval_mode: 'manual' })).toBe(false)
    expect(unaskedOf({ yolo: false, approval_mode: 'smart' })).toBe(false)
  })

  it('tells a chat that stopped asking from a Hermes where asking is off altogether', () => {
    expect(unaskedOf({ yolo: true, approval_mode: 'manual' })).toBe('chat')
    expect(unaskedOf({ yolo: true })).toBe('chat')
    expect(unaskedOf({ yolo: true, approval_mode: 'off' })).toBe('everywhere')
  })
})
