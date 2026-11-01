// The call's few sounds: a pulse while it connects, a chime when it picks up
// and when it ends, a knock when it needs you, a tick as something lands on the
// stage. From UI SFX's Minimal pack (uisfx.com, CC0), at its own volumes.

import blockedUrl from './sounds/blocked.mp3?url'
import connectUrl from './sounds/connect.mp3?url'
import disconnectUrl from './sounds/disconnect.mp3?url'
import infoUrl from './sounds/info.mp3?url'
import recordingUrl from './sounds/recording.mp3?url'

const SOUNDS = {
  connect: { url: connectUrl, volume: 0.2 },
  disconnect: { url: disconnectUrl, volume: 0.19 },
  blocked: { url: blockedUrl, volume: 0.2 },
  info: { url: infoUrl, volume: 0.16 },
  recording: { url: recordingUrl, volume: 0.09 },
}
type Sound = keyof typeof SOUNDS

let ctx: AudioContext | undefined
const buffers = new Map<Sound, Promise<AudioBuffer | undefined>>()

function buffer(sound: Sound) {
  let got = buffers.get(sound)
  if (!got) {
    got = fetch(SOUNDS[sound].url)
      .then((r) => r.arrayBuffer())
      .then((data) => ctx!.decodeAudioData(data))
      .catch(() => undefined)
    buffers.set(sound, got)
  }
  return got
}

/** Call it inside the tap that starts the call: phones only play sound a tap starts. */
export function unlockSounds() {
  void audioContext()
  for (const sound of Object.keys(SOUNDS) as Sound[]) void buffer(sound)
}

/** The one AudioContext a call plays through (its sounds, and a voice that streams). Inside a tap, the first time. */
export function audioContext() {
  ctx ??= new AudioContext({ latencyHint: 'interactive' })
  void ctx.resume().catch(() => {})
  return ctx
}

/**
 * On iOS, for the rest of a call with no Web Audio of its own (see ios.ts): the sounds' AudioContext
 * goes, and with it the sounds, because iOS ignores an audio element's volume. The next tap brings it back.
 */
export function closeSounds() {
  const closing = ctx
  ctx = undefined
  buffers.clear()
  void closing?.close().catch(() => {})
}

function start(sound: Sound, loop: boolean) {
  if (!ctx) return undefined
  const gain = ctx.createGain()
  gain.gain.value = SOUNDS[sound].volume
  gain.connect(ctx.destination)
  let source: AudioBufferSourceNode | undefined
  let stopped = false
  void buffer(sound).then((b) => {
    if (!b || stopped || !ctx) return
    source = ctx.createBufferSource()
    source.buffer = b
    source.loop = loop
    source.connect(gain)
    source.start()
  })
  return () => {
    stopped = true
    if (!ctx || !source) return
    // A loop fades rather than cutting off mid-pulse.
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05)
    source.stop(ctx.currentTime + 0.3)
  }
}

export function playSound(sound: Exclude<Sound, 'recording'>) {
  start(sound, false)
}

/** The pulse while it connects; the returned function fades it out. */
export function loopSound(sound: 'recording') {
  return start(sound, true) ?? (() => {})
}
