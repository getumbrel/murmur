import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: class extends Error {} }))
vi.mock('./voice', () => ({ SILENCE: '' }))
vi.mock('./mic', () => ({}))

vi.stubGlobal('Audio', class {
  play = async () => {}
  pause() {}
})
let contexts = 0
vi.stubGlobal(
  'AudioContext',
  class {
    constructor() {
      contexts++
    }
    close = async () => {}
  },
)
vi.stubGlobal('cancelAnimationFrame', () => {})
const device = { userAgent: 'Macintosh', maxTouchPoints: 0 }
vi.stubGlobal('navigator', device)

const { LiveCall } = await import('./live')

type Event = { type: string; item?: { text: string }; turn?: { role: string; transcript?: string } }

/** A call on a ChatGPT plan, fed the events its control channel sends. */
function call() {
  const said = { heard: [] as string[], saying: [] as string[], whole: [] as (string | undefined)[] }
  const live = new LiveCall(
    'agent',
    {
      heard: (t: string) => said.heard.push(t),
      hearing: () => {},
      saying: (t: string) => said.saying.push(t),
      said: (whole?: string) => said.whole.push(whole),
    } as never,
    'chatgpt',
  )
  const feed = (e: Event) => (live as unknown as { event: (e: Event) => void }).event(e)
  return { said, feed }
}
const you = (text: string): Event => ({ type: 'input_transcript.added', item: { text } })
const voice = (text: string): Event => ({ type: 'output_transcript.added', item: { text } })
const done = (role: string, transcript?: string): Event => ({ type: 'turn.done', turn: { role, transcript } })

describe('what the live voice said', () => {
  it('keeps a short answer that was over before your turn was', () => {
    const { said, feed } = call()
    feed({ type: 'input_transcript.added', item: { text: 'What’s your name?' } })
    feed({ type: 'output_transcript.added', item: { text: 'I’m ' } })
    feed({ type: 'output_transcript.added', item: { text: 'Calltest.' } })
    feed(done('user', 'What’s your name?'))
    feed(done('assistant', 'I’m Calltest.'))
    expect(said.heard).toEqual(['What’s your name?'])
    expect(said.whole).toEqual(['I’m Calltest.'])
  })

  it('still takes no notice of a mm-hmm while you’re talking', () => {
    const { said, feed } = call()
    feed({ type: 'input_transcript.added', item: { text: 'So what I' } })
    feed({ type: 'output_transcript.added', item: { text: 'Mm-hmm.' } })
    feed(done('assistant', 'Mm-hmm.'))
    feed({ type: 'input_transcript.added', item: { text: ' wanted' } })
    feed(done('user', 'So what I wanted'))
    expect(said.whole).toEqual([])
  })

  it('doesn’t count a reply twice when you cut it off', () => {
    const { said, feed } = call()
    feed({ type: 'output_transcript.added', item: { text: 'The long ' } })
    feed({ type: 'input_transcript.added', item: { text: 'Stop' } })
    feed(done('user', 'Stop'))
    feed(done('assistant', 'The long answer'))
    expect(said.whole).toHaveLength(1)
  })

  it('goes by its own record of the turn, which has the words that arrive too early', () => {
    const { said, feed } = call()
    feed(you('How are you'))
    feed(voice('I’m doing '))
    feed(done('user', 'How are you?'))
    feed(voice('well.'))
    feed(done('assistant', ' I’m doing well. What’s on your mind?'))
    expect(said.whole).toEqual(['I’m doing well. What’s on your mind?'])
  })

  it('still ignores an mm-hmm while you’re talking', () => {
    const { said, feed } = call()
    feed(you('So I was thinking'))
    feed(voice('mm-hmm'))
    feed(you(' about tomorrow'))
    feed(done('user', 'So I was thinking about tomorrow.'))
    expect(said.saying).toEqual([])
  })
})

describe('a live call on an iPhone', () => {
  const iphone = (stats: object[]) => {
    device.userAgent = 'iPhone'
    contexts = 0
    const levels: number[] = []
    const live = new LiveCall('agent', { level: (l: number) => levels.push(l) } as never, 'chatgpt')
    device.userAgent = 'Macintosh'
    const inner = live as unknown as { pc: unknown; meter(stream: unknown): void; levels?: ReturnType<typeof setInterval> }
    inner.pc = { getStats: async () => stats, close() {} }
    return { live, inner, levels }
  }

  it('runs with no AudioContext, which would make its voice crackle', () => {
    iphone([])
    expect(contexts).toBe(0)
  })

  it('still has one on a computer', () => {
    contexts = 0
    new LiveCall('agent', {} as never, 'chatgpt')
    expect(contexts).toBe(1)
  })

  it('reads your level from the call’s own stats', async () => {
    vi.useFakeTimers()
    const { live, inner, levels } = iphone([{ type: 'media-source', kind: 'audio', audioLevel: 0.4 }])
    inner.meter({})
    await vi.advanceTimersByTimeAsync(350)
    live.close()
    vi.useRealTimers()
    expect(levels.length).toBeGreaterThan(1)
    expect(levels.at(-1)).toBeGreaterThan(0.5)
  })
})
