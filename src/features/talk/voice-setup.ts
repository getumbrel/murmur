// How an agent hears and speaks, read from and written to Hermes's own voice
// settings (the dashboard's toolset config for "stt" and "tts", the same matrix
// `hermes tools` shows). A call on the agent's ChatGPT plan or OpenAI key uses
// OpenAI's live voice instead (live.ts); that choice is kept in the agent's
// config too, as voice.murmur.engine. On the Umbrel, a Hermes with the image's
// murmur-voice plugin hears and speaks through its `murmur` provider, which runs
// the language's pair of models (local-voice.ts). Murmur keeps no copy: every
// state here is Hermes's.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/hermes/rest'
import { liveStatus, type LiveStatus } from './live'
import { installLocal, readLocal, type LocalVoice } from './local-voice'
import type { Engine } from './talk'

export type VoiceChoice = 'local' | 'chatgpt' | 'openai' | 'elevenlabs'
type Pair = Exclude<VoiceChoice, 'chatgpt'>

/** What each voice is called, wherever one is named. (The company behind it keeps its own name.) */
export const VOICE_NAMES = { chatgpt: 'ChatGPT', openai: 'OpenAI API', elevenlabs: 'ElevenLabs API' }

type Provider = {
  name: string
  status?: 'ready' | 'needs_keys' | 'needs_auth' | string
  is_active?: boolean
  tts_provider?: string
  env_vars?: { key: string; is_set?: boolean }[]
}
type ToolsetConfig = { active_provider?: string; providers: Provider[] }
type EnvRow = { is_set?: boolean }

/** Hermes's names for each side of a choice (`PUT /api/tools/toolsets/{stt,tts}/provider`). */
const PAIRS: Record<Pair, { stt: string; tts: string; key?: string }> = {
  local: { stt: 'Local Whisper', tts: 'Piper' },
  openai: { stt: 'OpenAI', tts: 'OpenAI TTS', key: 'VOICE_TOOLS_OPENAI_KEY' },
  elevenlabs: { stt: 'ElevenLabs Scribe', tts: 'ElevenLabs', key: 'ELEVENLABS_API_KEY' },
}

/** OpenAI's transcription model for completed audio (July 2026); `gpt-live-transcribe` is its streaming twin. */
export const OPENAI_STT = 'gpt-transcribe'

const LOCAL_TTS = new Set(['Piper', 'KittenTTS', 'NeuTTS'])

export type Voice = {
  /** Set up with something that actually speaks (the stock Edge voice doesn't, on our image). */
  ready: boolean
  /** Which of Murmur's choices it is, if any. */
  choice?: VoiceChoice
  /** Speech stays on this machine. */
  local: boolean
  stt?: string
  tts?: string
  /** Keys Hermes already has. */
  keys: { openai: boolean; elevenlabs: boolean }
  /** Those saved for the voice itself, which can be taken back here: the key an agent's models use belongs to them. */
  saved: { openai: boolean; elevenlabs: boolean }
  /** Whether it can talk on its ChatGPT plan: signed in, not yet, or not on this Hermes. */
  chatgpt: LiveStatus
  language?: string
  /** Murmur picked it, not the person, so it follows the agent's setup (see pickVoice). */
  auto: boolean
  /** Never chosen by anyone: the first call picks one by itself. */
  unset: boolean
  /** This Hermes's local voices (the image's murmur-voice plugin), or null without it. */
  plugin: LocalVoice | null
  /** It can hear and speak on its own machine: through the plugin, or Hermes's own Whisper and Piper. */
  localWorks: boolean
}

type Config = {
  stt?: { language?: string; provider?: string }
  tts?: { provider?: string }
  voice?: { murmur?: { engine?: string; auto?: boolean } }
}

/** The plugin's provider name, for both sides. */
const MURMUR = 'murmur'

const q = (profile: string) => `profile=${encodeURIComponent(profile)}`

export const voiceKey = (profile: string) => ['voice', profile]

export function useVoice(profile?: string) {
  return useQuery({
    queryKey: voiceKey(profile ?? ''),
    enabled: !!profile,
    staleTime: 60_000,
    queryFn: () => readVoice(profile!),
  })
}

