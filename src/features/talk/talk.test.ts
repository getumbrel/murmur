import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// What a live call keeps in the chat. The call's own parts are stand-ins: only the bookkeeping runs.
type On = {
  ready: () => void
  heard: (text: string) => void
  hearing: (text: string) => void
  saying: (text: string) => void
  said: (whole?: string) => void
  request: (id: string, text: string) => void
}
let on: On
const keepSpoken = vi.fn(async (..._: unknown[]) => {})
const send = vi.fn(async (..._: unknown[]) => {})
let status = 'idle'
let items: unknown[] = []
const started = vi.fn()
const stopReply = vi.fn(async () => {})
const told = vi.fn()
const said = vi.fn()
// The chat changing: what the call follows.
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())

vi.mock('@/hermes/rest', () => ({
  api: { post: async () => ({ ok: true }), get: async () => ({}) },
  HermesError: class extends Error {
    status = 409
  },
}))
vi.mock('@/state/chats', () => ({
  getChat: () => ({ status, items }),
  keepSpoken,
  send,
  stop: stopReply,
  useChats: {
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  },
}))
vi.mock('./live', () => ({
  LiveCall: class {
    constructor(_: string, callbacks: On) {
      on = callbacks
    }
    start = async (...args: unknown[]) => started(...args)
    greet() {}
    say = said
    note = told
    close() {}
  },
  liveInstructions: () => 'the voice’s rules',
  openaiLiveInstructions: () => 'the voice’s name',
  liveStartError: () => '',
}))
vi.mock('./sounds', () => ({ closeSounds() {}, loopSound: () => () => {}, playSound() {}, unlockSounds() {} }))
vi.mock('./mic', () => ({ Mic: class {}, micError: () => '' }))
vi.mock('./recorder-mic', () => ({ RecorderMic: class {}, recorderSupported: () => false }))
vi.mock('./voice', () => ({
  Sentences: class {},
  Voice: class {
    unlock() {}
    stop() {}
  },
}))
vi.mock('./stream-voice', () => ({
  StreamVoice: class {
    unlock() {}
    stop() {}
  },
}))
vi.mock('@/features/voice/speech', () => ({ stopSpeaking() {} }))
vi.stubGlobal('navigator', { userAgent: 'Macintosh', maxTouchPoints: 0 })

const { endCall, startCall, useTalk } = await import('./talk')

