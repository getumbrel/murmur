import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'

// A window that's in front and focused unless a test says otherwise.
const page = { visibilityState: 'visible', focused: true }
const listeners = new Map<string, () => void>()
const said: { active: boolean; here?: boolean; viewing?: string }[] = []

vi.useFakeTimers()
vi.stubGlobal('document', {
  get visibilityState() {
    return page.visibilityState
  },
  hasFocus: () => page.focused,
  addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
})
vi.stubGlobal('addEventListener', (type: string, fn: () => void) => listeners.set(type, fn))
vi.stubGlobal('navigator', { sendBeacon: () => true })
vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
  said.push(JSON.parse(init.body))
  return new Response(null, { status: 204 })
})
vi.mock('@/hermes/instance', () => ({ tabHermes: () => 'env' }))
vi.mock('./notifications', () => ({ useNotifications: create(() => ({ device: 'phone' })) }))

const { setCalling, setReplying, setViewing, startPresence } = await import('./presence')
const last = () => said.at(-1)
const goBehind = () => {
  page.focused = false
  listeners.get('blur')!()
}
const comeBack = () => {
  page.focused = true
  listeners.get('focus')!()
}

startPresence()
setViewing('murmur:chat:c1')

afterAll(() => vi.useRealTimers())

describe('presence', () => {
  beforeEach(() => {
    setCalling(false)
    setReplying(false)
    comeBack()
    // Long enough that nothing from the test before still counts.
    vi.advanceTimersByTime(10 * 60_000)
    listeners.get('pointerdown')!()
    said.length = 0
  })

  it('goes quiet two minutes after the last touch, and when the window goes behind', () => {
    vi.advanceTimersByTime(60_000)
    expect(last()).toMatchObject({ active: true, viewing: 'murmur:chat:c1' })
    vi.advanceTimersByTime(61_000)
    expect(last()).toMatchObject({ active: false })
    listeners.get('pointerdown')!()
    expect(last()).toMatchObject({ active: true })
    goBehind()
    expect(last()).toMatchObject({ active: false })
  })

  it('stays there through a call, touched or not, in front or not, and kept fresh', () => {
    setCalling(true)
    vi.advanceTimersByTime(5 * 60_000)
    expect(last()).toMatchObject({ active: true, viewing: 'murmur:chat:c1' })
    goBehind()
    expect(last()).toMatchObject({ active: true })
    said.length = 0
    // The server forgets a tab it hasn't heard from in 50 seconds.
    vi.advanceTimersByTime(45_000)
    expect(said.length).toBeGreaterThanOrEqual(2)
    expect(said.every((s) => s.active)).toBe(true)
    // Hung up, long untouched and behind: not there.
    setCalling(false)
    expect(last()).toMatchObject({ active: false })
    said.length = 0
    vi.advanceTimersByTime(60_000)
    expect(said).toEqual([])
  })

  it('after a call, the last touch still counts for its two minutes', () => {
    setCalling(true)
    vi.advanceTimersByTime(3 * 60_000)
    listeners.get('pointerdown')!()
    vi.advanceTimersByTime(30_000)
    setCalling(false)
    expect(last()).toMatchObject({ active: true })
    vi.advanceTimersByTime(91_000)
    expect(last()).toMatchObject({ active: false })
  })

  it('stays at this device, behind, for two minutes after the last touch, kept fresh meanwhile', () => {
    vi.advanceTimersByTime(30_000)
    goBehind()
    expect(last()).toMatchObject({ active: false, here: true })
    said.length = 0
    // Moving over the window behind, all the while: it still says, so the server doesn't forget it.
    for (let i = 0; i < 45; i++) {
      listeners.get('pointermove')!()
      vi.advanceTimersByTime(1000)
    }
    expect(said.length).toBeGreaterThanOrEqual(2)
    expect(said.every((s) => s.here && !s.active)).toBe(true)
    // Two minutes from the last move: gone, and quiet.
    vi.advanceTimersByTime(119_000)
    expect(last()).toMatchObject({ here: true })
    vi.advanceTimersByTime(2_000)
    expect(last()).toMatchObject({ active: false, here: false })
    said.length = 0
    vi.advanceTimersByTime(60_000)
    expect(said).toEqual([])
  })

  it('stays while a reply comes in on screen, untouched, and two minutes after it lands; not active', () => {
    setReplying(true)
    vi.advanceTimersByTime(5 * 60_000)
    expect(last()).toMatchObject({ active: false, here: true, viewing: 'murmur:chat:c1' })
    setReplying(false)
    vi.advanceTimersByTime(119_000)
    expect(last()).toMatchObject({ here: true })
    vi.advanceTimersByTime(2_000)
    expect(last()).toMatchObject({ here: false })
  })

  it('a reply coming in behind isn’t watched; going behind mid-reply counts from then', () => {
    goBehind()
    setReplying(true)
    vi.advanceTimersByTime(2.5 * 60_000)
    expect(last()).toMatchObject({ here: false })
    comeBack()
    vi.advanceTimersByTime(3 * 60_000)
    expect(last()).toMatchObject({ here: true })
    goBehind()
    vi.advanceTimersByTime(119_000)
    expect(last()).toMatchObject({ here: true })
    vi.advanceTimersByTime(2_000)
    expect(last()).toMatchObject({ here: false })
  })
})
