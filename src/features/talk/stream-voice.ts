// The mouth of a call on a voice that streams (the Umbrel's own, through the image's murmur-voice
// plugin). Each sentence goes to Hermes's speak-stream socket, which sends raw PCM as the model
// makes it, so the agent starts talking a fraction of a second after a sentence is written
// instead of once all of it has been made. Sentences play back to back on one AudioContext,
// unlocked by the tap that started the call. A sentence that can't be streamed is fetched whole,
// the way Voice does it.
//
// The audio is resampled here, as one signal (see resample.ts), and scheduled to the exact sample
// on the context's clock, so the chunks it came in can't be heard. A small cushion is held back
// before it starts, and grows if the model ever falls behind.
//
//   → {text, done: true}            one sentence per socket
//   ← {type: "start", sample_rate}  with its first audio
//   ← binary: 16-bit mono PCM
//   ← {type: "end"} | {type: "fallback"} (no audio: fetch it whole)

import { api } from '@/hermes/rest'
import { hermesOf, profileOf } from '@/hermes/instance'
import { hermesSocket } from '@/hermes/rest'
import { speakError, type Spoken } from './voice'
import { Resampler } from './resample'
import { audioContext } from './sounds'

/** Seconds of speech in hand before it starts, so a slow moment in the model doesn't leave a hole. */
const CUSHION = 0.24
/** What running dry adds to the cushion, up to the most it'll ever hold back. */
const MORE = 0.12
const MOST = 0.72
/** A hole that couldn't be avoided is faded into and out of, or it clicks. */
const FADE = 0.006

type Item = {
  id: number
  text: string
  socket?: WebSocket
  rate: number
  chunks: Float32Array[]
  /** At the context's rate, not played yet. */
  ready: Float32Array[]
  resampler?: Resampler
  /** All of it has arrived. */
  ended: boolean
  failed: boolean
  /** On the AudioContext's clock, once it's scheduled. */
  startAt?: number
  endAt?: number
  sources: AudioBufferSourceNode[]
  started: boolean
}

/** `profile` is the agent's id: the socket goes to its Hermes, under the name it has there. */
const socketUrl = (profile: string) =>
  hermesSocket(`/api/audio/speak-stream?${new URLSearchParams({ profile: profileOf(profile) })}`, hermesOf(profile))

export class StreamVoice {
  private ctx?: AudioContext
  private out?: GainNode
  private items: Item[] = []
  private next = 0
  private run = 0
  /** The sample on the context's clock where the next piece of audio goes. */
  private frame = 0
  private cushion = CUSHION
  private dry = false
  private timers = new Set<ReturnType<typeof setTimeout>>()
  current?: Spoken
  onStart?: (s: Spoken) => void
  onIdle?: () => void
  onError?: (message: string) => void

  constructor(private profile: string) {}

  /** Call from the tap itself. It plays on the call's own AudioContext (the one its sounds use). */
  unlock() {
    this.ctx = audioContext()
    if (this.out) return
    this.out = this.ctx.createGain()
    this.out.connect(this.ctx.destination)
  }

  get busy() {
    return this.items.length > 0
  }

  /** Seconds into the sentence being heard. */
  get position() {
    const item = this.items.find((i) => i.started)
    return item?.startAt != null && this.ctx ? Math.max(0, this.ctx.currentTime - item.startAt) : 0
  }

  say(text: string) {
    if (!this.ctx) this.unlock()
    const item: Item = { id: ++this.next, text, rate: 24000, chunks: [], ready: [], ended: false, failed: false, sources: [], started: false }
    this.items.push(item)
    this.open(item, this.run)
  }

  stop() {
    this.run++
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    // Cut off mid-word, it fades rather than clicks.
    const now = this.ctx?.currentTime ?? 0
    this.out?.gain.cancelScheduledValues(now)
    this.out?.gain.setTargetAtTime(0, now, FADE / 3)
    for (const item of this.items) {
      item.socket?.close()
      for (const s of item.sources) {
        try {
          s.stop(now + FADE * 2)
        } catch {
          /* not started yet */
        }
      }
    }
    this.items = []
    this.current = undefined
    this.frame = 0
  }

  private open(item: Item, mine: number) {
    let socket: WebSocket
    try {
      socket = new WebSocket(socketUrl(this.profile))
    } catch {
      return void this.whole(item, mine)
    }
    socket.binaryType = 'arraybuffer'
    item.socket = socket
    let heard = false
    socket.onopen = () => socket.send(JSON.stringify({ text: item.text, done: true }))
    socket.onmessage = (m) => {
      if (mine !== this.run) return
      if (typeof m.data !== 'string') {
        heard = true
        const pcm = new Int16Array(m.data as ArrayBuffer)
        const samples = new Float32Array(pcm.length)
        for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768
        item.chunks.push(samples)
        return this.pump(mine)
      }
      let event: { type?: string; sample_rate?: number }
      try {
        event = JSON.parse(m.data)
      } catch {
        return
      }
      if (event.type === 'start' && event.sample_rate) item.rate = event.sample_rate
      if (event.type === 'fallback') return void this.whole(item, mine)
      if (event.type === 'end') {
        item.ended = true
        socket.close()
        this.pump(mine)
      }
    }
    socket.onclose = () => {
      if (mine !== this.run || item.ended) return
      // It went away before the end: what came is kept, the rest is fetched whole if nothing came.
      if (heard) {
        item.ended = true
        this.pump(mine)
      } else void this.whole(item, mine)
    }
  }

