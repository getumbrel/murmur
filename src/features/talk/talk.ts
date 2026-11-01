// A call with an agent: you talk, it answers out loud, and every turn is an
// ordinary message in the chat. Usually listening, transcribing and speaking
// all go through Hermes's own voice settings (POST /api/audio/transcribe and
// /api/audio/speak, the same ones dictation and Read aloud use). On a ChatGPT
// plan, OpenAI's live voice does the listening and speaking instead and hands
// each request over (live.ts). Either way a spoken turn is a normal
// prompt.submit with voice_turn, so the agent answers briefly and fast.
// Murmur keeps nothing of its own beyond the call itself.

import { create } from 'zustand'
import { api, HermesError } from '@/hermes/rest'
import { getChat, keepSpoken, send, stop as stopReply, useChats } from '@/state/chats'
import { splitMessage } from '@shared/message.ts'
import { gather, umbrelTool, type Find, type Found } from '@/features/umbrel/finds'
import { ASK_TOOL, OPENS_PAGES, pastLabel, serverName, toolCategory } from '@/features/chat/tool-labels'
import type { ChatItem } from '@/features/chat/types'
import type { BrowserStep } from '@/features/screen/drawn'
import { stopSpeaking } from '@/features/voice/speech'
import { LiveCall, liveInstructions, liveStartError, openaiLiveInstructions } from './live'
import { developerMessage, liveHistory } from './live-history'
import { Mic, micError, type MicEvents } from './mic'
import { PieceVoice, piecesSupported } from './piece-voice'
import { RecorderMic, recorderSupported } from './recorder-mic'
import { Sentences, Voice, type Spoken } from './voice'
import { StreamVoice } from './stream-voice'
import { isIOS } from './ios'
import { spokenIds } from './spoken'
import { closeSounds, loopSound, playSound, unlockSounds } from './sounds'

export type Phase = 'connecting' | 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking' | 'waiting'

/** Who listens and speaks: Hermes's own voice settings, or OpenAI's live voice on a ChatGPT plan or an OpenAI key. */
export type Engine = 'chained' | 'chatgpt' | 'openai'

/** Something the reply brought that's better seen than heard. */
export type StageItem =
  | { key: string; kind: 'media'; path: string }
  | { key: string; kind: 'preview'; file: string }
  /** What it found on the Umbrel (umbrel/finds.ts): kept up to date as it works. */
  | { key: string; kind: 'find'; find: Find }
  /** What it did through the agent's other connections (lights, calendars, messages), as it does it. */
  | { key: string; kind: 'steps'; steps: Step[] }
  /** It asks before doing something: answered right on the call. */
  | { key: string; kind: 'approval'; item: Extract<ChatItem, { kind: 'approval' }> }
  /** Its browser, live while it works in it; `ask` while it waits for you to take over there. */
  | { key: string; kind: 'browser'; step: BrowserStep; site?: string; ask?: Extract<ChatItem, { kind: 'tool' }> }

/** Something the agent did with a connected app, for the stage. */
export type Step = { id: string; label: string; detail?: string; done: boolean; failed: boolean; where?: string }

type Talk = {
  open: boolean
  chatId?: string
  profile?: string
  /** Who listens and speaks on this call. */
  engine: Engine
  /** That's the agent's own machine's voices. */
  local: boolean
  phase: Phase
  /** Your voice, 0–1. */
  level: number
  muted: boolean
  /** Folded into the chat's call button while you look at the chat. */
  minimized: boolean
  startedAt: number
  /** What you're saying, word by word as the live voice hears it. */
  hearing?: string
  /** What you said last, once it's been heard. */
  you?: string
  /** The sentence the agent is saying now. */
  spoken?: Spoken
  /** What the agent is doing: "Searching the web". */
  activity?: string
  /** The voice it's moving to. */
  switching?: string
  stage: StageItem[]
  error?: string
  /** Where the call grew from (the call button), in viewport pixels. */
  origin?: { x: number; y: number }
}

export const useTalk = create<Talk>(() => ({
  open: false,
  engine: 'chained',
  local: false,
  phase: 'connecting',
  level: 0,
  muted: false,
  minimized: false,
  startedAt: 0,
  stage: [],
}))
const set = useTalk.setState
const get = useTalk.getState

