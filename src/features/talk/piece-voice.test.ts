import { beforeEach, describe, expect, it, vi } from 'vitest'

// An audio element and a Managed Media Source that write down what they're given.
class FakeBuffer {
  mode = ''
  updating = false
  appended: number[][] = []
  edge = 0
  private done?: () => void
  addEventListener(_: string, fn: () => void) {
    this.done = fn
  }
  get buffered() {
    const edge = this.edge
    return { length: edge ? 1 : 0, end: () => edge }
  }
  aborted = 0
  timestampOffset = 0
  abort() {
    this.aborted++
  }
  appendBuffer(chunk: Uint8Array) {
    this.appended.push([...chunk])
    this.edge += 0.1
    this.updating = true
    queueMicrotask(() => {
      this.updating = false
      this.done?.()
    })
  }
}
let source: FakeSource
class FakeSource {
  static isTypeSupported = () => true
  buffer = new FakeBuffer()
  opened?: () => void
  constructor() {
    source = this
  }
  addEventListener(_: string, fn: () => void) {
    this.opened = fn
  }
  addSourceBuffer() {
    return this.buffer
  }
}
class FakeElement {
  currentTime = 0
  srcObject: unknown
  disableRemotePlayback = false
  played = 0
  paused = true
  pauses = 0
  muted = false
  src = ''
  async play() {
    this.played++
    this.paused = false
  }
  pause() {
    this.paused = true
    this.pauses++
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
vi.stubGlobal('window', { ManagedMediaSource: FakeSource })
vi.mock('@/hermes/rest', () => ({ hermesHeaders: (h: object) => h }))
vi.mock('./voice', () => ({ SILENCE: 'silence', speakError: (m: string) => m }))

/** Each sentence's stream, to feed by hand. */
const streams: { push(bytes: number[]): void; end(): void; aborted: () => boolean }[] = []
vi.stubGlobal('fetch', async (_: string, init: { signal: AbortSignal }) => {
  const waiting: ((v: { done: boolean; value?: Uint8Array }) => void)[] = []
  const ready: { done: boolean; value?: Uint8Array }[] = []
  const give = (v: { done: boolean; value?: Uint8Array }) => {
    const w = waiting.shift()
    if (w) w(v)
    else ready.push(v)
  }
  streams.push({
    push: (bytes) => give({ done: false, value: new Uint8Array(bytes) }),
    end: () => give({ done: true }),
    aborted: () => init.signal.aborted,
  })
  return {
    ok: true,
    body: { getReader: () => ({ read: () => new Promise((r) => (ready.length ? r(ready.shift()) : waiting.push(r))) }) },
  }
})

const { PieceVoice, piecesSupported } = await import('./piece-voice')

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
const start = async (voice: InstanceType<typeof PieceVoice>, text = 'Hello there.') => {
  const at = streams.length
  voice.say(text)
  source.opened?.()
  source.opened = undefined
  await settle()
  return streams[at]
}

describe('a voice fed to an audio element', () => {
  beforeEach(() => {
    streams.length = 0
    vi.useRealTimers()
  })

  it('knows when this phone can do it', () => {
    expect(piecesSupported()).toBe(true)
  })

  it('sets up what Managed Media Source insists on', () => {
    new PieceVoice('agent')
    expect(element.disableRemotePlayback).toBe(true)
  })

  it('starts as soon as a fraction of a second is in', async () => {
    const voice = new PieceVoice('agent')
    const first = await start(voice)
    first.push([1])
    await settle()
    expect(element.played).toBe(0)
    first.push([2])
    await settle()
    first.push([3])
    await settle()
    expect(element.played).toBe(1)
  })

  it('still plays a sentence too short to reach the start line', async () => {
    const voice = new PieceVoice('agent')
    const first = await start(voice)
    first.push([1])
    first.end()
    await settle()
    expect(element.played).toBe(1)
  })

  it('lays sentences end to end, in the order they were said', async () => {
    const voice = new PieceVoice('agent')
    const first = await start(voice, 'One.')
    voice.say('Two.')
    await settle()
    const second = streams[1]
    second.push([2])
    await settle()
    expect(source.buffer.appended).toEqual([])
    first.push([1])
    first.end()
    second.end()
    await settle()
    expect(source.buffer.mode).toBe('sequence')
    expect(source.buffer.appended).toEqual([[1], [2]])
  })

  it('says which sentence is playing, and when it’s all done', async () => {
    vi.useFakeTimers()
    const voice = new PieceVoice('agent')
    const started: string[] = []
    let idle = 0
    voice.onStart = (s) => started.push(s.text)
    voice.onIdle = () => idle++
    const first = await start(voice, 'One.')
    for (let i = 0; i < 3; i++) {
      first.push([i])
      await settle()
    }
    first.end()
    await settle()
    await vi.advanceTimersByTimeAsync(60)
    expect(started).toContain('One.')
    expect(voice.busy).toBe(true)
    element.currentTime = 1
    await vi.advanceTimersByTimeAsync(60)
    expect(idle).toBe(1)
    expect(voice.busy).toBe(false)
    voice.stop()
  })

  it('skips to the end of what it has when you talk over it, and drops what’s on the way', async () => {
    const voice = new PieceVoice('agent')
    const first = await start(voice)
    first.push([1])
    first.push([2])
    first.push([3])
    await settle()
    voice.stop()
    expect(element.currentTime).toBeCloseTo(source.buffer.edge - 0.05)
    expect(source.buffer.aborted).toBe(1)
    expect(source.buffer.timestampOffset).toBe(source.buffer.edge)
    expect(first.aborted()).toBe(true)
    expect(voice.busy).toBe(false)
    first.push([4])
    await settle()
    expect(source.buffer.appended).toEqual([[1], [2], [3]])
  })

  it('never pauses, mutes or lets go of the element mid-call: iOS would stop the mic', async () => {
    const voice = new PieceVoice('agent')
    const first = await start(voice)
    first.push([1])
    first.push([2])
    await settle()
    const attached = element.srcObject
    voice.stop()
    expect(element.pauses).toBe(0)
    expect(element.muted).toBe(false)
    expect(element.paused).toBe(false)
    expect(element.srcObject).toBe(attached)
  })

  it('lets go of everything when the call ends', async () => {
    const voice = new PieceVoice('agent')
    const first = await start(voice)
    first.push([1])
    await settle()
    voice.close()
    expect(element.pauses).toBe(1)
    expect(element.srcObject).toBe(null)
  })

  it('knows a reply is over when the player stalls just short of the end of it', async () => {
    vi.useFakeTimers()
    const voice = new PieceVoice('agent')
    let idle = 0
    voice.onIdle = () => idle++
    const first = await start(voice, 'One.')
    first.push([1])
    await settle()
    first.push([2])
    await settle()
    first.end()
    await settle()
    await vi.advanceTimersByTimeAsync(60)
    element.currentTime = source.buffer.edge - 0.08
    await vi.advanceTimersByTimeAsync(120)
    expect(idle).toBe(1)
  })

  it('picks up again after Safari paused it at the end of the last reply', async () => {
    const voice = new PieceVoice('agent')
    const first = await start(voice)
    first.push([1])
    first.push([2])
    first.end()
    await settle()
    element.paused = true
    element.currentTime = source.buffer.edge
    const played = element.played
    const next = await start(voice, 'Again.')
    next.push([3])
    next.push([4])
    await settle()
    expect(element.played).toBe(played + 1)
    expect(element.paused).toBe(false)
  })

  it('carries on from the same element after being talked over', async () => {
    const voice = new PieceVoice('agent')
    const first = await start(voice)
    first.push([1])
    await settle()
    voice.stop()
    const before = source
    const next = await start(voice, 'Again.')
    expect(source).toBe(before)
    next.push([9])
    await settle()
    expect(source.buffer.appended).toEqual([[1], [9]])
  })
})
