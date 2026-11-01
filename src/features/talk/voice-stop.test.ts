import { beforeEach, describe, expect, it, vi } from 'vitest'

let ios = true
class FakeElement {
  currentTime = 1
  duration = 4
  pauses = 0
  loads = 0
  onended = null
  onerror = null
  pause() {
    this.pauses++
  }
  load() {
    this.loads++
  }
  removeAttribute() {}
}
let element: FakeElement
vi.stubGlobal(
  'Audio',
  class extends FakeElement {
    constructor() {
      super()
      element = this
    }
  },
)
vi.mock('./ios', () => ({ isIOS: () => ios }))
vi.mock('@/hermes/rest', () => ({ api: {} }))

const { Voice } = await import('./voice')

describe('stopping a voice that speaks in clips', () => {
  beforeEach(() => {
    ios = true
  })

  it('runs out the clip on an iPhone, where pausing or letting go of it stops the mic', () => {
    new Voice('agent').stop()
    expect(element.currentTime).toBe(4)
    expect(element.pauses).toBe(0)
    expect(element.loads).toBe(0)
  })

  it('leaves an iPhone’s element alone with nothing playing', () => {
    const voice = new Voice('agent')
    element.duration = NaN
    voice.stop()
    expect(element.pauses).toBe(0)
  })

  it('pauses it everywhere else', () => {
    ios = false
    new Voice('agent').stop()
    expect(element.pauses).toBe(1)
  })
})