/** A blank chat only becomes a real one on the first thing you say. */
let makeChat: (() => Promise<string>) | undefined
let making: Promise<string> | undefined
let mic: Mic | RecorderMic | undefined
/** On the live voice: the call, and its name for the request being answered. */
let live: LiveCall | undefined
let delegation: string | undefined
/** What you said last on a live call, for the chat (the voice's request is its own wording). */
let lastHeard: { text: string; at: number } | undefined
/** Fades out the pulse that plays while the call connects. */
let connecting: (() => void) | undefined
/** The other end hung up (its chime has played). */
let dropped = false
/** Keeps a phone's screen on through the call. */
let awake: WakeLockSentinel | undefined
let release: (() => void) | undefined
let voice: Voice | StreamVoice | PieceVoice | undefined
/** Both ways of speaking, unlocked in the tap: a switch can need the other one. */
let mouths: { plain: Voice; streamed: Voice | StreamVoice | PieceVoice } | undefined
/** Connects a voice to the call. */
let connect: ((plan: CallPlan, at: number) => void) | undefined
/** The voice in use, and the one to move to at the next quiet moment. */
let current: CallPlan | undefined
let nextPlan: CallPlan | undefined
/** Moving to another voice: it carries on the call, so no greeting and no chimes. */
let rejoining = false
let watch: (() => void) | undefined
let run = 0
let interrupted = false
/** It's waiting for you in its browser (asking for a hand): talking doesn't stop that, handing back does. */
let handing = false
let turn = 0
/** The reply to your last turn is fully written (or there's none coming). */
let replyDone = true
/** The chat keeps what the live voice answers by itself. */
let keeping = false
/** A request went out with the voice's own wording: your words for it are still to come. */
let handedOver = false
/** Your words to the live voice and its answer, until it's clear it answered by itself. */
let exchange = { you: '', saying: '', said: '' }
/** It's finished answering: a moment to see whether it hands the words to the agent after all. */
let holding: ReturnType<typeof setTimeout> | undefined
/** Exchanges go into the chat one at a time, in the order they were said. */
let keeps: Promise<unknown> = Promise.resolve()
const HOLD_MS = 1500
/** How long a request waits for the words you said, which are usually a moment behind it. */
const WORDS_WAIT_MS = 1500
/** About two minutes of waiting for the agent to finish. */
const KEEP_TRIES = 300
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))
/** A voice Murmur picked by itself: the ones to try next if it doesn't pick up, best first. */
let fallbacks: Engine[] = []
let onFallback: ((engine: Engine) => Promise<unknown> | void) | undefined
/** The mouth a fallback to Hermes's own voice settings speaks with (unlocked in the tap). */
let fallbackVoice: Voice | StreamVoice | PieceVoice | undefined

/** Who listens and speaks on a call, and what to do if that voice doesn't pick up. */
export type CallPlan = {
  engine: Engine
  /** Its voice streams (the Umbrel's own): each sentence plays as it's made. */
  stream?: boolean
  /** Voices to fall back on, in order, if this one doesn't pick up (when Murmur chose it). */
  fallbacks?: Engine[]
  /** Moving to a fallback: save it as the agent's voice. The call waits for it before warming up. */
  onFallback?: (engine: Engine) => Promise<unknown> | void
  /** The voice is still being saved: warming up waits for it, so it warms the right engines. */
  setup?: Promise<unknown>
  /** Falling back to Hermes's own voice settings, they stream (the Umbrel's own voices). */
  fallbackStream?: boolean
  /** What a live voice answers by itself can be saved in the chat (the image's plugin). */
  keeps?: boolean
}

/**
 * Starts a call in a chat. Call it from the tap itself (phones only play sound
 * a tap starts). A blank chat passes `newChat`, which makes it on your first turn.
 * `plan` is for a voice that's only known once Hermes answers: the call opens at
 * once and starts listening when it's in (null hangs up).
 */
