import { describe, expect, it, vi } from 'vitest'
import { checkKey } from './voice-keys.ts'

const KEY = 'sk-test-a-key-for-this-file'
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })
const answers = (...responses: Response[]) => vi.fn(async () => responses.shift() ?? reply(500)) as unknown as typeof fetch & { mock: { calls: [string, RequestInit][] } }

describe('trying a key on OpenAI', () => {
  it('passes a key that can speak', async () => {
    const send = answers(reply(200))
    expect(await checkKey('openai', KEY, send)).toEqual({ ok: true })
    const [url, init] = send.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/audio/speech')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
  })

  it('says why it refused, without repeating what the service said', async () => {
    const send = answers(reply(401, { error: { message: `Incorrect API key provided: ${KEY}`, code: 'invalid_api_key' } }))
    const checked = await checkKey('openai', KEY, send)
    expect(checked).toEqual({ ok: false, detail: 'HTTP 401 invalid_api_key text_to_speech' })
  })

  it('recognises an account out of credit', async () => {
    const send = answers(reply(429, { error: { code: 'insufficient_quota' } }))
    expect(await checkKey('openai', KEY, send)).toEqual({ ok: false, detail: 'HTTP 429 insufficient_quota text_to_speech' })
  })
})

describe('trying a key on ElevenLabs', () => {
  it('needs it to speak and to hear, as a call does', async () => {
    const send = answers(new Response('audio'), reply(200))
    expect(await checkKey('elevenlabs', KEY, send)).toEqual({ ok: true })
    expect(send.mock.calls.map(([url]) => url)).toEqual([
      'https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB',
      'https://api.elevenlabs.io/v1/speech-to-text',
    ])
    expect(send.mock.calls.every(([, init]) => (init.headers as Record<string, string>)['xi-api-key'] === KEY)).toBe(true)
  })

  it('stops at speaking if it can’t speak', async () => {
    const send = answers(reply(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } }))
    expect(await checkKey('elevenlabs', KEY, send)).toEqual({ ok: false, detail: 'HTTP 401 invalid_api_key text_to_speech' })
    expect(send.mock.calls).toHaveLength(1)
  })

  it('says which permission a key is missing', async () => {
    const send = answers(new Response('audio'), reply(401, { detail: { status: 'missing_permissions', message: 'no' } }))
    expect(await checkKey('elevenlabs', KEY, send)).toEqual({ ok: false, detail: 'HTTP 401 missing_permissions speech_to_text' })
  })

  it('copes with an error that’s only words', async () => {
    const send = answers(reply(404, { detail: 'Not Found' }))
    expect(await checkKey('elevenlabs', KEY, send)).toEqual({ ok: false, detail: 'HTTP 404 text_to_speech' })
  })
})

describe('anything else', () => {
  it('keeps out what can’t be a key without asking anyone', async () => {
    const send = answers()
    for (const key of ['short', 'has a space in it', `line\nbreak-in-it`]) expect(await checkKey('openai', key, send)).toEqual({ ok: false, detail: 'invalid_api_key' })
    expect(send.mock.calls).toHaveLength(0)
  })

  it('says it couldn’t reach the service', async () => {
    const send = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await checkKey('elevenlabs', KEY, send)).toEqual({ ok: false, detail: 'connect failed' })
  })
})
