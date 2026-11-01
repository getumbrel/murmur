import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Moving a call to another voice. The voices, the mic and the chat are stand-ins: only the moves run.
type On = { ready: () => void; said: (whole?: string) => void }
const lives: FakeLive[] = []
const mics: FakeMic[] = []
const mouths: FakeMouth[] = []
let status = 'idle'
let refuse = false

class FakeLive {
  closed = false
  busy = false
  greeted = 0
  history: unknown
  constructor(
    _: string,
    public on: On,
    public way: string,
  ) {
    lives.push(this)
  }
  async start(_: string, history: unknown) {
    this.history = history
    if (refuse) throw new Error('no')
  }
  greet() {
    this.greeted++
  }
  say() {}
  close() {
    this.closed = true
  }
}
class FakeMic {
  closed = false
  mode = 'off'
  finishOpening!: () => void
  constructor() {
    mics.push(this)
  }
  open() {
    return new Promise<void>((done) => (this.finishOpening = done))
  }
  setMode(mode: string) {
    this.mode = mode
  }
  setMuted() {}
  close() {
    this.closed = true
  }
}
class FakeMouth {
  busy = false
  stops = 0
  onIdle?: () => void
  onStart?: () => void
  constructor() {
    mouths.push(this)
  }
  unlock() {}
  stop() {
    this.stops++
  }
  say() {}
}

vi.mock('@/hermes/rest', () => ({ api: { post: async () => ({ ok: true }), get: async () => ({}) }, HermesError: class extends Error {} }))
vi.mock('@/state/chats', () => ({
  getChat: () => ({ status, items: [{ kind: 'user', id: 'u', text: 'My dog is Biscuit', at: 1 }] }),
  keepSpoken: async () => {},
  send: async () => {},
  stop: async () => {},
  useChats: { subscribe: () => () => {} },
}))
vi.mock('./live', () => ({ LiveCall: FakeLive, liveInstructions: () => 'rules', openaiLiveInstructions: () => 'name', liveStartError: () => 'Couldn’t connect' }))
vi.mock('./mic', () => ({ Mic: FakeMic, micError: () => '' }))
vi.mock('./recorder-mic', () => ({ RecorderMic: FakeMic, recorderSupported: () => false }))
vi.mock('./voice', () => ({ Voice: FakeMouth, Sentences: class {} }))
vi.mock('./stream-voice', () => ({ StreamVoice: FakeMouth }))
vi.mock('./piece-voice', () => ({ PieceVoice: class {}, piecesSupported: () => false }))
vi.mock('./ios', () => ({ isIOS: () => false }))
vi.mock('./sounds', () => ({ closeSounds() {}, loopSound: () => () => {}, playSound() {}, unlockSounds() {} }))
vi.mock('@/features/voice/speech', () => ({ stopSpeaking() {} }))
vi.stubGlobal('navigator', { userAgent: 'Macintosh', maxTouchPoints: 0 })

const { endCall, startCall, switchVoice, useTalk } = await import('./talk')

const settle = () => vi.advanceTimersByTimeAsync(10)
const call = async (engine: 'chatgpt' | 'openai' | 'chained', more: object = {}) => {
  startCall({ engine, chatId: 'chat-1', profile: 'agent', keeps: true, ...more })
  await settle()
  if (engine === 'chained') {
    mics.at(-1)!.finishOpening()
    await settle()
  } else lives.at(-1)!.on.ready()
}
const talk = () => useTalk.getState()
const alive = () => lives.filter((l) => !l.closed)