export function startCall(opts: Partial<CallPlan> & {
  chatId?: string
  newChat?: () => Promise<string>
  profile: string
  origin?: { x: number; y: number }
  /** The agent's name, for the live voice to go by. */
  name?: string
  plan?: Promise<CallPlan | null>
}) {
  if (get().open) return
  const { chatId, profile, origin } = opts
  makeChat = opts.newChat
  making = undefined
  const mine = ++run
  const engine = opts.engine ?? 'chained'
  stopSpeaking()
  unlockSounds()
  dropped = false
  connecting?.()
  connecting = loopSound('recording')
  interrupted = false
  replyDone = true
  lastHeard = undefined
  handedOver = false
  delegation = undefined
  set({
    open: true,
    chatId,
    profile,
    engine,
    phase: 'connecting',
    level: 0,
    muted: false,
    minimized: false,
    startedAt: Date.now(),
    hearing: undefined,
    you: undefined,
    spoken: undefined,
    activity: undefined,
    stage: [],
    error: undefined,
    switching: undefined,
    origin,
  })
  current = nextPlan = undefined
  rejoining = false
  navigator.wakeLock?.request('screen').then((l) => (awake = l), () => {})
  // Both mouths are unlocked inside the tap, as phones require: which one speaks may only be
  // known once Hermes answers, or once a live voice that doesn't pick up hands over.
  const plain = new Voice(profile)
  plain.unlock()
  const ios = isIOS()
  // (Web Audio isn't an option on iOS: see ios.ts.)
  const streamed = !ios ? new StreamVoice(profile) : piecesSupported() ? new PieceVoice(profile) : new Voice(profile, true)
  streamed.unlock()
  mouths = { plain, streamed }
  const go = (plan: CallPlan, at = mine) => {
    if (at !== run) return
    current = plan
    fallbacks = [...(plan.fallbacks ?? [])]
    onFallback = plan.onFallback
    fallbackVoice = plan.fallbackStream ? streamed : plain
    keeping = !!plan.keeps
    voice = plan.stream ? streamed : plain
    set({ engine: plan.engine, local: !!plan.stream })
    if (plan.engine !== 'chained') return startLive(profile, opts.name, at, plan.engine)
    startChained(profile, at, plan.setup)
  }
  connect = go
  if (!opts.plan) return go({ ...opts, engine })
  opts.plan.then(
    (plan) => (plan ? go(plan) : mine === run && endCall()),
    () => go({ engine: 'chained' }),
  )
}

/** Hermes's own voice settings listen and speak: the mic in the browser, words through Hermes. */
function startChained(profile: string, mine: number, setup?: Promise<unknown>) {
  voice ??= new Voice(profile)
  listenTo(voice, mine)
  const events: MicEvents = {
    level: (level) => get().open && set({ level }),
    speechStart: () => set({ phase: 'hearing', hearing: undefined, you: undefined, error: undefined }),
    turn: (wav) => void heard(wav, mine),
    barge: () => {
      // You talked over it: it stops at once and listens.
      voice?.stop()
      const id = get().chatId
      if (id && busy(id)) void stopReply(id)
      interrupted = true
      set({ phase: 'hearing', spoken: undefined, you: undefined })
    },
    nothing: () => {
      if (get().phase !== 'hearing') return
      set({ phase: 'listening' })
      // It stopped talking for you, so it doesn't just sit there.
      if (interrupted) {
        mic?.setMode('barge')
        voice?.say('Sorry, I didn’t catch that.')
      } else cutOver()
    },
    deaf: () => set({ error: 'The microphone stopped. Hang up and call again.' }),
  }
  // (Its own name for itself: by the time it's open, `mic` may be another call's or another voice's.)
  const ear = (mic = isIOS() && recorderSupported() ? new RecorderMic(events, profile) : new Mic(events))
  // Load the agent's speech engines now, so the first turn doesn't wait on them.
  const lease = `murmur-talk-${Date.now()}`
  const warm = (kind: 'stt' | 'tts', active: boolean) =>
    api.post(`/api/audio/${kind}-lease?profile=${encodeURIComponent(profile)}`, { lease, active }).catch(() => {})
  void Promise.resolve(setup)
    .catch(() => {})
    .then(() => {
      if (mine !== run) return
      void warm('stt', true)
      void warm('tts', true)
    })
  release = () => (void warm('stt', false), void warm('tts', false))
  ear.open().then(
    () => {
      if (mine !== run) return ear.close()
      ear.setMode('listen')
      set({ phase: 'listening' })
      pickedUp()
    },
    (e) => {
      if (mine !== run) return
      stopConnecting()
      set({ error: micError(e), phase: 'listening' })
    },
  )
}

function listenTo(mouth: Voice | StreamVoice | PieceVoice, mine: number) {
  mouth.onStart = (s) => set({ spoken: s, phase: 'speaking' })
  mouth.onIdle = () => {
    if (mine !== run) return
    set({ spoken: undefined })
    settle()
  }
  mouth.onError = (message) => set({ error: message })
}

