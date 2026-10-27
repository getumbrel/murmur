import { describe, expect, it } from 'vitest'
import { lastLine, liveFromLog, type RoomEvent } from './groups.ts'

const now = 1_800_000_000_000
let seq = 0
const event = (kind: string, payload: Record<string, unknown> = {}, ago = 5): RoomEvent => ({
  seq: ++seq,
  event_id: `e${seq}`,
  kind,
  actor: { kind: kind === 'message.user' ? 'user' : 'member', id: String(payload.member_id ?? 'you') },
  payload,
  created_at: (now - ago * 1000) / 1000,
})
const roster = [
  { id: 'm1', name: 'Atlas', handle: 'atlas' },
  { id: 'm2', name: 'Nova', handle: 'nova' },
]

describe('liveFromLog', () => {
  it('is running from your message until Hermes wraps the round up', () => {
    const asked = [event('message.user', { text: 'Thoughts?' }), event('message.member', { member_id: 'm1', text: 'Yes' })]
    expect(liveFromLog(asked, now)).toBe(true)
    expect(liveFromLog([...asked, event('room.activity')], now)).toBe(false)
    expect(liveFromLog([...asked, event('room.stop_requested')], now)).toBe(false)
  })

  it('gives up on a round Hermes would have', () => {
    expect(liveFromLog([event('message.user', { text: 'Hello?' }, 40 * 60)], now)).toBe(false)
    expect(liveFromLog([], now)).toBe(false)
  })
})

describe('lastLine', () => {
  it('names who said the newest thing, with mentions by name', () => {
    const log = [event('message.user', { text: '@atlas plan the trip' }), event('message.member', { member_id: 'm2', text: '**Sure**, @atlas has it' })]
    expect(lastLine(log, roster)).toBe('Nova: Sure, @Atlas has it')
    expect(lastLine(log.slice(0, 1), roster)).toBe('You: @Atlas plan the trip')
  })

  it('skips a reply on its way to being a pass', () => {
    const log = [event('message.member', { member_id: 'm1', text: 'Done.' }), event('message.member', { member_id: 'm2', text: '(pass)' })]
    expect(lastLine(log, roster)).toBe('Atlas: Done.')
    expect(lastLine([], roster)).toBe('')
  })
})
