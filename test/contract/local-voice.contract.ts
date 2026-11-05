// Local voices: the Hermes image's murmur-voice plugin gives each language one pair of models,
// downloaded on demand. Its `murmur` speech providers use a pair once it's downloaded, and Hermes's
// own Piper and Whisper until then and in every other language, so an agent can talk the moment
// it's switched over.
//
// Nothing big is downloaded here: the providers are checked on their stand-ins. To watch real
// downloads and real models speak and hear in English and Chinese (about 690 MB), set
// MURMUR_VOICE_DOWNLOAD=1.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { LANGUAGES, chooseVoice, pickVoice, readVoice } from '@/features/talk/voice-setup'
import { installLocal, readLocal, type LocalVoice } from '@/features/talk/local-voice'
import { MURMUR, agentName, api, connect, modelRequests, newChat, q, removeAgent, turn, type Socket } from './client'

const hermes = inject('hermes')
let socket: Socket
const agent = agentName('local-voice')
const p = q(agent)
const language = (id: string) => LANGUAGES.find((l) => l.id === id)!

beforeAll(async () => {
  startGateway()
  socket = await connect()
  await socket.request('profiles.create', { name: agent, share_auth: true }, 120_000)
  if (!(await readLocal(agent)))
    throw new Error(
      `The Hermes image under test (${hermes.image}) has no local voices (the murmur-voice plugin's /local route). ` +
        'Pin a getumbrel/hermes-agent-umbrel release that has them in umbrel/murmur/docker-compose.yml, or test a local build: ' +
        'HERMES_IMAGE=murmur-local/hermes-agent-umbrel:v0.22.5-2 npm run test:contract',
    )
}, 180_000)
afterAll(async () => {
  await removeAgent(agent)
  socket?.close()
  stopGateway()
})

const until = async (what: string, ms: number, check: () => Promise<boolean>) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

describe('one pair per language', () => {
  it('names the pair and what it costs to download', async () => {
    const english = (await readLocal(agent, 'en'))!
    expect(english.language).toBe('en')
    expect(english.pair).toMatchObject({ speak: { id: 'pocket-tts-18m', name: expect.any(String), builtin: false }, listen: { id: 'x-asr', builtin: false } })
    expect(english.size).toBeGreaterThan(100_000_000)
    const chinese = (await readLocal(agent, 'zh'))!
    expect(chinese.pair).toMatchObject({ speak: { id: 'matcha-zh-en' }, listen: { id: 'x-asr' } })
  })

  it('leaves every other language on Piper and Whisper, with nothing to download', async () => {
    const spanish = (await readLocal(agent, 'es'))!
    expect(spanish.pair).toMatchObject({ speak: { id: 'piper', builtin: true }, listen: { id: 'whisper', builtin: true } })
    expect(spanish.size).toBe(0)
  })

  it('has a fresh agent talking through neither yet, with the stand-ins ready for it', async () => {
    expect(await readLocal(agent, 'en')).toMatchObject({ on: { speak: false, listen: false }, active: { speak: 'piper', listen: 'whisper' } })
  })
})