const call = (more: object = {}) => startCall({ engine: 'chatgpt', keeps: true, chatId: 'chat-1', profile: 'agent', origin: { x: 0, y: 0 }, ...more })
const say = (you: string, voice: string) => {
  on.heard(you)
  on.saying(voice)
  on.said()
}
const settle = async (ms = 1600) => {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('a live call', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    keepSpoken.mockClear()
    send.mockClear()
    status = 'idle'
  })
  afterEach(() => {
    endCall()
    vi.useRealTimers()
  })

  it('picks up the chat it’s called from', async () => {
    items = [{ kind: 'user', id: 'u', text: 'My dog is Biscuit', at: 1 }]
    started.mockClear()
    call()
    await settle()
    items = []
    const [, opening] = started.mock.calls[0]
    expect(opening.at(-2).content[0].text).toBe('My dog is Biscuit')
  })

  it('tells a voice on a ChatGPT plan its rules last, in any chat: its instructions don’t reach it', async () => {
    started.mockClear()
    call()
    await settle()
    const [instructions, opening] = started.mock.calls[0]
    expect(instructions).toBe('the voice’s rules')
    expect(opening).toHaveLength(1)
    expect(opening[0].role).toBe('developer')
    expect(opening[0].content[0].text).toBe('the voice’s rules')
    endCall()
    items = [{ kind: 'user', id: 'u', text: 'My dog is Biscuit', at: 1 }]
    started.mockClear()
    call()
    await settle()
    items = []
    expect(started.mock.calls[0][1].at(-1).content[0].text).toBe('the voice’s rules')
  })

  it('leaves a voice on an OpenAI key to its instructions, the documented way', async () => {
    started.mockClear()
    call({ engine: 'openai' })
    await settle()
    expect(started).toHaveBeenCalledWith('the voice’s name', [])
  })

  it('keeps what the voice answered by itself', async () => {
    call()
    say('Hey there.', 'Hey! Good to hear from you.')
    await settle()
    expect(keepSpoken).toHaveBeenCalledExactlyOnceWith('chat-1', 'Hey there.', 'Hey! Good to hear from you.', expect.any(String))
  })

  it('leaves a request to the agent, which saves it itself', async () => {
    call()
    say('What’s the weather?', 'Let me check.')
    on.request('d1', 'What’s the weather?')
    await settle()
    expect(keepSpoken).not.toHaveBeenCalled()
  })

  it('doesn’t keep what it says for the agent', async () => {
    call()
    on.heard('What’s the weather?')
    on.request('d1', 'What’s the weather?')
    await settle(800)
    on.saying('Sunny tomorrow.')
    on.said()
    await settle()
    expect(keepSpoken).not.toHaveBeenCalled()
  })

  it('doesn’t keep its greeting', async () => {
    call()
    on.saying('Hi! I’m here.')
    on.said()
    await settle()
    expect(keepSpoken).not.toHaveBeenCalled()
  })

  it('goes by the voice’s own record of what it said', async () => {
    call()
    on.heard('How are you?')
    on.saying('well.')
    on.said('I’m doing well.')
    await settle()
    expect(keepSpoken).toHaveBeenCalledExactlyOnceWith('chat-1', 'How are you?', 'I’m doing well.', expect.any(String))
  })

  it('doesn’t run its greeting into the first answer', async () => {
    call()
    on.saying('Hey.')
    on.said()
    say('How are you?', 'Doing well, thanks.')
    await settle()
    expect(keepSpoken).toHaveBeenCalledExactlyOnceWith('chat-1', 'How are you?', 'Doing well, thanks.', expect.any(String))
  })

  it('asks the agent in the words of this turn, not the last one', async () => {
    call()
    say('Hey there.', 'Hi!')
    await settle()
    on.hearing('What’s the')
    on.heard('What’s the weather?')
    on.request('d1', 'the voice’s wording')
    await settle(800)
    expect((send.mock.calls[0] as unknown[])[1]).toBe('What’s the weather?')
  })

  it('waits for your words when the request gets there first', async () => {
    call()
    say('Hey there.', 'Hi!')
    await settle()
    on.hearing('What’s the')
    on.request('d1', 'the voice’s wording')
    await settle(300)
    expect(send).not.toHaveBeenCalled()
    on.heard('What’s the weather?')
    await settle(300)
    expect((send.mock.calls[0] as unknown[])[1]).toBe('What’s the weather?')
    // And they aren't kept a second time as something the voice answered.
    on.saying('Checking now.')
    on.said()
    await settle()
    expect(keepSpoken).toHaveBeenCalledOnce()
  })

  it('goes with the voice’s wording if your words never come', async () => {
    call()
    on.hearing('Hmm')
    on.request('d1', 'the voice’s wording')
    await settle(2000)
    expect((send.mock.calls[0] as unknown[])[1]).toBe('the voice’s wording')
  })

  it('keeps exchanges in the order they were said', async () => {
    call()
    say('Hey.', 'Hi!')
    say('How are you?', 'Good, thanks.')
    await settle()
    expect(keepSpoken.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['Hey.', 'How are you?'])
  })

  it('waits for the agent to finish', async () => {
    status = 'running'
    call()
    say('Hey.', 'Hi!')
    await settle(5000)
    expect(keepSpoken).not.toHaveBeenCalled()
    status = 'idle'
    await settle(500)
    expect(keepSpoken).toHaveBeenCalledOnce()
  })

  it('keeps the last exchange when the call ends', async () => {
    call()
    say('Bye.', 'Bye!')
    endCall()
    await settle(100)
    expect(keepSpoken).toHaveBeenCalledOnce()
  })

  it('makes a blank chat on your first words', async () => {
    const newChat = vi.fn(async () => 'chat-2')
    call({ chatId: undefined, newChat })
    expect(newChat).not.toHaveBeenCalled()
    say('Hey.', 'Hi!')
    say('Still there?', 'Yes.')
    await settle()
    expect(newChat).toHaveBeenCalledOnce()
    expect(keepSpoken.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['chat-2', 'chat-2'])
  })

  it('leaves a Hermes without the plugin as it is', async () => {
    const newChat = vi.fn(async () => 'chat-2')
    call({ chatId: undefined, newChat, keeps: false })
    say('Hey.', 'Hi!')
    await settle()
    expect(newChat).not.toHaveBeenCalled()
    expect(keepSpoken).not.toHaveBeenCalled()
  })
})