/** The same call on OpenAI's live voice, which listens and speaks itself. */
function startLive(profile: string, name: string | undefined, mine: number, way: 'chatgpt' | 'openai') {
  const now = () => mine === run && get().open
  live = new LiveCall(profile, {
    // Not before: "Listening" means it can hear you.
    ready: () => {
      if (!now() || get().phase !== 'connecting') return
      const carryingOn = rejoining
      set({ phase: 'listening' })
      pickedUp()
      // It picks up like a phone call, so you know it's there before you speak.
      if (!carryingOn) live?.greet('Hi! I’m here.')
    },
    level: (level) => now() && (get().phase === 'listening' || get().phase === 'hearing') && set({ level }),
    // Your words show as you say them, not once you've finished.
    hearing: (words) => {
      if (!now()) return
      // A new turn: what you said last isn't what any request from here on is about.
      lastHeard = undefined
      set({ phase: 'hearing', hearing: words, you: undefined, spoken: undefined, error: undefined })
    },
    heard: (text) => {
      if (!now()) return
      lastHeard = { text, at: Date.now() }
      set({ you: text, hearing: undefined, ...(get().phase === 'hearing' ? { phase: 'thinking' as const } : {}) })
      // These words came in after the request they were for: the agent has them.
      if (handedOver) {
        handedOver = false
        return
      }
      // The last exchange stands, now you've moved on. A blank chat is made on your first words.
      if (holding) keepExchange()
      exchange.you = [exchange.you, text].filter(Boolean).join(' ')
      if (keeping) void chatFor(mine)
    },
    request: (id, text) => void requested(id, text, mine),
    saying: (text) => {
      if (!now()) return
      // Saying the agent's answer, or filling in while it works: that isn't its own.
      if (replyDone) exchange.saying = text
      set({ spoken: liveLine(text, !get().spoken), phase: 'speaking' })
    },
    said: (whole) => {
      if (!now()) return
      if (whole && replyDone) exchange.saying = whole
      // (With nothing of yours before it, it's picking up the call: nothing to keep.)
      if (exchange.you) {
        exchange.said = [exchange.said, exchange.saying].filter(Boolean).join(' ')
        if (exchange.said) {
          clearTimeout(holding)
          holding = setTimeout(keepExchange, HOLD_MS)
        }
      }
      exchange.saying = ''
      // Its "sure, one moment" is said, and the agent is still at it: show it working.
      set({ spoken: undefined, ...(replyDone || get().phase !== 'speaking' ? {} : { phase: 'thinking' as const }) })
      settle()
    },
    ended: () => {
      if (!now()) return
      stopConnecting()
      if (!dropped) playSound('disconnect')
      dropped = true
      set({ error: 'The call ended. Call again to keep talking.', phase: 'listening' })
    },
    error: (message) => now() && set({ error: message }),
  }, way)
  // Picked up in a chat, it knows the chat. (Hermes has it anyway for what's handed over.)
  const { chatId } = get()
  const history = liveHistory((chatId && getChat(chatId)?.items) || [])
  const instructions = way === 'openai' ? openaiLiveInstructions(name ?? 'the agent') : liveInstructions(name ?? 'the agent')
  // On a ChatGPT plan the session's instructions don't reach the voice, but its opening messages do.
  // Last of them, nearest the conversation: ahead of the chat, it still called itself ChatGPT.
  live.start(instructions, way === 'chatgpt' ? [...history, developerMessage(instructions)] : history).catch((e) => {
    if (!now()) return
    // Murmur picked this voice and it didn't pick up: carry on with the next one, unnoticed.
    // (Not for the microphone, which every voice needs.)
    const next = e instanceof DOMException ? undefined : fallbacks.shift()
    if (next) {
      live?.close()
      live = undefined
      if (next === 'chained' && fallbackVoice) voice = fallbackVoice
      set({ engine: next, local: next === 'chained' && fallbackVoice === mouths?.streamed })
      const saved = Promise.resolve(onFallback?.(next))
      return next === 'chained' ? startChained(profile, mine, saved) : startLive(profile, name, mine, next)
    }
    stopConnecting()
    set({ error: liveStartError(e, way), phase: 'listening', switching: undefined })
  })
}

function stopConnecting() {
  connecting?.()
  connecting = undefined
}

/** It can hear you: the pulse stops and it chimes, the way a call picks up. */
function pickedUp() {
  stopConnecting()
  if (rejoining) {
    rejoining = false
    set({ switching: undefined })
    return cutOver()
  }
  // iOS calls need no Web Audio, and any left running makes them crackle (see ios.ts).
  if (isIOS()) closeSounds()
  else playSound('connect')
}

/** The live voice asked the agent for something: a voice turn, as if you'd typed it. */
async function requested(id: string, text: string, mine: number) {
  // These words went to the agent, which saves them itself.
  clearTimeout(holding)
  holding = undefined
  exchange = { you: '', saying: '', said: '' }
  // Your own words read better in the chat than the voice's wording of them, and they can arrive
  // just after the request does.
  for (let waited = 0; !lastHeard && waited < WORDS_WAIT_MS; waited += 100) await pause(100)
  const said = lastHeard?.text ?? text
  handedOver = !lastHeard
  lastHeard = undefined
  exchange = { you: '', saying: '', said: '' }
  const chatId = await chatFor(mine)
  if (!chatId || mine !== run) return
  if (handing) return live?.say(id, 'I’m still waiting for you in the browser. Hand it back when you’re done, and I’ll carry on.')
  // A new request while it's still on the last one: that one stops.
  if (busy(chatId)) {
    await stopReply(chatId)
    interrupted = true
  }
  delegation = id
  ask(chatId, said, mine)
}

