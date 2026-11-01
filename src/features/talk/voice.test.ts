import { describe, expect, it, vi } from 'vitest'

// Only the text handling and choices are under test; speaking needs a browser and a Hermes.
vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: class extends Error {} }))
vi.mock('./live', () => ({ liveStatus: () => Promise.resolve('sign-in') }))

const { Sentences, clauses, speakable } = await import('./voice')
const { agentLanguage, localPlace, pickVoice, voiceName, voiceRows } = await import('./voice-setup')
const { downloadLine } = await import('./local-voice')
type Voice = import('./voice-setup').Voice
type LocalVoice = import('./local-voice').LocalVoice
type LocalDownload = import('./local-voice').LocalDownload

describe('speakable', () => {
  it('drops what isn’t said: files, widgets, code, tables and markdown marks', () => {
    const reply = [
      'Here are **three** photos from [Lisbon](https://example.com):',
      'MEDIA:/opt/data/home/Pictures/a.jpg',
      '::preview{file="chart.html"}',
      '```js',
      'console.log(1)',
      '```',
      '| a | b |',
      '- Want an `album`?',
    ].join('\n')
    const said = speakable(reply).replace(/\s+/g, ' ').trim()
    expect(said).toBe('Here are three photos from Lisbon: Want an album?')
  })

  it('says links as "the link"', () => {
    expect(speakable('See https://umbrel.com/support for more.')).toBe('See the link for more.')
  })
})

describe('Sentences', () => {
  it('hands over each sentence once it’s finished, and the tail at the end', () => {
    const s = new Sentences()
    expect(s.take('I found 38 photos')).toEqual([])
    expect(s.take('I found 38 photos from April. Want me to')).toEqual(['I found 38 photos from April.'])
    expect(s.take('I found 38 photos from April. Want me to make an album?')).toEqual([])
    expect(s.take('I found 38 photos from April. Want me to make an album?', true)).toEqual(['Want me to make an album?'])
  })

  it('doesn’t break on decimals, and keeps very short pieces with the next', () => {
    const s = new Sentences()
    expect(s.take('Sure. It’s 18.5 degrees and clear. No rain until Thursday.', true)).toEqual([
      'Sure. It’s 18.5 degrees and clear.',
      'No rain until Thursday.',
    ])
  })

  it('skips the photos and widgets between sentences', () => {
    const s = new Sentences()
    const text = 'Here are a few.\n\nMEDIA:/a.jpg\nMEDIA:/b.jpg\n\nWant an album?'
    expect(s.take(text, true)).toEqual(['Here are a few.', 'Want an album?'])
  })
})

describe('cutting a sentence where a voice can breathe', () => {
  it('goes by the commas', () => {
    expect(clauses('Tomorrow looks sunny, around twenty degrees, with a light breeze.')).toEqual(['Tomorrow looks sunny,', 'around twenty degrees,', 'with a light breeze.'])
    expect(clauses('明天天气晴朗，大约二十度。')).toEqual(['明天天气晴朗，', '大约二十度。'])
  })
  it('leaves a short sentence alone', () => {
    expect(clauses('Sounds good.')).toEqual(['Sounds good.'])
  })
})

describe('the voice Talk picks by itself', () => {
  const voice = (chatgpt: boolean, openai: boolean, more: Partial<Voice> = {}) =>
    ({ unset: true, ready: false, localWorks: true, chatgpt: chatgpt ? 'ready' : 'sign-in', keys: { openai, elevenlabs: false }, ...more }) as Voice
  it('uses what this Hermes already has, and its own machine otherwise', () => {
    expect(pickVoice(voice(false, false))).toEqual(['local'])
    expect(pickVoice(voice(true, false), 'anthropic')).toEqual(['chatgpt', 'local'])
    expect(pickVoice(voice(false, true), 'openai-codex')).toEqual(['openai', 'local'])
  })
  it('with both, follows the service the agent’s own model runs on', () => {
    expect(pickVoice(voice(true, true), 'openai-codex')).toEqual(['chatgpt', 'openai', 'local'])
    expect(pickVoice(voice(true, true), 'openai')).toEqual(['openai', 'chatgpt', 'local'])
  })
  it('leaves a voice someone set up in Hermes as it is', () => {
    expect(pickVoice(voice(true, true, { ready: true }))).toEqual(['own'])
    expect(pickVoice(voice(false, false, { ready: true, choice: 'elevenlabs' }))).toEqual(['elevenlabs'])
    // One Murmur picked itself moves on when something better turns up.
    expect(pickVoice(voice(true, false, { unset: false, auto: true, ready: true, choice: 'local' }))).toEqual(['chatgpt', 'local'])
  })
  it('never picks what can’t talk', () => {
    expect(pickVoice(voice(false, false, { localWorks: false }))).toEqual([])
    expect(pickVoice(voice(false, false, { localWorks: false, keys: { openai: false, elevenlabs: true } }))).toEqual(['elevenlabs'])
    expect(pickVoice(voice(false, true, { localWorks: false }))).toEqual(['openai'])
  })
})