export async function readVoice(profile: string): Promise<Voice> {
  const [stt, tts, env, config, chatgpt, plugin] = await Promise.all([
    api.get<ToolsetConfig>(`/api/tools/toolsets/stt/config?${q(profile)}`),
    api.get<ToolsetConfig>(`/api/tools/toolsets/tts/config?${q(profile)}`),
    api.get<Record<string, EnvRow>>(`/api/env?${q(profile)}`).catch(() => ({}) as Record<string, EnvRow>),
    api.get<Config>(`/api/config?${q(profile)}`).catch(() => ({}) as Config),
    liveStatus(profile).catch((): LiveStatus => 'unsupported'),
    readLocal(profile).catch(() => null),
  ])
  const sttOn = stt.providers.find((p) => p.is_active) ?? stt.providers.find((p) => p.name === stt.active_provider)
  const ttsOn = tts.providers.find((p) => p.is_active) ?? tts.providers.find((p) => p.name === tts.active_provider)
  const has = (k: string) => !!env[k]?.is_set
  const saved = { openai: has('VOICE_TOOLS_OPENAI_KEY'), elevenlabs: has('ELEVENLABS_API_KEY') }
  const keys = { openai: saved.openai || has('OPENAI_API_KEY'), elevenlabs: saved.elevenlabs }
  const pair = (Object.keys(PAIRS) as Pair[]).find((c) => PAIRS[c].stt === sttOn?.name && PAIRS[c].tts === ttsOn?.name)
  const installed = (config: ToolsetConfig, name: string) => config.providers.find((p) => p.name === name)?.status === 'ready'
  const engine = config.voice?.murmur?.engine
  const live = engine === 'chatgpt'
  // OpenAI's live voice, on the agent's key (Hermes's own GPT-Live route).
  const openai = engine === 'openai'
  // The plugin's models (Whisper and Piper standing in until they're here): always able to talk.
  const murmur = !!plugin && config.stt?.provider === MURMUR && config.tts?.provider === MURMUR
  // OpenAI voices also work from the key used for models, which the matrix doesn't count.
  const okay = (p?: Provider) => p?.status === 'ready' || (p?.status === 'needs_keys' && /OpenAI/.test(p.name) && keys.openai)
  const ready = live
    ? chatgpt === 'ready'
    : openai
      ? keys.openai
      : murmur || (okay(sttOn) && okay(ttsOn) && ttsOn?.tts_provider !== 'edge')
  return {
    ready: !!ready,
    choice: live ? 'chatgpt' : openai ? 'openai' : murmur ? 'local' : pair,
    chatgpt,
    local: !live && !openai && (murmur || (sttOn?.name === 'Local Whisper' && LOCAL_TTS.has(ttsOn?.name ?? ''))),
    stt: murmur ? 'Murmur' : sttOn?.name,
    tts: murmur ? 'Murmur' : ttsOn?.name,
    keys,
    saved,
    language: config.stt?.language,
    auto: !!config.voice?.murmur?.auto,
    unset: !engine,
    plugin,
    localWorks: !!plugin || (installed(stt, PAIRS.local.stt) && installed(tts, PAIRS.local.tts)),
  }
}

/**
 * Where speech stays when it's local, in a sentence: "your Umbrel" only where it really is one, which
 * the image's plugin says. A Hermes without it (null) is "this Hermes"; still asking (undefined)
 * reads as most people's.
 */
export const localPlace = (plugin: LocalVoice | null | undefined) => (plugin === null ? 'this Hermes' : 'your Umbrel')

/** What the agent talks with, in a word or two: "On your Umbrel", "ChatGPT plan". */
export function voiceName(voice: Voice) {
  if (voice.unset) return 'Automatic'
  const names: Record<VoiceChoice, string> = { local: `On ${localPlace(voice.plugin)}`, ...VOICE_NAMES }
  return voice.choice ? names[voice.choice] : 'Hermes’s own'
}

/** A voice a call can pick by itself; `own` is whatever Hermes is set to, left as it is. */
export type AutoVoice = VoiceChoice | 'own'