/** Files the finished exchange in the chat, once the agent isn't working in it. */
function keepExchange() {
  clearTimeout(holding)
  holding = undefined
  const { you, said } = exchange
  exchange = { you: '', saying: '', said: '' }
  if (!keeping || !you || !said) return
  const chat = making
  keeps = keeps
    .then(async () => {
      const chatId = get().chatId ?? (await chat)
      if (!chatId) return
      const itemId = `talk-${Date.now()}-${++turn}`
      spokenIds.add(itemId)
      for (let tries = 0; tries < KEEP_TRIES; tries++) {
        try {
          if (!busy(chatId)) return await keepSpoken(chatId, you, said, itemId)
        } catch (e) {
          // Anything but a turn that's just started: this exchange stays out of the chat.
          if (!(e instanceof HermesError && e.status === 409)) return
        }
        await pause(400)
      }
    })
    .catch(() => {})
}

let liveTurn = 0
/** The sentence the live voice is on, out of what it has said so far this time. */
function liveLine(text: string, fresh: boolean): Spoken {
  if (fresh) liveTurn++
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g) ?? [text]
  const at = Math.max(0, sentences.findLastIndex((s) => /[\p{L}\p{N}]/u.test(s)))
  // Its clock isn't ours to read: every word it has said is lit as it arrives.
  return { id: liveTurn * 1000 + at, text: sentences[at].trim(), startedAt: performance.now(), duration: 0 }
}

/** Between turns: the agent isn't answering, and nobody's talking. */
const quiet = () => {
  const { phase } = get()
  return (phase === 'listening' || phase === 'connecting') && replyDone && !voice?.busy && !live?.busy
}

const sameVoice = (a: CallPlan, b?: CallPlan) => a.engine === b?.engine && (a.engine !== 'chained' || !!a.stream === !!b.stream)

/**
 * Changes the voice of a call that's under way, to carry on where it is: the same chat, the same
 * clock. An answer under way finishes in the voice that started it, and so does a turn being heard,
 * so nothing's lost: the move comes at the next quiet moment, with the status saying it's on its way.
 */
export function switchVoice(plan: CallPlan, name: string) {
  if (!get().open) return
  if (sameVoice(plan, current)) {
    nextPlan = undefined
    return void set({ switching: undefined })
  }
  nextPlan = plan
  set({ switching: name })
  cutOver()
}

function cutOver() {
  const plan = nextPlan
  if (!plan || !connect || !quiet()) return
  nextPlan = undefined
  const go = connect
  const staying = current
  // Between two of Hermes's own voices only the mouth changes: the mic's fine as it is.
  if (staying?.engine === 'chained' && plan.engine === 'chained' && mic && mouths) {
    voice?.stop()
    voice = plan.stream ? mouths.streamed : mouths.plain
    listenTo(voice, run)
    current = plan
    return set({ switching: undefined, local: !!plan.stream })
  }
  keepExchange()
  const mine = ++run
  watch?.()
  watch = undefined
  live?.close()
  live = undefined
  delegation = undefined
  mic?.close()
  mic = undefined
  voice?.stop()
  release?.()
  release = undefined
  lastHeard = undefined
  handedOver = false
  rejoining = true
  set({ phase: 'connecting', level: 0, spoken: undefined, hearing: undefined, activity: undefined, error: undefined })
  // If it doesn't pick up, the call carries on in the voice it had.
  const back = staying && { fallbacks: [staying.engine], fallbackStream: staying.stream, onFallback: undefined }
  // What was just said goes into the chat first, so the new voice knows it. It won't wait long.
  void Promise.race([keeps, pause(1500)]).then(() => go({ ...plan, ...back }, mine))
}

export function endCall() {
  keepExchange()
  if (get().open && !dropped) playSound('disconnect')
  stopConnecting()
  run++
  makeChat = undefined
  making = undefined
  connect = undefined
  current = nextPlan = undefined
  rejoining = false
  live?.close()
  live = undefined
  delegation = undefined
  watch?.()
  watch = undefined
  handing = false
  mic?.close()
  mic = undefined
  for (const mouth of mouths ? [mouths.plain, mouths.streamed] : [voice]) {
    if (mouth instanceof PieceVoice) mouth.close()
    else mouth?.stop()
  }
  mouths = voice = undefined
  release?.()
  release = undefined
  void awake?.release().catch(() => {})
  awake = undefined
  set({ open: false, minimized: false, level: 0, spoken: undefined, activity: undefined, switching: undefined })
}