describe('talking on its own machine with nobody choosing', () => {
  it('starts with nothing chosen, and picks its own machine when the agent has no ChatGPT plan or OpenAI key', async () => {
    const voice = await readVoice(agent)
    expect(voice).toMatchObject({ unset: true, auto: false, ready: false, localWorks: true })
    expect(voice.plugin).not.toBeNull()
    expect(pickVoice(voice, 'openai-codex')).toEqual(['local'])
  })

  it('talks at once through the plugin, on Piper and Whisper', async () => {
    // Spanish has no pair, so nothing downloads.
    await chooseVoice(agent, 'local', { auto: true, language: language('es') })
    expect(await readVoice(agent)).toMatchObject({ choice: 'local', ready: true, local: true, auto: true, unset: false })
    const config = await api.get(`/api/config?${p}`)
    expect(config.tts.provider).toBe('murmur')
    expect(config.stt).toMatchObject({ provider: 'murmur', language: 'es' })
    expect(await readLocal(agent)).toMatchObject({ language: 'es', on: { speak: true, listen: true }, active: { speak: 'piper', listen: 'whisper' } })
    // The TTS lease warms the stand-ins for the call (the first time, the Whisper model and Piper voice download).
    expect(await api.post(`/api/audio/tts-lease?${p}`, { lease: 'murmur-local-contract', active: true })).toMatchObject({ ok: true, provider: 'murmur' })
    const said = await api.post<{ data_url?: string; provider?: string }>(`/api/audio/speak?${p}`, { text: 'Buenos días. ¿Qué hay en el calendario de hoy?' })
    expect(said).toMatchObject({ provider: 'murmur', data_url: expect.stringMatching(/^data:audio\//) })
    const mime = said.data_url!.slice(5, said.data_url!.indexOf(';'))
    const heard = await api.post<{ transcript?: string }>(`/api/audio/transcribe?${p}`, { data_url: said.data_url, mime_type: mime })
    expect(heard.transcript).toMatch(/buen[oa]s d[ií]as/i)
    await api.post(`/api/audio/tts-lease?${p}`, { lease: 'murmur-local-contract', active: false })
  }, 300_000)

  it('has nothing to fetch for a language without a pair', async () => {
    const after = await installLocal(agent, 'es')
    expect(after.size).toBe(0)
    await until('the empty download to settle', 20_000, async () => (await readLocal(agent))!.download?.state !== 'downloading')
    expect((await readLocal(agent))!.download?.state ?? 'done').toBe('done')
  })
})

describe('speech for an iPhone, which can’t use Web Audio', () => {
  it('comes as MP4 fragments an audio element can be fed, from the stand-in too', async () => {
    // Spanish has no pair, so this is Piper, which makes a whole clip first.
    await chooseVoice(agent, 'local', { language: language('es') })
    const res = await fetch(`${MURMUR}/hermes/api/plugins/murmur-voice/say?${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Buenos días.' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/mp4')
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(bytes.subarray(4, 8).toString()).toBe('ftyp')
    expect(bytes.includes('moof')).toBe(true)
  }, 120_000)

  it('asks for something to say', async () => {
    expect((await api.call('POST', `/api/plugins/murmur-voice/say?${p}`, { text: '  ' })).status).toBe(400)
  })
})

const openEar = async () => {
  const ws = new WebSocket(`${MURMUR.replace('http', 'ws')}/hermes/api/plugins/murmur-voice/hear?${p}`)
  ws.binaryType = 'arraybuffer'
  const heard: (string | ArrayBuffer)[] = []
  ws.onmessage = (m) => void heard.push(m.data as string | ArrayBuffer)
  await new Promise((done, fail) => ((ws.onopen = done), (ws.onerror = fail)))
  const send = async (audio: Buffer) => {
    for (let at = 0; at < audio.length; at += 16_000) {
      ws.send(new Uint8Array(audio.subarray(at, at + 16_000)))
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  const turn = async () => {
    await until('the turn', 20_000, async () => heard.some((h) => typeof h !== 'string'))
    const wav = Buffer.from(heard.find((h) => typeof h !== 'string') as ArrayBuffer)
    const data_url = `data:audio/wav;base64,${wav.toString('base64')}`
    return (await api.post<{ transcript: string }>(`/api/audio/transcribe?${p}`, { data_url, mime_type: 'audio/wav' })).transcript
  }
  return { ws, heard, send, turn }
}
const speech = async (text: string) => {
  const { data_url } = await api.post<{ data_url: string }>(`/api/audio/speak?${p}`, { text })
  return Buffer.from(data_url.split(',')[1], 'base64')
}

describe('hearing a call from an iPhone', () => {
  it('hears speech in a recording as it arrives, and a tap hands over the turn for Hermes to transcribe', async () => {
    await chooseVoice(agent, 'local', { language: language('es') })
    const { ws, heard, send, turn } = await openEar()
    ws.send(JSON.stringify({ mode: 'listen' }))
    await send(await speech('Encontré tres fotos de la playa.'))
    await until('the speech', 20_000, async () => heard.includes('{"type": "speech"}'))
    ws.send(JSON.stringify({ finish: true }))
    expect((await turn()).toLowerCase()).toMatch(/playa/)
    ws.close()
  }, 120_000)
})

describe('what a live voice answers by itself', () => {
  const texts = (rows: { role: string; content?: unknown }[]) => rows.filter((r) => r.role === 'user' || r.role === 'assistant').map((r) => [r.role, r.content])

  it('goes into the chat as ordinary messages, and the agent sees it', async () => {
    const { runtime, stored } = await newChat(socket, agent)
    const said = await api.post<{ rows: number[] }>(`/api/plugins/murmur-voice/spoken?${p}`, { chat: stored, you: 'Hey there, how are you?', voice: 'Doing well, thanks for asking.' })
    expect(said.rows).toEqual([expect.any(Number), expect.any(Number)])
    await turn(socket, runtime, 'Ping', agent)
    // (Not the request that names the chat, which only sees your opening words.)
    const asked = (await modelRequests()).filter((r) => JSON.stringify(r.body).includes('Ping') && (r.body as { tools?: unknown[] }).tools?.length).at(-1)
    const sent = JSON.stringify(asked?.body)
    expect(sent).toContain('Hey there, how are you?')
    expect(sent).toContain('Doing well, thanks for asking.')
    // Stored once, in order, however many turns follow.
    const rows = (await api.get<{ messages: { role: string; content?: unknown }[] }>(`/api/sessions/${stored}/messages?${p}`)).messages
    expect(texts(rows).slice(0, 3)).toEqual([
      ['user', 'Hey there, how are you?'],
      ['assistant', 'Doing well, thanks for asking.'],
      ['user', 'Ping'],
    ])
    expect(texts(rows).filter(([, c]) => c === 'Hey there, how are you?')).toHaveLength(1)
  }, 120_000)

  it('leaves a chat that only has small talk in the agent’s list', async () => {
    const { stored } = await newChat(socket, agent)
    await api.post(`/api/plugins/murmur-voice/spoken?${p}`, { chat: stored, you: 'Just saying hi.', voice: 'Hi yourself!' })
    const { sessions } = await api.get<{ sessions: { id: string; preview?: string }[] }>(`/api/sessions?limit=20&${p}`)
    expect(sessions.find((s) => s.id === stored)?.preview).toContain('Just saying hi.')
  })

  it('makes the chat’s row itself, once the chat’s agent is up', async () => {
    const { stored } = await newChat(socket, agent)
    await new Promise((r) => setTimeout(r, 8000))
    await api.post(`/api/plugins/murmur-voice/spoken?${p}`, { chat: stored, you: 'Good morning.', voice: 'Morning!' })
    const rows = (await api.get<{ messages: { role: string; content?: unknown }[] }>(`/api/sessions/${stored}/messages?${p}`)).messages
    expect(texts(rows)).toEqual([
      ['user', 'Good morning.'],
      ['assistant', 'Morning!'],
    ])
  }, 30_000)

  it('says so when the chat isn’t open', async () => {
    const res = await api.call('POST', `/api/plugins/murmur-voice/spoken?${p}`, { chat: 'not-a-chat', you: 'Hey.', voice: 'Hi.' })
    expect(res.status).toBe(404)
  })

  it('names a chat started out loud from your words, not Hermes’s note for the model', async () => {
    const { runtime, stored } = await newChat(socket, agent)
    const before = socket.events.length
    await socket.request('prompt.submit', { session_id: runtime, text: 'Plan my week', profile: agent, voice_turn: true, surface: 'voice-live', title_preview: 'Plan my week' })
    await socket.until('the voice turn to finish', () => socket.events.slice(before).find((e) => e.type === 'message.complete' && e.session_id === runtime), 120_000)
    await until('a title', 20_000, async () => !!(await api.get<{ sessions: { id: string; title?: string | null }[] }>(`/api/sessions?limit=20&${p}`)).sessions.find((s) => s.id === stored)?.title)
    const { sessions } = await api.get<{ sessions: { id: string; title?: string | null }[] }>(`/api/sessions?limit=20&${p}`)
    expect(sessions.find((s) => s.id === stored)?.title ?? '').not.toContain('[Note')
  }, 180_000)
})

describe.runIf(process.env.MURMUR_VOICE_DOWNLOAD === '1')('real downloads', () => {
  /** Speech as a WAV, then two seconds of silence in the same recording. */
  const spoken = async (text: string) => {
    const wav = await speech(text)
    const rate = wav.readUInt32LE(24)
    const at = wav.indexOf('data') + 8
    const whole = Buffer.concat([wav, Buffer.alloc(rate * 2 * 2)])
    whole.writeUInt32LE(whole.length - 8, 4)
    whole.writeUInt32LE(whole.length - at, at - 4)
    return whole
  }

  const ready = async (lang: string, speak: string) => {
    let seen = 0
    let local: LocalVoice | null = null
    await until(`the ${lang} pair`, 900_000, async () => {
      local = await readLocal(agent, lang)
      const d = local!.download
      if (d?.state === 'failed') throw new Error(`download failed: ${JSON.stringify(d.error)}`)
      if (d && d.received < seen) throw new Error('progress went backwards')
      seen = d?.received ?? seen
      return local!.active.speak === speak && local!.active.listen === 'x-asr'
    })
    expect(local!.size).toBe(0)
  }

  it('fetches the English pair with progress, then speaks and hears with it', async () => {
    await chooseVoice(agent, 'local', { language: language('en') })
    await ready('en', 'pocket-tts-18m')
    const said = await api.post<{ data_url?: string }>(`/api/audio/speak?${p}`, { text: 'I found three photos from the beach in Big Sur.' })
    expect(said.data_url).toMatch(/^data:audio\/wav/)
    const heard = await api.post<{ transcript?: string }>(`/api/audio/transcribe?${p}`, { data_url: said.data_url, mime_type: 'audio/wav' })
    expect(heard.transcript).toMatch(/three photos from the beach in big sur/i)
  }, 1_000_000)

  it('leaves the voice free for the next sentence when a listener goes', async () => {
    const say = (text: string, signal?: AbortSignal) =>
      fetch(`${MURMUR}/hermes/api/plugins/murmur-voice/say?${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal,
      })
    const long = 'This sentence is a long one, and it goes on for quite a while, so that it can be talked over part of the way through it.'
    const talkedOver = new AbortController()
    const queued = new AbortController()
    const playing = await say(long, talkedOver.signal)
    await playing.body!.getReader().read()
    void say(long, queued.signal).catch(() => {})
    await new Promise((r) => setTimeout(r, 200))
    talkedOver.abort()
    queued.abort()
    const started = Date.now()
    const next = await say('The answer.')
    await next.arrayBuffer()
    expect(Date.now() - started).toBeLessThan(8000)
  }, 60_000)

  it('notices a call’s turn ending by itself, from the speech alone', async () => {
    const { ws, heard, send, turn } = await openEar()
    ws.send(JSON.stringify({ mode: 'listen' }))
    await send(await spoken('I found three photos from the beach in Big Sur.'))
    expect((await turn()).toLowerCase()).toMatch(/three photos/)
    expect(heard[0]).toBe('{"type": "speech"}')
    ws.close()
  }, 60_000)

  it('keeps what’s said over the agent, from the moment it was talked over', async () => {
    const { ws, heard, send, turn } = await openEar()
    ws.send(JSON.stringify({ mode: 'barge' }))
    const audio = await spoken('Actually, stop. Tell me about the weather in Paris.')
    await send(audio.subarray(0, 44))
    ws.send(JSON.stringify({ interrupted: true }))
    await send(audio.subarray(44))
    expect((await turn()).toLowerCase()).toMatch(/weather in paris/)
    expect(heard).not.toContain('{"type": "speech"}')
    ws.close()
  }, 60_000)

  it('speaks each sentence in the voice that fits it, whatever the agent’s language', async () => {
    // Set to English, with both voices here from the test above and the one below.
    await chooseVoice(agent, 'local', { language: language('zh') })
    await ready('zh', 'matcha-zh-en')
    await chooseVoice(agent, 'local', { language: language('en') })
    const said = await api.post<{ data_url?: string }>(`/api/audio/speak?${p}`, { text: '明天天气晴朗。' })
    const heard = await api.post<{ transcript?: string }>(`/api/audio/transcribe?${p}`, { data_url: said.data_url, mime_type: 'audio/wav' })
    expect(heard.transcript).toMatch(/明天/)
  }, 1_000_000)

  it('fetches the Chinese pair, then speaks and hears with it, English words included', async () => {
    await chooseVoice(agent, 'local', { language: language('zh') })
    await ready('zh', 'matcha-zh-en')
    const said = await api.post<{ data_url?: string }>(`/api/audio/speak?${p}`, { text: '明天下午三点提醒我用 iPhone 给王经理打电话。' })
    expect(said.data_url).toMatch(/^data:audio\/wav/)
    const heard = await api.post<{ transcript?: string }>(`/api/audio/transcribe?${p}`, { data_url: said.data_url, mime_type: 'audio/wav' })
    expect(heard.transcript).toMatch(/王经理/)
    expect(heard.transcript).toMatch(/iphone/i)
  }, 1_000_000)
})
