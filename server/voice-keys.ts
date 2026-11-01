// A voice's new API key, tried on the service itself before it takes the place
// of one that works. Hermes can only use a key it has saved, and a key saved
// over another is gone for good: Murmur can't read the old one back. So this
// does here what setting up a voice does through Hermes: says a word, and for
// ElevenLabs, which hears on a call too, listens to it.
//
//   POST /murmur/voice/check-key {service, key} → {ok: true} | {ok: false, detail}
//
// The key goes to that service's own address and nowhere else, and isn't kept
// or logged. `detail` is the status and the service's error code, for
// voiceSetupError: never its words, which can repeat the key.

import type http from 'node:http'
import { readJson, sendJson } from './http.ts'

const OPENAI = 'https://api.openai.com/v1'
const ELEVENLABS = 'https://api.elevenlabs.io/v1'
/** What Hermes uses when an agent has chosen nothing else (tools/tts_tool_*.py, transcription_common.py). */
const OPENAI_MODEL = 'gpt-4o-mini-tts'
const OPENAI_VOICE = 'alloy'
const ELEVENLABS_VOICE = 'pNInz6obpgDQGcFmaJgB'
const ELEVENLABS_MODEL = 'eleven_multilingual_v2'
const ELEVENLABS_HEARING = 'scribe_v2'

const WORD = 'Hello.'
const PATIENCE = 20_000

/** No spaces or control characters: anything else can't be a key, and can't go in a header. */
const KEY = /^[\x21-\x7e]{8,512}$/
const CODE = /^[\w.-]{1,64}$/

export type Checked = { ok: true } | { ok: false; detail: string }
type Fetch = typeof fetch

async function refused(res: Response, step: string): Promise<Checked> {
  const body = (await res.json().catch(() => null)) as { detail?: unknown; error?: unknown } | null
  const error = (typeof body?.detail === 'object' ? body.detail : body?.error) as { status?: unknown; code?: unknown; type?: unknown } | null | undefined
  const code = [error?.status, error?.code, error?.type].find((c) => typeof c === 'string' && CODE.test(c))
  return { ok: false, detail: ['HTTP', res.status, code, step].filter(Boolean).join(' ') }
}

async function openai(key: string, send: Fetch): Promise<Checked> {
  const res = await send(`${OPENAI}/audio/speech`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, voice: OPENAI_VOICE, input: WORD }),
    signal: AbortSignal.timeout(PATIENCE),
  })
  return res.ok ? { ok: true } : refused(res, 'text_to_speech')
}

async function elevenlabs(key: string, send: Fetch): Promise<Checked> {
  const spoke = await send(`${ELEVENLABS}/text-to-speech/${ELEVENLABS_VOICE}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text: WORD, model_id: ELEVENLABS_MODEL }),
    signal: AbortSignal.timeout(PATIENCE),
  })
  if (!spoke.ok) return refused(spoke, 'text_to_speech')
  const form = new FormData()
  form.set('model_id', ELEVENLABS_HEARING)
  form.set('file', new Blob([await spoke.arrayBuffer()], { type: 'audio/mpeg' }), 'hello.mp3')
  const heard = await send(`${ELEVENLABS}/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
    signal: AbortSignal.timeout(PATIENCE),
  })
  return heard.ok ? { ok: true } : refused(heard, 'speech_to_text')
}

const SERVICES = { openai, elevenlabs }

export async function checkKey(service: keyof typeof SERVICES, key: string, send: Fetch = fetch): Promise<Checked> {
  if (!KEY.test(key)) return { ok: false, detail: 'invalid_api_key' }
  try {
    return await SERVICES[service](key, send)
  } catch {
    return { ok: false, detail: 'connect failed' }
  }
}

export async function handleVoiceKey(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (url.pathname !== '/murmur/voice/check-key' || req.method !== 'POST') return false
  const body = (await readJson(req, 4096).catch(() => null)) as { service?: unknown; key?: unknown } | null
  if ((body?.service !== 'openai' && body?.service !== 'elevenlabs') || typeof body.key !== 'string') {
    sendJson(res, 400, { error: 'bad_request' })
    return true
  }
  sendJson(res, 200, await checkKey(body.service, body.key))
  return true
}