export function setMuted(muted: boolean) {
  mic?.setMuted(muted)
  live?.setMuted(muted)
  set({ muted, level: 0 })
}

/** You've finished, whatever the mic made of it: a tap on the words. */
export function finishTurn() {
  const { phase } = get()
  if (phase === 'listening' || phase === 'hearing') mic?.finish()
}

export function setMinimized(minimized: boolean) {
  set({ minimized })
}

/** Where the agent's voice is in the sentence it's saying, in seconds. */
export const voicePosition = () => voice?.position ?? 0

const busy = (id: string) => {
  const s = getChat(id)?.status
  return !!s && s !== 'idle' && s !== 'error'
}

async function heard(wav: Blob, mine: number) {
  const { profile } = get()
  if (!profile) return
  mic?.setMode('off')
  set({ phase: 'transcribing' })
  let text = ''
  try {
    const res = await api.post<{ transcript?: string }>(`/api/audio/transcribe?profile=${encodeURIComponent(profile)}`, {
      data_url: await dataUrl(wav),
      mime_type: wav.type.split(';')[0] || 'audio/wav',
    })
    text = res.transcript?.trim() ?? ''
  } catch (e) {
    if (mine !== run) return
    set({ error: transcribeError(e instanceof Error ? e.message : '') })
  }
  if (mine !== run) return
  if (!text) {
    // Nothing worth sending (a cough, the TV): keep listening.
    mic?.setMode('listen')
    set({ phase: 'listening' })
    return cutOver()
  }
  const chatId = await chatFor(mine)
  if (chatId && mine === run) ask(chatId, text, mine)
}

/** The call's chat, made on the first thing you say when it's a blank one. */
async function chatFor(mine: number) {
  const had = get().chatId
  if (had || !makeChat) return had
  try {
    making ??= makeChat()
    const chatId = await making
    if (mine !== run) return undefined
    makeChat = undefined
    set({ chatId })
    return chatId
  } catch {
    making = undefined
    if (mine !== run) return undefined
    mic?.setMode('listen')
    set({ phase: 'listening', error: 'Can’t start a chat right now. Check that Hermes is running, then try again.' })
    return undefined
  }
}

function ask(chatId: string, text: string, mine: number) {
  const itemId = `talk-${Date.now()}-${++turn}`
  spokenIds.add(itemId)
  // What's on the stage stays for the next turn ("open that one"), until this one brings something.
  set({ you: text, hearing: undefined, phase: 'thinking', activity: undefined, error: undefined })
  const context = recent(chatId)
  void send(chatId, text, [], { itemId, voice: { interrupted, context } }).catch(() => {})
  interrupted = false
  follow(chatId, itemId, mine)
}

/**
 * The call has a screen, and the agent should use it: Hermes's live-voice note
 * asks for plain spoken sentences, which on its own talks an agent out of
 * showing anything. Goes to the model only, with the context, every turn.
 */
const SCREEN =
  '(This call has a screen beside the voice. What your Umbrel tools turn up (photos, files, apps, how it is doing) shows on it by itself. ' +
  'Anything else worth seeing, add the way you would in the app (MEDIA: lines, ::preview widgets for charts, tables, maps or pages) and it appears while you speak. ' +
  'Show rather than describe.)'

/** The last few spoken exchanges, so a short reply ("yes, Thursday") makes sense to the agent. */
function recent(chatId: string) {
  const items = getChat(chatId)?.items ?? []
  const lines = items
    .filter((i) => i.kind === 'user' || i.kind === 'assistant')
    .slice(-6)
    .map((i) => `${i.kind === 'user' ? 'User' : 'Assistant'}: ${(i as { text: string }).text.slice(0, 400)}`)
  return [SCREEN, ...lines].join('\n')
}