describe('moving a call to another voice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    lives.length = mics.length = mouths.length = 0
    status = 'idle'
    refuse = false
  })
  afterEach(() => {
    endCall()
    vi.useRealTimers()
  })

  it('carries on the same call in the new voice, knowing the chat, without a greeting', async () => {
    await call('chatgpt')
    const { startedAt, chatId } = talk()
    expect(lives[0].greeted).toBe(1)
    switchVoice({ engine: 'openai', keeps: true }, 'OpenAI API')
    expect(lives[0].closed).toBe(true)
    expect(talk().switching).toBe('OpenAI API')
    await settle()
    lives[1].on.ready()
    expect(lives[1].way).toBe('openai')
    expect(lives[1].greeted).toBe(0)
    expect(JSON.stringify(lives[1].history)).toContain('My dog is Biscuit')
    expect(talk()).toMatchObject({ open: true, engine: 'openai', phase: 'listening', switching: undefined, startedAt, chatId })
  })

  it('lets an answer finish in the voice that started it, then moves', async () => {
    await call('chatgpt')
    lives[0].busy = true
    switchVoice({ engine: 'chained', stream: true }, 'Local')
    expect(talk().switching).toBe('Local')
    await settle()
    expect(lives[0].closed).toBe(false)
    lives[0].busy = false
    lives[0].on.said()
    expect(lives[0].closed).toBe(true)
    await settle()
    expect(mics).toHaveLength(1)
  })

  it('doesn’t cut off someone talking', async () => {
    await call('chained', { stream: true })
    useTalk.setState({ phase: 'hearing' })
    switchVoice({ engine: 'chatgpt' }, 'ChatGPT')
    await settle()
    expect(mics[0].closed).toBe(false)
    expect(lives).toHaveLength(0)
  })

  it('only changes the mouth between two of Hermes’s own voices, and the mic stays', async () => {
    await call('chained', { stream: true })
    switchVoice({ engine: 'chained', stream: false }, 'ElevenLabs API')
    await settle()
    expect(mics).toHaveLength(1)
    expect(mics[0].closed).toBe(false)
    expect(talk()).toMatchObject({ phase: 'listening', switching: undefined })
  })

  it('does nothing when it’s the voice in use', async () => {
    await call('chatgpt')
    switchVoice({ engine: 'chatgpt' }, 'ChatGPT')
    await settle()
    expect(lives).toHaveLength(1)
    expect(talk().switching).toBeUndefined()
  })

  it('leaves one session and one working mic after switching back and forth', async () => {
    await call('chatgpt')
    switchVoice({ engine: 'chained', stream: true }, 'Local')
    await settle()
    switchVoice({ engine: 'openai' }, 'OpenAI API')
    await settle()
    switchVoice({ engine: 'chained', stream: true }, 'Local')
    await settle()
    switchVoice({ engine: 'chatgpt' }, 'ChatGPT')
    await settle()
    switchVoice({ engine: 'chained', stream: true }, 'Local')
    await settle()
    expect(alive()).toHaveLength(0)
    const [last, ...stale] = [...mics].reverse()
    for (const mic of stale) mic.finishOpening()
    await settle()
    expect(stale.every((m) => m.closed)).toBe(true)
    expect(last.closed).toBe(false)
    last.finishOpening()
    await settle()
    expect(last.closed).toBe(false)
    expect(last.mode).toBe('listen')
    expect(talk()).toMatchObject({ phase: 'listening', switching: undefined, engine: 'chained' })
  })

  it('keeps the latest choice when a voice is still connecting', async () => {
    await call('chatgpt')
    switchVoice({ engine: 'openai' }, 'OpenAI API')
    await settle()
    switchVoice({ engine: 'chatgpt' }, 'ChatGPT')
    await settle()
    expect(alive()).toHaveLength(1)
    expect(alive()[0].way).toBe('chatgpt')
    alive()[0].on.ready()
    expect(alive()[0].greeted).toBe(0)
    expect(talk().switching).toBeUndefined()
  })

  it('carries on in the voice it had if the new one doesn’t pick up', async () => {
    await call('chained', { stream: true })
    refuse = true
    switchVoice({ engine: 'chatgpt' }, 'ChatGPT')
    await settle()
    await settle()
    expect(mics).toHaveLength(2)
    mics[1].finishOpening()
    await settle()
    expect(talk()).toMatchObject({ open: true, engine: 'chained', phase: 'listening', switching: undefined })
  })

  it('lets go of everything if you hang up in the middle of it', async () => {
    await call('chatgpt')
    switchVoice({ engine: 'chained', stream: true }, 'Local')
    endCall()
    await settle()
    expect(mics).toHaveLength(0)
    expect(alive()).toHaveLength(0)
    expect(talk()).toMatchObject({ open: false, switching: undefined })
  })
})
