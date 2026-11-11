import { describe, expect, it } from 'vitest'
import { runningLine, sameRunning, stillRunning } from './running'

const NOW = 1_800_000_000_000

describe('stillRunning', () => {
  it('is nothing when Hermes keeps no commands, or only finished ones', () => {
    expect(stillRunning(undefined, NOW)).toBeUndefined()
    expect(stillRunning([], NOW)).toBeUndefined()
    expect(stillRunning([{ session_id: 'proc_1', status: 'exited' }], NOW)).toBeUndefined()
  })

  it('keeps the ones still going, since the first of them started', () => {
    const running = stillRunning(
      [
        { session_id: 'proc_1', status: 'running', started_epoch: NOW / 1000 - 90 },
        { session_id: 'proc_2', status: 'exited', started_epoch: NOW / 1000 - 900 },
        { session_id: 'proc_3', status: 'running', started_epoch: NOW / 1000 - 30 },
      ],
      NOW,
    )
    expect(running).toEqual({ ids: ['proc_1', 'proc_3'], since: NOW - 90_000 })
  })

  it('counts back from how long one has run when Hermes gives no start', () => {
    expect(stillRunning([{ session_id: 'proc_1', status: 'running', uptime_seconds: 12 }], NOW)?.since).toBe(NOW - 12_000)
    expect(stillRunning([{ session_id: 'proc_1', status: 'running' }], NOW)?.since).toBe(NOW)
  })

  it('never starts in the future, whatever the other clock says', () => {
    expect(stillRunning([{ session_id: 'proc_1', status: 'running', started_epoch: NOW / 1000 + 60 }], NOW)?.since).toBe(NOW)
  })
})

describe('sameRunning', () => {
  it('holds while the same commands are going', () => {
    expect(sameRunning(undefined, undefined)).toBe(true)
    expect(sameRunning({ ids: ['a', 'b'], since: 1 }, { ids: ['a', 'b'], since: 2 })).toBe(true)
    expect(sameRunning({ ids: ['a'], since: 1 }, undefined)).toBe(false)
    expect(sameRunning({ ids: ['a'], since: 1 }, { ids: ['b'], since: 1 })).toBe(false)
  })
})

describe('runningLine', () => {
  it('says how many', () => {
    expect(runningLine(1)).toBe('Still running a command')
    expect(runningLine(3)).toBe('Still running 3 commands')
  })
})