describe('the voice sheet', () => {
  const stock = { localWorks: false, chatgpt: 'unsupported' } as Voice
  it('leaves out what can’t work on this Hermes', () => {
    expect(voiceRows({ localWorks: true, chatgpt: 'sign-in' } as Voice)).toEqual(['local', 'chatgpt', 'openai', 'elevenlabs'])
    expect(voiceRows(stock)).toEqual(['openai', 'elevenlabs'])
    expect(voiceRows({ ...stock, localWorks: true })).toEqual(['local', 'openai', 'elevenlabs'])
  })
  it('shows every voice until it knows', () => {
    expect(voiceRows()).toEqual(['local', 'chatgpt', 'openai', 'elevenlabs'])
  })
  it('uses the language chosen for the agent, else the device’s', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    expect(agentLanguage({ language: 'es', local: false }).id).toBe('es')
    expect(agentLanguage({ language: undefined, local: false }).id).toBe('zh')
    expect(agentLanguage({ language: 'tlh', local: false }).id).toBe('zh')
    vi.stubGlobal('navigator', { language: 'tlh' })
    expect(agentLanguage({ language: undefined, local: false }).id).toBe('en')
    vi.unstubAllGlobals()
  })
  it('doesn’t take Hermes’s own English for a choice, until the agent talks locally', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    expect(agentLanguage({ language: 'en', local: false }).id).toBe('zh')
    expect(agentLanguage({ language: 'en', local: true }).id).toBe('en')
    vi.unstubAllGlobals()
  })
  it('says how a download is going, in the local row’s second line', () => {
    const local = (size: number, download: Partial<LocalDownload> | null) =>
      ({ size, download: download && { received: 0, total: 0, eta: null, error: null, ...download } }) as LocalVoice
    expect(downloadLine(local(500e6, { state: 'downloading', received: 62e6, total: 100e6 }))).toBe('Downloading… 62%')
    expect(downloadLine(local(500e6, { state: 'downloading' }))).toBe('Downloading… 0%')
    // It unpacks each package as it lands: the count holds until everything's in.
    expect(downloadLine(local(500e6, { state: 'unpacking', received: 62e6, total: 100e6 }))).toBe('Downloading… 62%')
    expect(downloadLine(local(500e6, { state: 'installing', received: 100e6, total: 100e6 }))).toBe('Finishing up…')
    expect(downloadLine(local(500e6, { state: 'failed', error: { kind: 'space', detail: '' } }))).toBe('Needs 500 MB free, tap to retry')
    expect(downloadLine(local(500e6, { state: 'failed', error: { kind: 'network', detail: '' } }))).toBe('Download stopped, tap to retry')
    // Nothing left to fetch, nothing on its way, or no plugin: the row reads as usual.
    expect(downloadLine(local(0, { state: 'done' }))).toBeUndefined()
    expect(downloadLine(local(500e6, null))).toBeUndefined()
    expect(downloadLine(null)).toBeUndefined()
  })
})

describe('where a local voice lives', () => {
  const plugin = {} as Voice['plugin']
  it('is an Umbrel only where the image’s plugin says so', () => {
    expect(localPlace(plugin)).toBe('your Umbrel')
    expect(localPlace(null)).toBe('this Hermes')
    // Still asking: most people's, so nothing flickers for them.
    expect(localPlace(undefined)).toBe('your Umbrel')
  })
  it('reads the same in Settings', () => {
    expect(voiceName({ unset: false, choice: 'local', plugin } as Voice)).toBe('On your Umbrel')
    expect(voiceName({ unset: false, choice: 'local', plugin: null } as Voice)).toBe('On this Hermes')
  })
})
