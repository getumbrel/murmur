// The mouth of a call on iOS, where Web Audio can't be used (see ios.ts). Each sentence comes from
// the image's plugin as MP4 fragments while the model makes it, and one audio element plays them all
// through Managed Media Source, which starts as soon as a fraction of a second is in. Sentences
// follow each other on one timeline, so nothing is heard between them.

import { hermesHeaders } from '@/hermes/rest'
import { hermesOf, profileOf } from '@/hermes/instance'
import { SILENCE, speakError, type Spoken } from './voice'

const TYPE = 'audio/mp4; codecs="mp4a.40.2"'
/** Seconds in hand before it starts. */
const START = 0.15
/** A sentence is done this close to its end: players can stall just short of what they've been given. */
const END_SLACK = 0.12
/** How much is left to run out when it's talked over. */
const LAST_BIT = 0.05

type Item = {
  id: number
  text: string
  chunks: Uint8Array[]
  /** All of it has arrived. */
  ended: boolean
  /** On the element's timeline, once they're known. */
  startAt?: number
  endAt?: number
  started: boolean
  stop: AbortController
}

const Source = () =>
  (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource

export const piecesSupported = () => !!Source()?.isTypeSupported(TYPE)

export class PieceVoice {
  private el = new Audio()
  private source?: MediaSource
  private buffer?: SourceBuffer
  private items: Item[] = []
  private next = 0
  private run = 0
  private clock?: ReturnType<typeof setInterval>
  current?: Spoken
  onStart?: (s: Spoken) => void
  onIdle?: () => void
  onError?: (message: string) => void

  constructor(private profile: string) {
    // Managed Media Source won't run otherwise.
    this.el.disableRemotePlayback = true
  }

  /** Call from the tap itself. */
  unlock() {
    this.el.src = SILENCE
    this.el.play().catch(() => {})
  }

  get busy() {
    return this.items.length > 0
  }

  /** Seconds into the sentence being heard. */
  get position() {
    const item = this.items.find((i) => i.started)
    return item?.startAt != null ? Math.max(0, this.el.currentTime - item.startAt) : 0
  }

  say(text: string) {
    const item: Item = { id: ++this.next, text, chunks: [], ended: false, started: false, stop: new AbortController() }
    this.items.push(item)
    if (!this.source) this.open()
    void this.fetch(item, this.run)
  }

  /**
   * Talked over: it stops at once, and what's in hand goes. Never by pausing or letting go of the
   * element, or muting it: on an iPhone, the moment nothing audible is playing iOS shuts the audio
   * session down, and the mic goes with it for the rest of the call. Running out of audio is
   * safe, the way every reply ends, so it skips to the end of what it has.
   */
  stop() {
    this.run++
    for (const item of this.items) item.stop.abort()
    this.items = []
    this.current = undefined
    const buffer = this.buffer
    if (!buffer) return
    try {
      buffer.abort() // a sentence may be part of the way in
      buffer.timestampOffset = this.edge // and that forgets where the timeline had got to
    } catch {
      /* it's been closed */
    }
    const end = this.edge - LAST_BIT
    if (end > this.el.currentTime) this.el.currentTime = end
  }

  /** The call's over. */
  close() {
    this.stop()
    clearInterval(this.clock)
    this.clock = undefined
    this.el.pause()
    this.el.srcObject = null
    this.el.removeAttribute('src')
    this.source = this.buffer = undefined
  }

  private open() {
    const source = new (Source()!)()
    this.source = source
    source.addEventListener(
      'sourceopen',
      () => {
        const buffer = source.addSourceBuffer(TYPE)
        // Each sentence's timestamps start from nothing: this lays them end to end.
        buffer.mode = 'sequence'
        buffer.addEventListener('updateend', () => this.pump())
        this.buffer = buffer
        this.pump()
      },
      { once: true },
    )
    this.el.srcObject = source as unknown as MediaProvider
    this.clock = setInterval(() => this.tick(), 50)
  }

  private async fetch(item: Item, mine: number) {
    try {
      const res = await fetch(`/hermes/api/plugins/murmur-voice/say?profile=${encodeURIComponent(profileOf(this.profile))}`, {
        method: 'POST',
        headers: hermesHeaders({ 'Content-Type': 'application/json' }, hermesOf(this.profile)),
        body: JSON.stringify({ text: item.text }),
        signal: item.stop.signal,
      })
      if (!res.ok || !res.body) throw new Error(`speech failed: ${res.status}`)
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (mine !== this.run) return
        if (done) break
        item.chunks.push(value)
        this.pump()
      }
    } catch (e) {
      if (mine !== this.run) return
      this.onError?.(speakError(e instanceof Error ? e.message : ''))
    }
    item.ended = true
    this.pump()
  }

  private get edge() {
    const { buffered } = this.buffer!
    return buffered.length ? buffered.end(buffered.length - 1) : 0
  }

  /** The next piece onto the timeline, in order: a sentence goes on once the one before is all on. */
  private pump() {
    const buffer = this.buffer
    if (!buffer || buffer.updating) return
    // (Paused, not "not started": Safari pauses it by itself when it reaches the end of a reply.)
    if (this.el.paused && this.edge - this.el.currentTime >= START) this.el.play().catch(() => {})
    for (const item of this.items) {
      if (item.endAt != null) continue
      const chunk = item.chunks.shift()
      if (chunk) {
        item.startAt ??= this.edge
        return buffer.appendBuffer(chunk as Uint8Array<ArrayBuffer>)
      }
      if (!item.ended) return
      item.endAt = this.edge
    }
    // A short last sentence may never have reached the start line.
    if (this.el.paused && this.edge > this.el.currentTime && this.items.every((i) => i.ended)) {
      this.el.play().catch(() => {})
    }
  }

  /** Which sentence the element has reached. */
  private tick() {
    const item = this.items[0]
    if (!item) return
    const now = this.el.currentTime
    // Nothing came at all (it failed): there's nothing to wait for.
    if (item.endAt != null && item.startAt == null) {
      this.items.shift()
      return this.settle()
    }
    if (!item.started && !this.el.paused && item.startAt != null && now >= item.startAt) {
      item.started = true
      this.current = { id: item.id, text: item.text, startedAt: performance.now(), duration: item.text.length / 14 }
      this.onStart?.(this.current)
    }
    if (!item.started || item.endAt == null) return
    // Now its length is known, the captions can use the real one.
    const real = item.endAt - item.startAt!
    if (this.current?.id === item.id && Math.abs(real - this.current.duration) > 0.05) {
      this.current = { ...this.current, duration: real }
      this.onStart?.(this.current)
    }
    if (now < item.endAt - END_SLACK) return
    this.items.shift()
    this.settle()
  }

  private settle() {
    if (this.items.length) return
    this.current = undefined
    this.onIdle?.()
  }
}