/** Who listens and speaks on a call with this voice. */
/** The voices that can work on this Hermes. One without the image's plugin has no ChatGPT voice, and usually no local one. */
export const voiceRows = (voice?: Voice): VoiceChoice[] =>
  (['local', 'chatgpt', 'openai', 'elevenlabs'] as const).filter((id) =>
    id === 'local' ? voice?.localWorks !== false : id === 'chatgpt' ? voice?.chatgpt !== 'unsupported' : true,
  )

/** What a call's chip says, shortened to fit. `local`: it's running on the agent's own machine. */
export function voiceChip(engine: Engine, choice: VoiceChoice | undefined, local: boolean) {
  if (engine !== 'chained') return VOICE_NAMES[engine]
  if (local) return 'Local'
  return choice === 'elevenlabs' ? 'ElevenLabs' : 'Voice'
}

export const engineOf = (choice?: AutoVoice): Engine => (choice === 'chatgpt' || choice === 'openai' ? choice : 'chained')

/**
 * The voices worth trying, best first, when nobody has picked one: what this Hermes can already
 * talk with. A voice someone set up in Hermes itself stays as it is. Otherwise the agent's ChatGPT
 * plan or its OpenAI key (with both, the one its own model runs on), then its own machine, or an
 * ElevenLabs key when that can't talk. Nothing that isn't set up is offered, so a Hermes with no
 * way to talk gives an empty list.
 */
export function pickVoice(voice: Voice, agentProvider?: string): AutoVoice[] {
  if (voice.unset && voice.ready) return [voice.choice ?? 'own']
  const chatgpt = voice.chatgpt === 'ready'
  const openai = voice.keys.openai
  const order: VoiceChoice[] = agentProvider === 'openai' ? ['openai', 'chatgpt'] : ['chatgpt', 'openai']
  const live = order.filter((c) => (c === 'chatgpt' ? chatgpt : openai))
  return [...live, ...(voice.localWorks ? (['local'] as const) : voice.keys.elevenlabs ? (['elevenlabs'] as const) : [])]
}

/**
 * Switch an agent's voice. Saves a key first when one's given. `auto`: Murmur picked it, so
 * it follows the agent's setup until someone picks one themselves.
 */
export async function chooseVoice(profile: string, choice: VoiceChoice, opts: { key?: string; language?: Language; auto?: boolean } = {}) {
  // Which voice a call uses; Hermes's own voice settings stay as they are for everything else.
  const engine = choice === 'chatgpt' || choice === 'openai' ? choice : 'hermes'
  await api.put(`/api/config?${q(profile)}`, { config: { voice: { murmur: { engine, auto: !!opts.auto } } } })
  if (choice === 'chatgpt') return
  if (choice === 'local' && (await chooseLocal(profile, opts.language ?? LANGUAGES[0]))) return
  const pair = PAIRS[choice]
  if (opts.key && pair.key) await api.put(`/api/env?${q(profile)}`, { key: pair.key, value: opts.key.trim() })
  await api.put(`/api/tools/toolsets/stt/provider?${q(profile)}`, { provider: pair.stt })
  await api.put(`/api/tools/toolsets/tts/provider?${q(profile)}`, { provider: pair.tts })
  if (choice === 'local') await setLanguage(profile, opts.language ?? LANGUAGES[0])
  // Calls use the live voice; dictation and Read aloud still use these, with OpenAI's newest for hearing a finished turn.
  if (choice === 'openai') await api.put(`/api/config?${q(profile)}`, { config: { stt: { openai: { model: OPENAI_STT } } } })
}

/**
 * Tries a key on its service, saving nothing, for replacing one that works: a key saved over
 * another can't be taken back. Murmur's server does the asking (server/voice-keys.ts), and what goes
 * wrong is thrown in terms voiceSetupError understands.
 */
export async function checkVoiceKey(id: 'openai' | 'elevenlabs', key: string) {
  const res = await fetch('/murmur/voice/check-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ service: id, key: key.trim() }),
  })
  const checked = (await res.json().catch(() => null)) as { ok?: boolean; detail?: string } | null
  if (!checked?.ok) throw new Error(checked?.detail ?? 'Not checked')
}

/** Takes a voice's key off the agent, out of its .env and anywhere Hermes mirrors it. */
export const removeVoiceKey = (profile: string, id: 'openai' | 'elevenlabs') => api.delete(`/api/env?${q(profile)}`, { key: PAIRS[id].key })

