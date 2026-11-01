// What Talk relies on: Hermes's voice settings (the stt and tts toolsets),
// speech on the Umbrel itself out of the box (the image ships Whisper and
// Piper, which the murmur-voice plugin's providers stand on until its own
// models are downloaded: local-voice.contract.ts), how speech fails when a voice needs a key it doesn't have, the
// warm-up leases, the live voice on an OpenAI key (Hermes's GPT-Live route)
// and on a ChatGPT plan (the image's murmur-voice plugin), and spoken turns
// (voice_turn on the live-voice surface) being saved as plain chat messages.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { signOutChatGPT } from '@/state/models'
import { LANGUAGES, checkVoiceKey, chooseVoice, readVoice, removeVoiceKey, sampleVoice, voiceSetupError } from '@/features/talk/voice-setup'
import { liveStatus } from '@/features/talk/live'
import { agentName, api, connect, newChat, q, type Socket } from './client'

let socket: Socket
const agent = agentName('voice')
const p = q(agent)

beforeAll(async () => {
  startGateway()
  socket = await connect()
  await socket.request('profiles.create', { name: agent, share_auth: true }, 120_000)
})
afterAll(async () => {
  await api.call('DELETE', `/api/profiles/${agent}`)
  socket?.close()
  stopGateway()
})

