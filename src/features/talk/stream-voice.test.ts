import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only the scheduling is under test: a clock, a socket and an AudioContext that write things down.
class FakeContext {
  sampleRate = 44100
  currentTime = 10
  destination = {}
  played: { at: number; frames: number; rate: number }[] = []
  createGain() {
    return { connect: () => {}, gain: { cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} } }
  }
  createBuffer(_: number, frames: number, rate: number) {
    return { copyToChannel() {}, duration: frames / rate, frames, rate }
  }
  createBufferSource() {
    const played = this.played
    return {
      buffer: undefined as undefined | { frames: number; rate: number },
      connect() {},
      stop() {},
      start(at: number) {
        played.push({ at, frames: this.buffer!.frames, rate: this.buffer!.rate })
      },
    }
  }
}
const ctx = new FakeContext()
vi.mock('./sounds', () => ({ audioContext: () => ctx }))
vi.mock('./voice', () => ({ speakError: (m: string) => m }))
vi.mock('@/hermes/rest', async (real) => ({ ...(await real()), api: {} }))

class FakeSocket {
  static last: FakeSocket
  binaryType = ''
  onmessage?: (m: { data: unknown }) => void
  onclose?: () => void
  onopen?: () => void
  constructor() {
    FakeSocket.last = this
  }
  send() {}
  close() {}
  chunk(ms: number, rate = 24000) {
    this.onmessage?.({ data: new Int16Array(Math.round((rate * ms) / 1000)).buffer })
  }
  event(e: object) {
    this.onmessage?.({ data: JSON.stringify(e) })
  }
}
vi.stubGlobal('WebSocket', FakeSocket)
vi.stubGlobal('location', { protocol: 'https:', host: 'test' })

const { StreamVoice } = await import('./stream-voice')

const say = () => {
  const voice = new StreamVoice('agent')
  voice.unlock()
  voice.say('Hello there.')
  FakeSocket.last.event({ type: 'start', sample_rate: 24000 })
  return { voice, socket: FakeSocket.last }
}

describe('streaming a sentence', () => {
  beforeEach(() => {
    ctx.played = []
    ctx.currentTime = 10
  })

  it('holds a cushion back before it starts', () => {
    const { socket } = say()
    socket.chunk(80)
    socket.chunk(80)
    expect(ctx.played).toEqual([])
    socket.chunk(80)
    expect(ctx.played).toHaveLength(1)
  })

  it('plays at the device’s own rate, so the browser has nothing to resample', () => {
    const { socket } = say()
    for (let i = 0; i < 6; i++) socket.chunk(80)
    expect(ctx.played.every((p) => p.rate === 44100)).toBe(true)
  })

  it('joins every piece to the sample', () => {
    const { socket } = say()
    for (let i = 0; i < 8; i++) socket.chunk(80)
    socket.event({ type: 'end' })
    expect(ctx.played.length).toBeGreaterThan(2)
    for (let i = 1; i < ctx.played.length; i++) {
      const before = ctx.played[i - 1]
      expect(Math.round(ctx.played[i].at * 44100)).toBe(Math.round(before.at * 44100) + before.frames)
    }
  })

  it('doesn’t wait for a cushion a short sentence will never fill', () => {
    const { socket } = say()
    socket.chunk(80)
    socket.event({ type: 'end' })
    expect(ctx.played).toHaveLength(1)
  })

  it('never holds a piece back while speech is playing', () => {
    const { socket } = say()
    for (let i = 0; i < 3; i++) socket.chunk(80)
    // Nearly through what it has: the next piece goes on the end at once, however little there is.
    const { at, frames } = ctx.played[0]
    ctx.currentTime = at + frames / 44100 - 0.05
    socket.chunk(80)
    expect(ctx.played).toHaveLength(2)
    expect(Math.round(ctx.played[1].at * 44100)).toBe(Math.round(at * 44100) + frames)
  })

  it('holds back more after running dry', () => {
    const { socket } = say()
    for (let i = 0; i < 3; i++) socket.chunk(80)
    expect(ctx.played).toHaveLength(1)
    // Everything scheduled has played, and the model is late.
    ctx.currentTime += 5
    for (let i = 0; i < 4; i++) socket.chunk(80)
    expect(ctx.played).toHaveLength(1)
    socket.chunk(80)
    expect(ctx.played).toHaveLength(2)
  })
})