/** Follows the reply to your turn: speaks it as it's written and puts what it brings on the stage. */
function follow(chatId: string, itemId: string, mine: number) {
  watch?.()
  const readers = new Map<string, Sentences>()
  // What's on the stage, in the order it first showed; a card that changes keeps its place.
  // The last turn's cards (not its questions, which are answered), then this turn's in front.
  const carried = get().stage.filter((i) => i.kind !== 'approval')
  const order = carried.map((i) => i.key)
  const shown = new Map<string, StageItem>(carried.map((i) => [i.key, i]))
  const now = new Set<string>()
  const show = (item: StageItem) => {
    // Something from before that this turn brings again comes to the front.
    if (!now.has(item.key)) {
      now.add(item.key)
      const at = order.indexOf(item.key)
      if (at >= 0) order.splice(at, 1)
      order.push(item.key)
    }
    shown.set(item.key, item)
  }
  replyDone = false
  // Said out loud: by Hermes's voice, or handed to the live voice as its answer.
  const answer = delegation
  let answering = false
  const speak = (sentence: string) => {
    answering = true
    return live ? answer && live.say(answer, sentence) : voice?.say(sentence)
  }
  // The voice says something each time it's told what the agent is doing, so it's told rarely:
  // each thing once, a while apart, and never once the answer has started.
  const noted = new Set<string>()
  let notedAt = Date.now()
  // A tick as each thing lands on the stage, a knock when it needs you.
  const landed = new Set<string>()
  let tickedAt = 0
  let wasWaiting = false
  const update = () => {
    if (mine !== run) return
    const chat = getChat(chatId)
    if (!chat) return
    const at = chat.items.findIndex((i) => i.id === itemId)
    if (at < 0) return
    const after = chat.items.slice(at + 1)
    let activity: string | undefined
    const found: Found[] = []
    const steps: Step[] = []
    let site: string | undefined
    let ask: ToolStep | undefined
    let browsed: ToolStep | undefined
    for (const item of after) {
      if (item.kind === 'tool') {
        if (item.status === 'running') activity = activityOf(item) ?? activity
        // Its browser, live, while it works in it; asking you to take over there when it needs a hand.
        if (item.name === ASK_TOOL || item.name.startsWith('browser_')) {
          if (OPENS_PAGES.has(item.name) && item.detail) site = item.detail
          if (item.name === ASK_TOOL) ask = item.status === 'running' ? item : undefined
          else browsed ??= item
          // Its first step there, which the card waits for (the chat's card goes by the same one).
          const step = { key: browsed?.id ?? itemId, done: browsed?.status !== 'running' }
          show({ key: 'browser', kind: 'browser', step, site, ask })
          continue
        }
        // Shown at once, then filled in: a search's card appears as it starts looking.
        const piece = item.found ?? (item.status === 'running' ? item.looking : undefined)
        if (piece) {
          found.push(piece)
          for (const find of gather(found, { live: true })) show({ key: `f:${find.key}`, kind: 'find', find })
        } else {
          for (const path of item.media ?? []) show({ key: `m:${path}`, kind: 'media', path })
          const step = stepOf(item)
          if (step) {
            steps.push(step)
            show({ key: 'steps', kind: 'steps', steps: [...steps] })
          }
        }
      }
      if (item.kind === 'approval') show({ key: `a:${item.id}`, kind: 'approval', item })
      if (item.kind !== 'assistant') continue
      for (const seg of splitMessage(item.text, item.streaming)) {
        if (seg.kind === 'media') show({ key: `m:${seg.path}`, kind: 'media', path: seg.path })
        if (seg.kind === 'preview') show({ key: `p:${seg.file}`, kind: 'preview', file: seg.file })
      }
      let reader = readers.get(item.id)
      if (!reader) readers.set(item.id, (reader = new Sentences()))
      for (const s of reader.take(item.text, !item.streaming)) speak(s)
    }
    const inCards = new Set(
      [...shown.values()].flatMap((i) => (i.kind === 'find' && i.find.kind === 'photos' ? i.find.photos.flatMap((p) => p.media ?? []) : [])),
    )
    handing = !!ask
    const waiting = chat.status === 'waiting' || handing
    const asking = after.findLast((i) => i.kind === 'approval' && i.status === 'pending')
    // The live voice keeps the person company while the agent works: it knows what it's doing.
    // An OK or a hand it needs is always said; the rest only when it's been quiet a while.
    const needs = ask
      ? `Waiting for them to take over the browser on screen${ask.detail ? `: ${ask.detail}` : '.'}`
      : waiting && asking?.kind === 'approval'
        ? `Waiting for their OK on screen to ${lower(asking.title)}.`
        : undefined
    const doing = needs ?? (activity && `Still working on it: ${lower(activity)}.`)
    if (live && answer && doing && (!answering || ask) && !noted.has(doing) && (needs || Date.now() - notedAt >= NOTE_GAP)) {
      noted.add(doing)
      notedAt = Date.now()
      live.note(answer, doing)
    }
    // Hermes's own voice says what it needs in the agent's words, and stops listening until it's
    // handed back: nothing said while you're in its browser stops it waiting.
    if (!live && ask && !noted.has(ask.id)) {
      noted.add(ask.id)
      if (ask.detail) voice?.say(ask.detail)
    }
    if (!live && handing && mic && mic.mode !== 'off') mic.setMode('off')
    if (waiting && !wasWaiting) playSound('blocked')
    wasWaiting = waiting
    const fresh = [...shown.values()].filter((i) => now.has(i.key) && !landed.has(i.key) && filled(i))
    for (const i of fresh) landed.add(i.key)
    if (fresh.length && Date.now() - tickedAt > 900) {
      tickedAt = Date.now()
      playSound('info')
    }
    const phase = get().phase
    const failed = chat.status === 'error' ? after.findLast((i) => i.kind === 'error') : undefined
    set({
      activity: waiting ? 'Needs you' : activity,
      ...(failed?.kind === 'error' ? { error: failed.message } : {}),
      stage: order.flatMap((key) => {
        const item = shown.get(key)!
        // A picture of a photo it found is already on the stage, in its card.
        return item.kind === 'media' && inCards.has(item.path) ? [] : [item]
      }),
      ...(waiting ? { phase: 'waiting' as const } : phase === 'waiting' ? { phase: 'thinking' as const } : {}),
    })
    // Once the reply is under way, talking over it is an interruption.
    if (after.length && mic?.mode === 'off' && !handing) mic.setMode('barge')
    replyDone = chat.status === 'idle' || chat.status === 'error'
    if (replyDone) settle()
  }
  watch = useChats.subscribe(update)
  update()
}

