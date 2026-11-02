import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The agent hanging up once it has said goodbye. The voices, the mic and the chat are stand-ins.
type Events = { speechStart: () => void; barge: () => void; nothing: () => void }
type On = { ready: () => void; hearing: (words: string) => void; saying: (text: string) => void; said: () => void; request: (id: string, text: string) => void }

let status = 'idle'
let items: { kind: string; id: string; text: string; streaming?: boolean }[] = []
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())
const send = vi.fn(async (..._: unknown[]) => {})

class FakeMic {
  static last: FakeMic
  mode = 'off'
  closed = false
  constructor(public events: Events) {
    FakeMic.last = this
  }
  open = async () => {}
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
  said: string[] = []
  onIdle?: () => void
  onStart?: () => void
  unlock() {}
  stop() {}
  say(s: string) {
    this.said.push(s)
  }
}
class FakeLive {
  static last: FakeLive
  said: string[] = []
  closed = false
  busy = false
  constructor(
    _: string,
    public on: On,
  ) {
    FakeLive.last = this
  }
  start = async () => {}
  greet() {}
  note() {}
  say(_: string, s: string) {
    this.said.push(s)
  }
  setMuted() {}
  close() {
    this.closed = true
  }
}
const mouths: FakeMouth[] = []

vi.mock('@/hermes/rest', () => ({ api: { post: async () => ({ ok: true }), get: async () => ({}) }, HermesError: class extends Error {} }))
vi.mock('@/state/chats', () => ({
  getChat: () => ({ status, items }),
  keepSpoken: async () => {},
  send,
  stop: async () => {},
  useChats: {
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  },
}))
vi.mock('./live', () => ({ LiveCall: FakeLive, liveInstructions: () => 'rules', openaiLiveInstructions: () => 'name', liveStartError: () => '' }))
vi.mock('./mic', () => ({ Mic: FakeMic, micError: () => '' }))
vi.mock('./recorder-mic', () => ({ RecorderMic: FakeMic, recorderSupported: () => false }))
vi.mock('./voice', async (real) => ({
  ...(await real<typeof import('./voice')>()),
  Voice: class extends FakeMouth {
    constructor() {
      super()
      mouths.push(this)
    }
  },
}))
vi.mock('./stream-voice', () => ({ StreamVoice: FakeMouth }))
vi.mock('./piece-voice', () => ({ PieceVoice: class {}, piecesSupported: () => false }))
vi.mock('./ios', () => ({ isIOS: () => false }))
vi.mock('./sounds', () => ({ closeSounds() {}, loopSound: () => () => {}, playSound() {}, unlockSounds() {} }))
vi.mock('@/features/voice/speech', () => ({ stopSpeaking() {} }))
vi.stubGlobal('navigator', { userAgent: 'Macintosh', maxTouchPoints: 0 })
vi.stubGlobal(
  'FileReader',
  class {
    result = 'data:audio/wav;base64,'
    onload?: () => void
    readAsDataURL() {
      this.onload?.()
    }
  },
)

const { endCall, startCall, useTalk } = await import('./talk')
const talk = () => useTalk.getState()
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms)
const voice = () => mouths.at(-1)!

/** The agent's reply to the turn just sent, written in full. */
const reply = (text: string) => {
  const [, , , { itemId }] = send.mock.calls.at(-1) as [string, string, unknown, { itemId: string }]
  items = [{ kind: 'user', id: itemId, text: 'ok thanks, bye' }, { kind: 'assistant', id: 'a', text }]
  status = 'idle'
  changed()
}

/** A call on Hermes's own voices, with your first turn sent and the agent answering it. */
async function chained(answer: string) {
  startCall({ engine: 'chained', chatId: 'chat-1', profile: 'agent' })
  await wait(10)
  const { events } = FakeMic.last
  events.speechStart()
  // (The turn itself: the mic hands over a recording, which Hermes transcribes.)
  const { api } = await import('@/hermes/rest')
  vi.spyOn(api, 'post').mockResolvedValueOnce({ transcript: 'ok thanks, bye' })
  ;(FakeMic.last.events as unknown as { turn: (wav: Blob) => void }).turn(new Blob())
  await wait(10)
  status = 'running'
  reply(answer)
  // It has said it.
  voice().onIdle?.()
  return events
}

