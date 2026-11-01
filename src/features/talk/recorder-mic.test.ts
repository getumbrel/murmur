import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeRecorder {
  static made: FakeRecorder[] = []
  state = 'inactive'
  mimeType = 'audio/mp4'
  ondataavailable?: (e: { data: { size: number } }) => void
  onstop?: () => void
  constructor() {
    FakeRecorder.made.push(this)
  }
  sliced?: number
  start(slice?: number) {
    this.state = 'recording'
    this.sliced = slice
  }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
}
class FakeSocket {
  static OPEN = 1
  static made: FakeSocket[] = []
  readyState = 0
  sent: unknown[] = []
  onopen?: () => void
  onmessage?: (m: { data: unknown }) => void
  onclose?: () => void
  constructor(public url: string) {
    FakeSocket.made.push(this)
    if (FakeSocket.refuse) queueMicrotask(() => this.onclose?.())
    else
      queueMicrotask(() => {
        this.readyState = 1
        this.onopen?.()
      })
  }
  static refuse = false
  send(data: unknown) {
    this.sent.push(data)
  }
  close() {
    this.onclose?.()
  }
  told() {
    return this.sent.filter((s) => typeof s === 'string').map((s) => JSON.parse(s as string))
  }
}
const replaced = vi.fn()
class FakePeer {
  static report: Record<string, unknown> | undefined
  getSenders() {
    return [{ replaceTrack: replaced }]
  }
  onicecandidate = null
  localDescription = {}
  addTrack() {}
  addIceCandidate() {}
  async createOffer() {
    return {}
  }
  async createAnswer() {
    return {}
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async getStats() {
    return FakePeer.report ? [FakePeer.report] : []
  }
  close() {}
}
vi.stubGlobal('MediaRecorder', FakeRecorder)
vi.stubGlobal('RTCPeerConnection', FakePeer)
vi.stubGlobal('WebSocket', FakeSocket)
vi.stubGlobal('location', { protocol: 'https:', host: 'umbrel.local' })
vi.mock('@/hermes/instance', () => ({ HERMES_PARAM: 'hermes', tabHermes: () => undefined }))
vi.stubGlobal('navigator', {
  mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [{}], getTracks: () => [] }) },
})

const { RecorderMic } = await import('./recorder-mic')

const opened = async (profile?: string) => {
  const events = { level: vi.fn(), speechStart: vi.fn(), turn: vi.fn(), barge: vi.fn(), nothing: vi.fn(), deaf: vi.fn() }
  const mic = new RecorderMic(events, profile)
  await mic.open()
  return { mic, events }
}
const hear = (mic: InstanceType<typeof RecorderMic>, level: number, ms: number) => {
  for (let t = 0; t < ms; t += 100) mic.judge(level)
}
const settle = () => new Promise((r) => setTimeout(r))

describe('taking turns on the agent’s machine', () => {
  beforeEach(() => {
    FakeRecorder.made = []
    FakeSocket.made = []
    FakeSocket.refuse = false
  })

  it('sends the mic there as it’s recorded, in one recording', async () => {
    const { mic } = await opened('agent')
    const ear = FakeSocket.made[0]
    expect(ear.url).toBe('wss://umbrel.local/hermes/api/plugins/murmur-voice/hear?profile=agent')
    const recorder = FakeRecorder.made[0]
    expect(recorder.sliced).toBeGreaterThan(0)
    const piece = { size: 4 }
    recorder.ondataavailable?.({ data: piece })
    expect(ear.sent).toEqual([piece])
    const now = vi.spyOn(performance, 'now').mockReturnValue(60_000)
    hear(mic, 0, 300)
    now.mockRestore()
    expect(FakeRecorder.made).toHaveLength(1)
    mic.close()
  })

  it('tells it what the call is doing, and takes its word for your turn', async () => {
    const { mic, events } = await opened('agent')
    const ear = FakeSocket.made[0]
    mic.setMode('listen')
    expect(ear.told()).toEqual([{ mode: 'listen' }])
    hear(mic, 0.3, 2000)
    hear(mic, 0, 2000)
    expect(events.speechStart).not.toHaveBeenCalled()
    expect(events.turn).not.toHaveBeenCalled()
    ear.onmessage?.({ data: '{"type":"speech"}' })
    expect(events.speechStart).toHaveBeenCalledOnce()
    ear.onmessage?.({ data: new Blob(['riff']) })
    expect(events.turn.mock.calls[0][0].type).toBe('audio/wav')
    mic.close()
  })

  it('still notices being talked over itself, and says so at once', async () => {
    const { mic, events } = await opened('agent')
    const ear = FakeSocket.made[0]
    mic.setMode('barge')
    hear(mic, 0.3, 400)
    expect(events.barge).toHaveBeenCalledOnce()
    expect(ear.told().at(-1)).toEqual({ interrupted: true })
    mic.close()
  })

  it('goes back to listening when what it heard was nothing', async () => {
    const { mic, events } = await opened('agent')
    FakeSocket.made[0].onmessage?.({ data: '{"type":"nothing"}' })
    expect(events.nothing).toHaveBeenCalledOnce()
    mic.close()
  })

  it('ends your turn on a tap', async () => {
    const { mic } = await opened('agent')
    mic.finish()
    expect(FakeSocket.made[0].told()).toEqual([{ finish: true }])
    mic.close()
  })

  it('takes turns from the level where the agent’s machine can’t', async () => {
    FakeSocket.refuse = true
    const { mic, events } = await opened('agent')
    mic.setMode('listen')
    hear(mic, 0.3, 1000)
    hear(mic, 0, 800)
    await settle()
    expect(events.turn).toHaveBeenCalledOnce()
    mic.close()
  })

  it('carries on from the level if the connection goes during the call', async () => {
    const { mic, events } = await opened('agent')
    mic.setMode('listen')
    FakeSocket.made[0].onclose?.()
    expect(events.nothing).toHaveBeenCalledOnce()
    expect(FakeRecorder.made.at(-1)?.state).toBe('recording')
    hear(mic, 0.3, 1000)
    hear(mic, 0, 800)
    await settle()
    expect(events.turn).toHaveBeenCalledOnce()
    mic.close()
  })
})