/** On the stage with something to see: not a card still waiting on its result, nor a question for you. */
function filled(item: StageItem) {
  if (item.kind === 'find') return !item.find.pending
  if (item.kind === 'steps') return item.steps.some((s) => s.done)
  return item.kind !== 'approval'
}

type ToolStep = Extract<ChatItem, { kind: 'tool' }>

/** On a call, what it's doing in the words you'd use; getting itself ready doesn't count. */
const UMBREL_DOING: Record<string, string> = {
  search: 'Searching your Umbrel',
  list_photos: 'Looking through your photos',
  get_photo: 'Looking at a photo',
  list_directory: 'Looking in your files',
  list_apps: 'Checking your apps',
  get_app_status: 'Checking on the app',
  get_app_details: 'Checking on the app',
  search_app_store: 'Looking in the App Store',
  get_app_store_details: 'Looking in the App Store',
  get_system_resources: 'Checking on your Umbrel',
  get_system_info: 'Checking on your Umbrel',
}
const APP_DOING: Record<string, string> = {
  install_app: 'Installing',
  start_app: 'Starting',
  stop_app: 'Stopping',
  restart_app: 'Restarting',
  update_app: 'Updating',
  uninstall_app: 'Removing',
}
const QUIET = new Set(['playbook', 'plan', 'memory'])
const titled = (id: string) => id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function activityOf(item: ToolStep) {
  const tool = umbrelTool(item.name)?.tool
  if (tool && APP_DOING[tool]) return item.detail ? `${APP_DOING[tool]} ${titled(item.detail)}` : APP_DOING[tool]
  if (tool) return UMBREL_DOING[tool] ?? item.label
  const category = toolCategory(item.name)
  if (QUIET.has(category) || item.name.startsWith('tool_')) return undefined
  // How it works something out is its business: "running a command" means nothing on a call.
  if (category === 'terminal' || category === 'code') return 'Working it out'
  return item.label
}

/** How long the agent works before the voice says what it's doing (and between such updates). */
const NOTE_GAP = 15_000

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1).replace(/[.!?]+$/, '')

const CONNECTED = /^mcp__(.+?)__/

/** A step through a connected app with nothing to show for it but itself: "Turned on the porch light". */
function stepOf(item: ToolStep): Step | undefined {
  const server = CONNECTED.exec(item.name)?.[1]
  if (!server) return undefined
  const done = item.status !== 'running'
  return {
    id: item.id,
    label: done ? pastLabel(item.label) : item.label,
    detail: item.detail,
    done,
    failed: item.status === 'error',
    where: serverName(server),
  }
}

/** The reply is written and said: your turn again. */
function settle() {
  if (!get().open || voice?.busy || live?.busy || !replyDone) return
  const phase = get().phase
  if (phase === 'hearing' || phase === 'transcribing') return
  watch?.()
  watch = undefined
  mic?.setMode('listen')
  // It has answered: your words don't come back once its own have gone.
  set({ phase: 'listening', activity: undefined, spoken: undefined, hearing: undefined, you: undefined })
  cutOver()
}

function transcribeError(raw: string) {
  if (/disabled|not installed|no installed|no .*(stt|speech)|not configured|configured to use|no provider|api[ _]key/i.test(raw))
    return 'Listening isn’t set up on this Hermes yet.'
  return 'Couldn’t make that out. Try again.'
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