describe('the agent hanging up', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    send.mockClear()
    mouths.length = 0
    items = []
    status = 'idle'
  })
  afterEach(() => {
    endCall()
    vi.useRealTimers()
  })

  it('tells the agent it can, every turn', async () => {
    await chained('Bye!\n::hangup')
    const [, , , { voice: turn }] = send.mock.calls[0] as [string, string, unknown, { voice: { context: string } }]
    expect(turn.context).toContain('::hangup')
  })

  it('hangs up once its goodbye is said, and shows the call ended before it goes', async () => {
    await chained('Bye, talk soon!\n::hangup')
    expect(voice().said).toEqual(['Bye, talk soon!'])
    // A beat for one more thing.
    expect(talk()).toMatchObject({ open: true, phase: 'listening' })
    await wait(1200)
    expect(talk()).toMatchObject({ open: true, phase: 'ended' })
    expect(talk().endedAt).toBeGreaterThan(0)
    expect(FakeMic.last.mode).toBe('off')
    await wait(1400)
    expect(talk().open).toBe(false)
  })

  it('carries on when it doesn’t say goodbye', async () => {
    await chained('Sure, anything else?')
    await wait(5000)
    expect(talk()).toMatchObject({ open: true, phase: 'listening' })
  })

  it('carries on when you say something after its goodbye', async () => {
    const events = await chained('Bye!\n::hangup')
    events.speechStart()
    await wait(5000)
    expect(talk()).toMatchObject({ open: true, phase: 'hearing' })
  })

  it('still hangs up if what you said was nothing (a cough)', async () => {
    const events = await chained('Bye!\n::hangup')
    events.speechStart()
    events.nothing()
    await wait(1200)
    expect(talk().phase).toBe('ended')
  })

  it('carries on when you talk over its goodbye', async () => {
    startCall({ engine: 'chained', chatId: 'chat-1', profile: 'agent' })
    await wait(10)
    const { api } = await import('@/hermes/rest')
    vi.spyOn(api, 'post').mockResolvedValueOnce({ transcript: 'ok thanks, bye' })
    ;(FakeMic.last.events as unknown as { turn: (wav: Blob) => void }).turn(new Blob())
    await wait(10)
    voice().busy = true
    reply('Bye!\n::hangup')
    FakeMic.last.events.barge()
    voice().busy = false
    voice().onIdle?.()
    await wait(5000)
    expect(talk().open).toBe(true)
    expect(talk().phase).not.toBe('ended')
  })

  it('hangs up a live call once the voice has said the agent’s goodbye', async () => {
    startCall({ engine: 'chatgpt', chatId: 'chat-1', profile: 'agent' })
    await wait(10)
    const live = FakeLive.last
    live.on.ready()
    live.on.request('d1', 'They are saying goodbye.')
    await wait(1600)
    reply('Goodbye, Mayank!\n::hangup')
    expect(live.said).toEqual(['Goodbye, Mayank!'])
    live.on.said()
    await wait(1200)
    expect(talk().phase).toBe('ended')
    await wait(1400)
    expect(talk().open).toBe(false)
    expect(live.closed).toBe(true)
  })

  it('waits for the live voice to finish the goodbye, even when its own words end first', async () => {
    startCall({ engine: 'chatgpt', chatId: 'chat-1', profile: 'agent' })
    await wait(10)
    const live = FakeLive.last
    live.on.ready()
    live.on.request('d1', 'They are saying goodbye.')
    await wait(1600)
    reply('You’re welcome, have a lovely evening!\n::hangup')
    // Its own "Take care." ends just as it starts on the agent's goodbye.
    live.on.said()
    live.busy = true
    live.on.saying('You’re welcome, have a lovely evening!')
    await wait(3000)
    expect(talk().phase).toBe('speaking')
    live.busy = false
    live.on.said()
    await wait(1200)
    expect(talk().phase).toBe('ended')
  })

  it('says one goodbye when the live voice has already said its own', async () => {
    startCall({ engine: 'chatgpt', chatId: 'chat-1', profile: 'agent' })
    await wait(10)
    const live = FakeLive.last
    live.on.ready()
    live.on.request('d1', 'They are saying goodbye.')
    await wait(1600)
    live.busy = true
    live.on.saying('Take care.')
    reply('You’re welcome. Bye!\n::hangup')
    expect(live.said).toEqual([])
    live.busy = false
    live.on.said()
    await wait(1200)
    expect(talk().phase).toBe('ended')
  })

  it('still says the answer when the voice filled in first and it isn’t a goodbye', async () => {
    startCall({ engine: 'chatgpt', chatId: 'chat-1', profile: 'agent' })
    await wait(10)
    const live = FakeLive.last
    live.on.ready()
    live.on.request('d1', 'What time is it?')
    await wait(1600)
    live.on.saying('On it.')
    live.on.said()
    const [, , , { itemId }] = send.mock.calls.at(-1) as [string, string, unknown, { itemId: string }]
    items = [{ kind: 'user', id: itemId, text: 'What time is it?' }, { kind: 'assistant', id: 'a', text: 'It’s 5:25 PM. Anything ', streaming: true }]
    status = 'running'
    changed()
    expect(live.said).toEqual([])
    items = [items[0], { kind: 'assistant', id: 'a', text: 'It’s 5:25 PM. Anything else?' }]
    status = 'idle'
    changed()
    expect(live.said).toEqual(['It’s 5:25 PM.', 'Anything else?'])
    live.on.said()
    await wait(5000)
    expect(talk()).toMatchObject({ open: true, phase: 'listening' })
  })

  it('says a longer answer as it comes, even when the voice filled in first', async () => {
    startCall({ engine: 'chatgpt', chatId: 'chat-1', profile: 'agent' })
    await wait(10)
    const live = FakeLive.last
    live.on.ready()
    live.on.request('d1', 'Three things to do in Bangkok?')
    await wait(1600)
    live.on.saying('On it.')
    live.on.said()
    const [, , , { itemId }] = send.mock.calls.at(-1) as [string, string, unknown, { itemId: string }]
    const user = { kind: 'user', id: itemId, text: 'Three things to do in Bangkok?' }
    items = [user, { kind: 'assistant', id: 'a', text: 'Here are three. Visit the Grand Palace. ', streaming: true }]
    status = 'running'
    changed()
    expect(live.said).toEqual([])
    items = [user, { kind: 'assistant', id: 'a', text: 'Here are three. Visit the Grand Palace. Walk Chatuchak market. Eat ', streaming: true }]
    changed()
    expect(live.said).toEqual(['Here are three.', 'Visit the Grand Palace.', 'Walk Chatuchak market.'])
    items = [user, { kind: 'assistant', id: 'a', text: 'Here are three. Visit the Grand Palace. Walk Chatuchak market. Eat on Yaowarat Road.' }]
    status = 'idle'
    changed()
    expect(live.said.at(-1)).toBe('Eat on Yaowarat Road.')
  })

  it('keeps a live call going when you speak after the goodbye', async () => {
    startCall({ engine: 'chatgpt', chatId: 'chat-1', profile: 'agent' })
    await wait(10)
    const live = FakeLive.last
    live.on.ready()
    live.on.request('d1', 'They are saying goodbye.')
    await wait(1600)
    reply('Bye!\n::hangup')
    live.on.said()
    live.on.hearing('oh wait')
    await wait(5000)
    expect(talk().open).toBe(true)
  })
})