describe('a mic iOS stopped, with its track still saying it’s live', () => {
  const gum = vi.fn(async () => ({ getAudioTracks: () => [{}], getTracks: () => [] }))
  beforeEach(() => {
    vi.useFakeTimers()
    FakeRecorder.made = []
    FakeSocket.made = []
    FakeSocket.refuse = false
    replaced.mockClear()
    gum.mockClear()
    FakePeer.report = { type: 'media-source', kind: 'audio', audioLevel: 0.1, totalSamplesDuration: 1 }
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } })
  })
  afterEach(() => {
    vi.useRealTimers()
    FakePeer.report = undefined
  })
  const run = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      await vi.advanceTimersByTimeAsync(100)
      if (FakePeer.report && t < 300) FakePeer.report.totalSamplesDuration = 1 + t / 1000
    }
  }

  it('is noticed from the audio not arriving, and replaced with a new recording', async () => {
    const { mic } = await opened('agent')
    const ear = FakeSocket.made[0]
    await run(2500)
    expect(gum).toHaveBeenCalledTimes(2)
    expect(replaced).toHaveBeenCalledOnce()
    expect(ear.told()).toContainEqual({ restart: true })
    expect(FakeRecorder.made).toHaveLength(2)
    expect(FakeRecorder.made[0].state).toBe('inactive')
    expect(FakeRecorder.made[1].state).toBe('recording')
    mic.close()
  })

  it('says so if it can’t be got back', async () => {
    const { mic, events } = await opened('agent')
    gum.mockRejectedValueOnce(new Error('no'))
    await run(2500)
    expect(events.deaf).toHaveBeenCalled()
    mic.close()
  })

  it('leaves a mic that’s working alone', async () => {
    const { mic } = await opened('agent')
    for (let t = 0; t < 40; t++) {
      FakePeer.report!.totalSamplesDuration = 1 + t / 10
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(gum).toHaveBeenCalledOnce()
    mic.close()
  })
})

describe('a mic closed while it’s still opening', () => {
  it('lets go of the microphone, so it doesn’t stay on with nobody using it', async () => {
    const stopped = vi.fn()
    const before = navigator
    let lent!: (stream: unknown) => void
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise((done) => (lent = done)) } })
    const mic = new RecorderMic({ level() {}, speechStart() {}, turn() {}, barge() {} })
    const opening = mic.open()
    await settle()
    mic.close()
    lent({ getAudioTracks: () => [{}], getTracks: () => [{ stop: stopped }] })
    await opening
    vi.stubGlobal('navigator', before)
    expect(stopped).toHaveBeenCalledOnce()
  })
})