  /** The sentence as one clip, from the same voice. */
  private async whole(item: Item, mine: number) {
    item.socket = undefined
    try {
      const res = await api.post<{ data_url?: string }>(`/api/audio/speak?profile=${encodeURIComponent(this.profile)}`, { text: item.text })
      if (mine !== this.run || !this.ctx || !res.data_url) throw new Error('No audio')
      const bytes = await (await fetch(res.data_url)).arrayBuffer()
      const buffer = await this.ctx.decodeAudioData(bytes)
      item.rate = buffer.sampleRate
      item.chunks.push(buffer.getChannelData(0).slice())
    } catch (e) {
      if (mine !== this.run) return
      item.failed = true
      this.onError?.(speakError(e instanceof Error ? e.message : ''))
    }
    item.ended = true
    this.pump(mine)
  }

  /**
   * Schedule what's arrived, in order: a sentence starts once the one before it is all here and
   * there's enough of it not to run dry, and plays its pieces back to back.
   */
  private pump(mine: number) {
    const ctx = this.ctx
    if (!ctx || mine !== this.run) return
    for (const item of [...this.items]) {
      this.convert(item, ctx.sampleRate)
      const held = item.ready.reduce((n, r) => n + r.length, 0)
      if (held) {
        const ahead = Math.max(0, this.frame / ctx.sampleRate - ctx.currentTime)
        // It ran dry partway through: a longer cushion from here on.
        if (!ahead && item.startAt != null && !item.ended && !this.dry) {
          this.dry = true
          this.cushion = Math.min(MOST, this.cushion + MORE)
        }
        // (Only before it starts: with speech playing, whatever arrives goes straight on the end.)
        if (!item.ended && !ahead && held / ctx.sampleRate < this.cushion) return
        this.dry = false
        this.play(item, ctx, held, ahead > 0, mine)
      }
      // The next sentence waits until this one has all arrived, so they never interleave.
      if (!item.ended) return
      // Nothing came at all (it failed): there's nothing to play.
      if (item.startAt == null) this.items = this.items.filter((i) => i !== item)
    }
    if (!this.items.length) this.idle(mine)
  }

  /** What's arrived, at the context's rate. The last of it comes once all of it has arrived. */
  private convert(item: Item, rate: number) {
    if (item.rate !== rate) item.resampler ??= new Resampler(item.rate, rate)
    for (const chunk of item.chunks.splice(0)) item.ready.push(item.resampler ? item.resampler.push(chunk).slice() : chunk)
    if (!item.ended || !item.resampler) return
    item.ready.push(item.resampler.flush().slice())
    item.resampler = undefined
    item.rate = rate
  }

  private play(item: Item, ctx: AudioContext, length: number, joined: boolean, mine: number) {
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    let filled = 0
    for (const piece of item.ready.splice(0)) {
      buffer.copyToChannel(piece as Float32Array<ArrayBuffer>, 0, filled)
      filled += piece.length
    }
    if (!joined) this.frame = Math.ceil((ctx.currentTime + 0.02) * ctx.sampleRate)
    const at = this.frame / ctx.sampleRate
    this.frame += length
    const end = this.frame / ctx.sampleRate
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.out!)
    source.start(at)
    item.sources.push(source)
    // Silent either side unless the next piece turns up and takes the fade away.
    const gain = this.out!.gain
    gain.cancelScheduledValues(at)
    if (!joined) {
      gain.setValueAtTime(0, at)
      gain.linearRampToValueAtTime(1, at + FADE)
    }
    gain.setValueAtTime(1, Math.max(at + FADE, end - FADE))
    gain.linearRampToValueAtTime(0, end)
    if (item.startAt == null) {
      item.startAt = at
      this.later(at, () => this.begin(item, mine))
    }
    item.endAt = end
  }

  private begin(item: Item, mine: number) {
    if (mine !== this.run) return
    item.started = true
    // Its length is known once it has all arrived; till then, from its words.
    const length = () => (item.ended && item.endAt != null && item.startAt != null ? item.endAt - item.startAt : undefined)
    this.current = { id: item.id, text: item.text, startedAt: performance.now(), duration: length() ?? item.text.length / 14 }
    this.onStart?.(this.current)
    const retime = () => {
      if (mine !== this.run || this.current?.id !== item.id) return
      const real = length()
      if (real == null) return this.later((this.ctx?.currentTime ?? 0) + 0.1, retime)
      if (Math.abs(real - this.current.duration) > 0.05) {
        this.current = { ...this.current, duration: real }
        this.onStart?.(this.current)
      }
    }
    if (length() == null) retime()
    this.later(item.endAt ?? 0, () => this.done(item, mine))
  }

  private done(item: Item, mine: number) {
    if (mine !== this.run) return
    // Not over yet: more of it has arrived since.
    const now = this.ctx?.currentTime ?? 0
    if (!item.ended || (item.endAt ?? 0) > now + 0.02) return this.later(Math.max(item.endAt ?? 0, now + 0.1), () => this.done(item, mine))
    this.items = this.items.filter((i) => i !== item)
    if (!this.items.length) this.idle(mine)
  }

  private idle(mine: number) {
    if (mine !== this.run) return
    this.current = undefined
    this.frame = 0
    this.onIdle?.()
  }

  private later(at: number, fn: () => void) {
    const wait = Math.max(0, (at - (this.ctx?.currentTime ?? 0)) * 1000)
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, wait)
    this.timers.add(t)
  }
}