/** Half a second of silence, as the browser would record it. */
const silence = () => {
  const n = 8000
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(16000, 24)
  buf.writeUInt32LE(32000, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  return `data:audio/wav;base64,${buf.toString('base64')}`
}

/** Runs in the Hermes container. */
const inHermes = (script: string) => promisify(execFile)('docker', ['exec', inject('hermes').container, 'sh', '-c', script]).then((r) => r.stdout)

describe('taking a voice’s key away', () => {
  const keyed = agentName('voice-keys')
  const env = () => inHermes(`cat /opt/data/profiles/${keyed}/.env`)
  beforeAll(() => socket.request('profiles.create', { name: keyed, share_auth: true }, 120_000))
  afterAll(() => api.call('DELETE', `/api/profiles/${keyed}`))

  it('removes it from the agent’s .env and says the voice needs one again', async () => {
    await chooseVoice(keyed, 'elevenlabs', { key: 'sk_contract_fake_elevenlabs' })
    await chooseVoice(keyed, 'openai', { key: 'sk-contract-fake-openai' })
    expect((await readVoice(keyed)).saved).toEqual({ openai: true, elevenlabs: true })
    expect(await env()).toContain('sk-contract-fake-openai')

    await removeVoiceKey(keyed, 'openai')
    await removeVoiceKey(keyed, 'elevenlabs')
    const voice = await readVoice(keyed)
    expect(voice.saved).toEqual({ openai: false, elevenlabs: false })
    expect(voice.keys).toEqual({ openai: false, elevenlabs: false })
    const after = await env()
    expect(after).not.toContain('sk-contract-fake-openai')
    expect(after).not.toMatch(/^VOICE_TOOLS_OPENAI_KEY=/m)
    expect(after).not.toContain('sk_contract_fake_elevenlabs')
    expect(after).not.toMatch(/^ELEVENLABS_API_KEY=/m)
  })

  it('leaves the key an agent’s models use alone', async () => {
    await api.put(`/api/env?${q(keyed)}`, { key: 'OPENAI_API_KEY', value: 'sk-contract-fake-models' })
    await chooseVoice(keyed, 'openai', { key: 'sk-contract-fake-voice' })
    await removeVoiceKey(keyed, 'openai')
    const voice = await readVoice(keyed)
    expect(voice.saved.openai).toBe(false)
    expect(voice.keys.openai).toBe(true)
    const after = await env()
    expect(after).toContain('sk-contract-fake-models')
    expect(after).not.toContain('sk-contract-fake-voice')
  })
})

describe('replacing a voice’s key', () => {
  const swapped = agentName('voice-swap')
  const env = () => inHermes(`cat /opt/data/profiles/${swapped}/.env`)
  // OpenAI's speech route on the machine itself, for fake keys: it knows one, as OpenAI would.
  const PORT = 9317
  const standIn = `
import http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('content-length', 0)))
        good = self.headers.get('authorization') == 'Bearer sk-contract-fake-working'
        self.send_response(200 if good else 401)
        self.send_header('content-type', 'audio/mpeg' if good else 'application/json')
        self.end_headers()
        self.wfile.write(b'ID3' if good else b'{"error":{"code":"invalid_api_key"}}')
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', ${PORT}), H).serve_forever()
`
  beforeAll(async () => {
    await socket.request('profiles.create', { name: swapped, share_auth: true }, 120_000)
    await inHermes(`nohup /opt/hermes/.venv/bin/python -c "$(cat <<'E'\n${standIn}\nE\n)" >/dev/null 2>&1 &`)
    await api.put(`/api/config?${q(swapped)}`, { config: { tts: { openai: { base_url: `http://127.0.0.1:${PORT}/v1` } } } })
    await chooseVoice(swapped, 'openai', { key: 'sk-contract-fake-working' })
  })
  afterAll(() => api.call('DELETE', `/api/profiles/${swapped}`))

  it('turns down a key the service refuses, and nothing changes', async () => {
    expect(await sampleVoice(swapped, 'Before.')).toMatch(/^data:/)
    const refused = await checkVoiceKey('openai', 'sk-contract-fake-refused').catch((e) => e)
    expect(voiceSetupError(refused, true, 'OpenAI')).toBe('That key didn’t work')
    const after = await env()
    expect(after).toContain('sk-contract-fake-working')
    expect(after).not.toContain('sk-contract-fake-refused')
    expect((await readVoice(swapped)).choice).toBe('openai')
    expect(await sampleVoice(swapped, 'After.')).toMatch(/^data:/)
  })

  it('turns down an ElevenLabs key the same way', async () => {
    const refused = await checkVoiceKey('elevenlabs', 'sk_contract_fake_refused').catch((e) => e)
    expect(voiceSetupError(refused, true, 'ElevenLabs')).toBe('That key didn’t work')
  })
})

describe('signing out of ChatGPT', () => {
  // A sign-in that could only belong to this test: an unsigned token, long-lived so nothing tries to refresh it.
  const signIn = async () => {
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const token = `${part({ alg: 'none' })}.${part({ exp: 4102444800, 'https://api.openai.com/auth': { chatgpt_account_id: 'contract' } })}.fake`
    const store = {
      version: 1,
      providers: { 'openai-codex': { tokens: { access_token: token, refresh_token: 'fake' }, auth_mode: 'chatgpt', last_refresh: new Date().toISOString() } },
      active_provider: null,
    }
    await inHermes(`cat > /opt/data/auth.json <<'E'\n${JSON.stringify(store)}\nE`)
  }

  it('ends the sign-in agents share, from any agent', async () => {
    await signIn()
    expect(await liveStatus(agent)).toBe('ready')
    expect(await liveStatus('default')).toBe('ready')

    await signOutChatGPT(agent)
    expect(await liveStatus(agent)).toBe('sign-in')
    expect(await liveStatus('default')).toBe('sign-in')
    expect(await inHermes('cat /opt/data/auth.json')).not.toContain('openai-codex')
  })

  it('has nothing to do when nobody is signed in', async () => {
    await expect(signOutChatGPT(agent)).resolves.toBeUndefined()
  })
})

describe('ElevenLabs on this image', () => {
  it('reaches ElevenLabs, rather than stopping for a package the image doesn’t have', async () => {
    await api.put(`/api/env?${p}`, { key: 'ELEVENLABS_API_KEY', value: `sk_${'0'.repeat(48)}` })
    await api.put(`/api/tools/toolsets/tts/provider?${p}`, { provider: 'ElevenLabs' })
    const res = await api.call('POST', `/api/audio/speak?${p}`, { text: 'Hello.' })
    await api.call('DELETE', `/api/env?${p}`, { key: 'ELEVENLABS_API_KEY' })
    await api.put(`/api/tools/toolsets/tts/provider?${p}`, { provider: 'Microsoft Edge TTS' })
    expect(JSON.stringify(res)).not.toMatch(/not installed/)
  }, 60_000)
})

describe('voice settings', () => {
  it('lists both sides with a status per choice, and a fresh agent isn’t ready to talk', async () => {
    for (const side of ['stt', 'tts']) {
      const config = await api.get(`/api/tools/toolsets/${side}/config?${p}`)
      expect(config.providers[0]).toMatchObject({ name: expect.any(String), is_active: expect.any(Boolean), status: expect.any(String) })
    }
    const names = (await api.get(`/api/tools/toolsets/tts/config?${p}`)).providers.map((x: { name: string }) => x.name)
    expect(names).toEqual(expect.arrayContaining(['Piper', 'OpenAI TTS', 'ElevenLabs']))
    // The stock voice is Edge, which doesn't speak on this image: Talk asks first.
    expect(await readVoice(agent)).toMatchObject({
      ready: false,
      stt: 'Local Whisper',
      tts: 'Microsoft Edge TTS',
      keys: { openai: false, elevenlabs: false },
      chatgpt: 'sign-in',
    })
  })

  it('switches an agent to its own Umbrel, in a language', async () => {
    const spanish = LANGUAGES.find((l) => l.id === 'es')!
    // (Spanish has no pair of models to download: Whisper and Piper talk. local-voice.contract.ts has the rest.)
    await chooseVoice(agent, 'local', { language: spanish })
    expect(await readVoice(agent)).toMatchObject({ choice: 'local', local: true, stt: 'Murmur', tts: 'Murmur', language: 'es' })
    // (Hermes drops values equal to its defaults when it saves, so read the effective config.)
    const config = await api.get(`/api/config?${p}`)
    expect(config.tts.piper.voice).toBe(spanish.piper)
    expect(config.stt.local.model).toBe('base')
    expect(config.stt.language).toBe('es')
  })

  it('speaks and hears on the Umbrel itself, with nothing to install', async () => {
    await chooseVoice(agent, 'local', { language: LANGUAGES.find((l) => l.id === 'es') })
    // The first time, the Whisper model and the Piper voice download (about 210 MB).
    for (const side of ['stt', 'tts']) {
      const warm = await api.post(`/api/audio/${side}-lease?${p}`, { lease: 'murmur-talk-contract-warm', active: true })
      expect(warm).toMatchObject({ ok: true })
    }
    const said = await api.post<{ data_url?: string }>(`/api/audio/speak?${p}`, { text: 'Buenos días. ¿Qué hay en el calendario de hoy?' })
    expect(said.data_url).toMatch(/^data:audio\//)
    const mime = said.data_url!.slice(5, said.data_url!.indexOf(';'))
    const heard = await api.post<{ transcript?: string }>(`/api/audio/transcribe?${p}`, { data_url: said.data_url, mime_type: mime })
    expect(heard.transcript).toMatch(/buen[oa]s d[ií]as/i)
    // A cough, or the TV: nothing to send, and no error.
    const quiet = await api.post<{ transcript?: string }>(`/api/audio/transcribe?${p}`, { data_url: silence(), mime_type: 'audio/wav' })
    expect(quiet.transcript ?? '').toBe('')
    for (const side of ['stt', 'tts']) await api.post(`/api/audio/${side}-lease?${p}`, { lease: 'murmur-talk-contract-warm', active: false })
  }, 300_000)

  it('says why when a voice needs a key it doesn’t have', async () => {
    await chooseVoice(agent, 'openai')
    // Hermes takes OpenAI's newest transcription model by name.
    expect((await api.get(`/api/config?${p}`)).stt.openai.model).toBe('gpt-transcribe')
    const heard = await api.call<{ detail?: string }>('POST', `/api/audio/transcribe?${p}`, { data_url: silence(), mime_type: 'audio/wav' })
    expect(heard.status).toBe(400)
    expect(heard.body.detail).toMatch(/api_key|configured to use/i)
    const said = await api.call<{ detail?: string }>('POST', `/api/audio/speak?${p}`, { text: 'Hello.' })
    expect(said.status).toBe(400)
    expect(said.body.detail).toMatch(/api_key|configured to use/i)
  })

  it('calls on OpenAI’s live voice with the agent’s key, and says when there’s no key', async () => {
    await chooseVoice(agent, 'openai')
    expect(await readVoice(agent)).toMatchObject({ choice: 'openai', ready: false, local: false })
    expect(await api.get(`/api/audio/voice-live/status?${p}`)).toMatchObject({ available: false, model: 'gpt-live-1' })
    // Hermes adds the agent's own GPT-Live instructions to its persona.
    await api.put(`/api/config?${p}`, { config: { voice: { gpt_live: { instructions: 'Your name is Contract.' } } } })
    expect((await api.get(`/api/config?${p}`)).voice.gpt_live.instructions).toBe('Your name is Contract.')
    const offer = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'
    const call = await api.call('POST', `/api/audio/voice-live/session?${p}`, { sdp: offer, history: [] })
    expect(call.status).toBe(503)
  })

  it('offers the ChatGPT plan, and says when the agent isn’t signed in with ChatGPT', async () => {
    expect(await liveStatus(agent)).toBe('sign-in')
    const offer = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'
    expect((await api.call('POST', `/api/plugins/murmur-voice/chatgpt/call?${p}`, { sdp: offer })).status).toBe(409)
    expect((await api.call('POST', `/api/plugins/murmur-voice/chatgpt/call?${p}`, { sdp: 'not an offer' })).status).toBe(400)
    // Chosen, it's this agent's voice for calls; Hermes's own voice settings stay as they were.
    await chooseVoice(agent, 'chatgpt')
    expect(await readVoice(agent)).toMatchObject({ choice: 'chatgpt', ready: false, local: false, stt: 'OpenAI' })
  })

  it('takes warm-up leases for a call, even when there’s nothing to warm', async () => {
    for (const side of ['stt', 'tts']) {
      for (const active of [true, false]) {
        const res = await api.post(`/api/audio/${side}-lease?${p}`, { lease: 'murmur-talk-contract', active })
        expect(res).toMatchObject({ ok: true, lease: 'murmur-talk-contract', active })
      }
    }
  })
})

describe('spoken turns', () => {
  it('answers a voice turn and saves what you said as an ordinary message', async () => {
    const { runtime, stored } = await newChat(socket)
    const text = 'What’s on this weekend?'
    await socket.request('prompt.submit', {
      session_id: runtime,
      text,
      profile: 'default',
      voice_turn: true,
      surface: 'voice-live',
      voice_context: 'User: hi\nAssistant: Hi! What can I do for you?',
      interrupted: true,
    })
    await socket.event('message.complete', runtime)
    const res = await api.get<{ messages: { role: string; content: string }[] }>(`/api/sessions/${stored}/messages?profile=default&order=latest&limit=50`)
    const users = res.messages.filter((m) => m.role === 'user').map((m) => m.content)
    expect(users).toEqual([text])
    expect(res.messages.some((m) => m.role === 'assistant')).toBe(true)
  })
})
