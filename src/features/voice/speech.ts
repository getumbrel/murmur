// Read aloud. One voice at a time across the whole app: starting a reply
// stops whatever was playing. Hermes turns text into speech with the agent's
// own voice settings (and strips markdown and file tags itself); long replies
// go in chunks, the next one fetched while the current one plays.

import { create } from 'zustand'
import { toast } from 'sonner'
import { api } from '@/hermes/rest'

type Speech = {
  /** What's being read: a message key, and the agent reading it. */
  key?: string
  profile?: string
  phase?: 'loading' | 'playing'
}

export const useSpeech = create<Speech>(() => ({}))

/** Chunks stay well under every TTS provider's limit. */
const CHUNK = 1200

let audio: HTMLAudioElement | undefined
let run = 0

/** A blip of silence: playing it inside the tap unlocks audio on phones. */
const SILENCE = 'data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA=='

export function stopSpeaking() {
  run++
  if (audio) {
    audio.onended = audio.onerror = audio.onpause = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  useSpeech.setState({ key: undefined, profile: undefined, phase: undefined })
}

/** Call from the tap itself: browsers only allow sound that starts with one. */
export function toggleSpeaking(key: string, text: string, profile: string) {
  if (useSpeech.getState().key === key) return stopSpeaking()
  stopSpeaking()
  audio ??= new Audio()
  audio.src = SILENCE
  audio.play().catch(() => {})
  void speak(key, text, profile)
}

async function speak(key: string, text: string, profile: string) {
  const mine = ++run
  const live = () => run === mine
  useSpeech.setState({ key, profile, phase: 'loading' })
  const player = (audio ??= new Audio())

  const chunks = chunk(text)
  const fetchChunk = (part: string) => {
    const req = api.post<{ data_url?: string }>(`/api/audio/speak?profile=${encodeURIComponent(profile)}`, { text: part })
    req.catch(() => {}) // (a chunk fetched ahead may never be awaited)
    return req
  }

  try {
    let next = fetchChunk(chunks[0])
    for (let i = 0; i < chunks.length; i++) {
      const { data_url } = await next
      if (!live()) return
      if (!data_url) throw new Error('No audio')
      // Fetch ahead while this one plays.
      if (i + 1 < chunks.length) next = fetchChunk(chunks[i + 1])
      player.src = data_url
      await player.play()
      useSpeech.setState({ phase: 'playing' })
      await new Promise<void>((resolve, reject) => {
        player.onended = () => resolve()
        player.onerror = () => reject(new Error('Playback failed'))
        // Paused from outside (headphones, the lock screen): that's a stop.
        player.onpause = () => {
          if (player.ended) return
          stopSpeaking()
          resolve()
        }
      })
      if (!live()) return
    }
    stopSpeaking()
  } catch (e) {
    if (!live()) return
    stopSpeaking()
    toast.error(
      (e as Error).name === 'NotAllowedError'
        ? 'Your browser blocked the sound. Tap Read aloud again.'
        : 'Couldn’t read this aloud. Check the voice settings in Hermes, then try again.',
    )
  }
}

/** Split at paragraph, then sentence, then word boundaries. */
function chunk(text: string) {
  const out: string[] = []
  let current = ''
  const pieces = text
    .split(/\n{2,}/)
    .flatMap((p) => (p.length > CHUNK ? (p.match(/[^.!?…]+[.!?…]*\s*/g) ?? [p]) : [p]))
    .flatMap((p) => (p.length > CHUNK ? (p.match(new RegExp(`.{1,${CHUNK}}(\\s|$)`, 'gs')) ?? [p]) : [p]))
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > CHUNK) {
      out.push(current.trim())
      current = ''
    }
    current += (current ? '\n\n' : '') + piece
  }
  if (current.trim()) out.push(current.trim())
  return out.length ? out : [text]
}