describe('its browser on a call', () => {
  const tool = (name: string, detail: string, state = 'running') => ({ kind: 'tool', id: name, name, label: name, detail, status: state, startedAt: 1 })
  const REASON = 'Confirm you’re a person on Hearth & Bean, then I’ll place the order.'
  /** Asks the agent for something, and returns what its turn then shows: these items after your words. */
  const asked = async (...after: unknown[]) => {
    call()
    on.heard('Reorder my coffee')
    on.request('d1', 'Reorder my coffee')
    await settle(800)
    const { itemId } = (send.mock.calls.at(-1) as unknown[])[3] as { itemId: string }
    status = 'running'
    items = [{ kind: 'user', id: itemId, text: 'Reorder my coffee', at: 1 }, ...after]
    changed()
    return (...next: unknown[]) => {
      items = [items[0], ...next]
      changed()
    }
  }
  const browser = () => useTalk.getState().stage.find((i) => i.kind === 'browser')

  beforeEach(() => {
    vi.useFakeTimers()
    send.mockClear()
    stopReply.mockClear()
    told.mockClear()
    said.mockClear()
    status = 'idle'
    items = []
  })
  afterEach(() => {
    endCall()
    vi.useRealTimers()
  })

  it('shows a machine it drives as one screen, its latest picture', async () => {
    const shot = (n: number) => ({ key: 'umbrel/ubuntu', machine: 'ubuntu', path: `/opt/data/${n}.jpg`, w: 1280, h: 800 })
    const step = (n: number) => ({ ...tool('mcp__umbrel__control_machine', '', 'done'), id: `m${n}`, shot: shot(n) })
    await asked(step(1), step(2), step(3))
    const screens = useTalk.getState().stage.filter((i) => i.kind === 'machine')
    expect(screens).toHaveLength(1)
    expect(screens[0]).toMatchObject({ key: 'machine:umbrel/ubuntu', screen: { machine: 'ubuntu', shots: [shot(1), shot(2), shot(3)] } })
    expect(useTalk.getState().stage.some((i) => i.kind === 'media' || i.kind === 'steps')).toBe(false)
  })

  it('shows its browser while it works there, with the site', async () => {
    await asked(tool('browser_exec', 'hearthandbean.com'))
    expect(browser()).toMatchObject({ kind: 'browser', site: 'hearthandbean.com', ask: undefined })
  })

  it('brings a hand it asks for to the front, says what it needs and waits', async () => {
    await asked(tool('browser_exec', 'hearthandbean.com'), tool('ask_for_a_hand', REASON))
    expect(browser()?.kind === 'browser' && browser()?.ask?.detail).toBe(REASON)
    expect(useTalk.getState()).toMatchObject({ phase: 'waiting', activity: 'Needs you' })
    expect(told).toHaveBeenCalledWith('d1', expect.stringContaining(REASON))
  })

  it('doesn’t stop waiting when you ask for something meanwhile, and says to hand it back', async () => {
    await asked(tool('browser_exec', 'hearthandbean.com'), tool('ask_for_a_hand', REASON))
    send.mockClear()
    on.heard('Are you done yet?')
    on.request('d2', 'Are you done yet?')
    await settle(800)
    expect(stopReply).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(said).toHaveBeenCalledWith('d2', expect.stringMatching(/hand it back/i))
  })

  it('carries on once it’s handed back, its browser still showing', async () => {
    const next = await asked(tool('browser_exec', 'hearthandbean.com'), tool('ask_for_a_hand', REASON))
    next(tool('browser_exec', 'hearthandbean.com', 'done'), tool('ask_for_a_hand', REASON, 'done'), tool('browser_exec', 'hearthandbean.com'))
    expect(browser()).toMatchObject({ site: 'hearthandbean.com', ask: undefined })
    expect(useTalk.getState().phase).toBe('thinking')
  })
})