/**
 * Where an agent's voice goes when its key or sign-in is taken away: nowhere if it wasn't the one in
 * use or it still works (OpenAI also runs on the key the agent's models use), otherwise to the
 * agent's own machine if it can talk there. `voice` is how things stand afterwards.
 */
export function afterRemoving(id: Exclude<VoiceChoice, 'local'>, voice: Voice, inUse: boolean, name: string): { to?: 'local' | 'none'; note: string } {
  const done = id === 'chatgpt' ? 'Signed out.' : 'Key removed.'
  if (id !== 'chatgpt' && voice.keys[id]) return { note: `${done} The voice still works with the key your models use.` }
  if (!inUse) return { note: done }
  if (!voice.localWorks) return { to: 'none', note: `${done} Choose another voice for ${name}.` }
  return { to: 'local', note: `${done} ${name} now talks on ${localPlace(voice.plugin)}.` }
}

export async function setLanguage(profile: string, lang: Language) {
  await api.put(`/api/config?${q(profile)}`, {
    config: { stt: { language: lang.id, local: { model: lang.id === 'en' ? 'base.en' : 'base' } }, tts: { piper: { voice: lang.piper } } },
  })
  // The plugin's pair follows the language: fetch this one's.
  const config = await api.get<Config>(`/api/config?${q(profile)}`).catch(() => ({}) as Config)
  if (config.stt?.provider === MURMUR) await installLocal(profile, lang.id).catch(() => {})
}

/**
 * On the Umbrel through the plugin: the language's pair of models, fetched in the background,
 * with Whisper and Piper (in this language) talking until they're here. False for a Hermes
 * without the plugin.
 */
async function chooseLocal(profile: string, lang: Language) {
  const plugin = await readLocal(profile, lang.id).catch(() => null)
  if (!plugin) return false
  await api.put(`/api/config?${q(profile)}`, {
    config: {
      stt: { provider: MURMUR, language: lang.id, local: { model: lang.id === 'en' ? 'base.en' : 'base' } },
      tts: { provider: MURMUR, piper: { voice: lang.piper } },
    },
  })
  await installLocal(profile, lang.id)
  return true
}

/** Say a line in the agent's voice: hearing it is how you know it works. */
export async function sampleVoice(profile: string, text: string) {
  const res = await api.post<{ data_url?: string }>(`/api/audio/speak?${q(profile)}`, { text })
  if (!res.data_url) throw new Error('No audio')
  return res.data_url
}

/** Has it listen to a line it said: a call needs it to hear as well as speak. */
export async function hearSample(profile: string, dataUrl: string) {
  const mime_type = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'audio/mpeg'
  await api.post(`/api/audio/transcribe?${q(profile)}`, { data_url: dataUrl, mime_type })
}

/**
 * What went wrong setting up a voice, and what to do about it. Only a key that's really been turned
 * down is called a bad key: most of what can go wrong here has nothing to do with the key.
 */
export function voiceSetupError(e: unknown, keyed = false, service = 'ElevenLabs') {
  const raw = e instanceof Error ? e.message : ''
  if (/missing_permissions|missing the permission/i.test(raw)) {
    const permission = /speech[_ ]to[_ ]text/i.test(raw) ? 'Speech to Text' : 'Text to Speech'
    return `Turn on ${permission} for this key in ${service}`
  }
  if (/not installed/i.test(raw)) return `This Hermes can’t use ${service} yet`
  if (/quota_exceeded|insufficient_quota|paid_plan|payment_required|payment_issue|credits|\b402\b/i.test(raw)) return `Your ${service} plan doesn’t cover this`
  if (/invalid_api_key|api key (is invalid|must)|unauthorized|\b401\b|\b403\b/i.test(raw)) return 'That key didn’t work'
  if (/connect|timed? ?out|resolve|network|unreachable|\b50[234]\b/i.test(raw)) return `Couldn’t reach ${service}, try again`
  return keyed ? 'Couldn’t check that key, try again' : 'Couldn’t switch, try again'
}

export function useVoiceRefresh() {
  const qc = useQueryClient()
  return (profile: string) => qc.invalidateQueries({ queryKey: voiceKey(profile) })
}