describe('taking turns without Web Audio', () => {
  beforeEach(() => {
    FakeRecorder.made = []
  })

  it('hands over the recording when you stop talking', async () => {
    const { mic, events } = await opened()
    mic.setMode('listen')
    hear(mic, 0.3, 1000)
    expect(events.speechStart).toHaveBeenCalledOnce()
    hear(mic, 0, 800)
    await settle()
    expect(events.turn).toHaveBeenCalledOnce()
    // And the next one's already recording, so nothing falls between turns.
    expect(FakeRecorder.made.at(-1)?.state).toBe('recording')
    mic.close()
  })

  it('takes no notice of a cough', async () => {
    const { mic, events } = await opened()
    mic.setMode('listen')
    hear(mic, 0.3, 100)
    hear(mic, 0, 800)
    await settle()
    expect(events.turn).not.toHaveBeenCalled()
    mic.close()
  })

  it('needs more to call it an interruption, then stops the agent', async () => {
    const { mic, events } = await opened()
    mic.setMode('barge')
    hear(mic, 0.02, 1000)
    expect(events.barge).not.toHaveBeenCalled()
    hear(mic, 0.3, 400)
    expect(events.barge).toHaveBeenCalledOnce()
    expect(mic.mode).toBe('listen')
    // What you said over it is the start of your turn.
    hear(mic, 0.3, 500)
    hear(mic, 0, 800)
    await settle()
    expect(events.turn).toHaveBeenCalledOnce()
    mic.close()
  })

  it('hears the end of what you said over a long reply, in a room that isn’t silent', async () => {
    const { mic, events } = await opened()
    mic.setMode('listen')
    hear(mic, 0.015, 2000)
    mic.setMode('barge')
    // Echo cancelling all but silences the mic while the agent talks, which says nothing of the room.
    hear(mic, 0.001, 20_000)
    hear(mic, 0.3, 1000)
    expect(events.barge).toHaveBeenCalledOnce()
    hear(mic, 0.02, 900)
    await settle()
    expect(events.turn).toHaveBeenCalledOnce()
    mic.close()
  })

  it('ends a turn on your own voice dropping away, when the room comes back louder than it was', async () => {
    const { mic, events } = await opened()
    mic.setMode('listen')
    hear(mic, 0.002, 2000)
    hear(mic, 0.3, 1000)
    hear(mic, 0.03, 900)
    await settle()
    expect(events.turn).toHaveBeenCalledOnce()
    mic.close()
  })

  it('keeps a quiet end to a sentence in the turn', async () => {
    const { mic, events } = await opened()
    mic.setMode('listen')
    hear(mic, 0.3, 1000)
    hear(mic, 0.1, 2000)
    await settle()
    expect(events.turn).not.toHaveBeenCalled()
    mic.close()
  })

  it('hands over what it has when a recording never says it stopped', async () => {
    vi.useFakeTimers()
    const { mic, events } = await opened()
    mic.setMode('listen')
    const stuck = FakeRecorder.made.at(-1)!
    stuck.stop = () => {}
    hear(mic, 0.3, 1000)
    hear(mic, 0, 800)
    await vi.advanceTimersByTimeAsync(2000)
    expect(events.turn).toHaveBeenCalledOnce()
    vi.useRealTimers()
    mic.close()
  })

  it('ends your turn on a tap', async () => {
    const { mic, events } = await opened()
    mic.setMode('listen')
    hear(mic, 0.3, 1000)
    mic.finish()
    await settle()
    expect(events.turn).toHaveBeenCalledOnce()
    mic.close()
  })

  it('hands over what it has when the recording already ended by itself', async () => {
    const { mic, events } = await opened()
    mic.setMode('listen')
    const gone = FakeRecorder.made.at(-1)!
    gone.state = 'inactive'
    gone.stop = () => {}
    hear(mic, 0.3, 1000)
    hear(mic, 0, 800)
    await settle()
    expect(events.turn).toHaveBeenCalledOnce()
    mic.close()
  })

  it('isn’t talked down by a loud room', async () => {
    const { mic, events } = await opened()
    mic.setMode('listen')
    hear(mic, 0.3, 1000)
    hear(mic, 0.05, 900)
    await settle()
    expect(events.turn).toHaveBeenCalledOnce()
    mic.close()
  })

  it('hears nothing with the mic off', async () => {
    const { mic, events } = await opened()
    hear(mic, 0.3, 1000)
    expect(events.speechStart).not.toHaveBeenCalled()
    mic.close()
  })

  it('starts the recording over while nobody’s talking, so a turn doesn’t carry a long silence', async () => {
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(0)
    const { mic } = await opened()
    mic.setMode('listen')
    now.mockReturnValue(9000)
    hear(mic, 0, 100)
    expect(FakeRecorder.made).toHaveLength(2)
    now.mockRestore()
    mic.close()
  })

  it('leaves the recording alone once someone may be starting to talk, so their first words stay in it', async () => {
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(0)
    const { mic } = await opened()
    mic.setMode('barge')
    now.mockReturnValue(9000)
    hear(mic, 0.3, 100)
    expect(FakeRecorder.made).toHaveLength(1)
    now.mockRestore()
    mic.close()
  })
})