/**
 * Languages the agent can talk in on the Umbrel: Whisper hears them all; each
 * has a Piper voice, downloaded the first time it speaks.
 */
export type Language = { id: string; name: string; english: string; piper: string }
export const LANGUAGES: Language[] = [
  { id: 'en', name: 'English', english: 'English', piper: 'en_US-lessac-medium' },
  { id: 'es', name: 'Español', english: 'Spanish', piper: 'es_ES-davefx-medium' },
  { id: 'fr', name: 'Français', english: 'French', piper: 'fr_FR-siwis-medium' },
  { id: 'de', name: 'Deutsch', english: 'German', piper: 'de_DE-thorsten-medium' },
  { id: 'it', name: 'Italiano', english: 'Italian', piper: 'it_IT-paola-medium' },
  { id: 'pt', name: 'Português', english: 'Portuguese', piper: 'pt_BR-faber-medium' },
  { id: 'nl', name: 'Nederlands', english: 'Dutch', piper: 'nl_NL-pim-medium' },
  { id: 'pl', name: 'Polski', english: 'Polish', piper: 'pl_PL-gosia-medium' },
  { id: 'sv', name: 'Svenska', english: 'Swedish', piper: 'sv_SE-alma-medium' },
  { id: 'ru', name: 'Русский', english: 'Russian', piper: 'ru_RU-irina-medium' },
  { id: 'uk', name: 'Українська', english: 'Ukrainian', piper: 'uk_UA-ukrainian_tts-medium' },
  { id: 'tr', name: 'Türkçe', english: 'Turkish', piper: 'tr_TR-dfki-medium' },
  { id: 'hi', name: 'हिन्दी', english: 'Hindi', piper: 'hi_IN-priyamvada-medium' },
  { id: 'zh', name: '中文', english: 'Chinese', piper: 'zh_CN-huayan-medium' },
  { id: 'ja', name: '日本語', english: 'Japanese', piper: 'ja_JP-hi_fi_captain-medium' },
  { id: 'ko', name: '한국어', english: 'Korean', piper: 'ko_KR-kss-medium' },
]

/** Your device's language, if there's a voice for it. */
export const deviceLanguage = () =>
  LANGUAGES.find((l) => l.id === (navigator.language || 'en').slice(0, 2).toLowerCase()) ?? LANGUAGES[0]

/**
 * The language an agent's local voices use: the one chosen for it, else this device's. Every Hermes
 * starts on English, so English only counts once the agent talks locally.
 */
export function agentLanguage(voice: Pick<Voice, 'language' | 'local'>) {
  const saved = LANGUAGES.find((l) => l.id === voice.language)
  return saved && (saved.id !== 'en' || voice.local) ? saved : deviceLanguage()
}

/** A hello in each language, for the sample. */
export const HELLO: Record<string, (name: string) => string> = {
  en: (n) => `Hi, I’m ${n}. This is how I sound.`,
  es: (n) => `Hola, soy ${n}. Así es como sueno.`,
  fr: (n) => `Bonjour, je suis ${n}. Voici ma voix.`,
  de: (n) => `Hallo, ich bin ${n}. So klinge ich.`,
  it: (n) => `Ciao, sono ${n}. Ecco come suono.`,
  pt: (n) => `Olá, eu sou ${n}. Esta é a minha voz.`,
  nl: (n) => `Hallo, ik ben ${n}. Zo klink ik.`,
  pl: (n) => `Cześć, jestem ${n}. Tak brzmi mój głos.`,
  sv: (n) => `Hej, jag är ${n}. Så här låter jag.`,
  ru: (n) => `Привет, я ${n}. Вот как звучит мой голос.`,
  uk: (n) => `Привіт, я ${n}. Ось так звучить мій голос.`,
  tr: (n) => `Merhaba, ben ${n}. Sesim böyle.`,
  hi: (n) => `नमस्ते, मैं ${n} हूँ। मेरी आवाज़ ऐसी है।`,
  zh: (n) => `你好，我是${n}。这是我的声音。`,
  ja: (n) => `こんにちは、${n}です。これが私の声です。`,
  ko: (n) => `안녕하세요, 저는 ${n}입니다. 제 목소리예요.`,
}
