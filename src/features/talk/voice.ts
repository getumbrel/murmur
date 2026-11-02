// The mouth of a call. A reply is spoken a sentence at a time as it streams
// in: each sentence goes to Hermes (the agent's own voice settings) while the
// one before it plays, so speech starts as soon as the first sentence is
// written and never waits on the rest. One audio element for the whole call,
// unlocked by the tap that started it, so phones let it play.

import { isIOS } from './ios'
import { api } from '@/hermes/rest'
import { withoutHangup } from '@shared/message.ts'

/** A blip of silence: playing it inside the tap unlocks audio on phones. */
export const SILENCE = 'data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA=='

export type Spoken = { id: number; text: string; startedAt: number; duration: number }

type Item = { id: number; text: string; audio: Promise<string | undefined> }

/** A sentence cut where a voice can breathe, so the first of it starts sooner. */
export const clauses = (text: string) => text.match(/[^,;:，、；：]+[,;:，、；：]*/g)?.map((c) => c.trim()).filter(Boolean) ?? [text]

export class Voice {
  private el: HTMLAudioElement
  private queue: Item[] = []
  private playing?: Item
  private next = 0
  private run = 0
  /** The sentence being heard right now, for the captions. */
  current?: Spoken
  onStart?: (s: Spoken) => void
  onIdle?: () => void
  onError?: (message: string) => void

  /** `piecemeal`: says a sentence a clause at a time, each as its own clip. */
  constructor(
    private profile: string,
    private piecemeal = false,
  ) {
    this.el = new Audio()
    this.el.preload = 'auto'
  }

  /** Call from the tap itself. */
  unlock() {
    this.el.src = SILENCE
    this.el.play().catch(() => {})
  }

  get busy() {
    return !!this.playing || this.queue.length > 0
  }

  /** Seconds into the sentence being heard. */
  get position() {
    return this.el.currentTime
  }

  say(text: string) {
    for (const part of this.piecemeal ? clauses(text) : [text]) {
      this.queue.push({ id: ++this.next, text: part, audio: this.synth(part) })
    }
    if (!this.playing) void this.pump()
  }

  stop() {
    this.run++
    this.queue = []
    this.playing = undefined
    this.current = undefined
    this.el.onended = this.el.onerror = null
    // On an iPhone, pausing or letting go of what's playing stops the mic (see piece-voice.ts).
    if (isIOS()) {
      if (Number.isFinite(this.el.duration)) this.el.currentTime = this.el.duration
      return
    }
    this.el.pause()
    this.el.removeAttribute('src')
    this.el.load()
  }

  private synth(text: string) {
    const req = api
      .post<{ data_url?: string }>(`/api/audio/speak?profile=${encodeURIComponent(this.profile)}`, { text })
      .then((r) => r.data_url)
    req.catch(() => {}) // (one fetched ahead may never be awaited)
    return req.catch((e: unknown) => {
      this.onError?.(speakError(e instanceof Error ? e.message : ''))
      return undefined
    })
  }

  private async pump() {
    const mine = this.run
    while (this.queue.length) {
      const item = this.queue.shift()!
      this.playing = item
      const url = await item.audio
      if (mine !== this.run) return
      if (!url) continue
      this.el.src = url
      try {
        await this.el.play()
      } catch {
        continue
      }
      if (mine !== this.run) return
      const duration = Number.isFinite(this.el.duration) && this.el.duration > 0 ? this.el.duration : item.text.length / 14
      this.current = { id: item.id, text: item.text, startedAt: performance.now(), duration }
      this.onStart?.(this.current)
      await new Promise<void>((resolve) => {
        this.el.onended = this.el.onerror = () => resolve()
      })
      if (mine !== this.run) return
    }
    this.playing = undefined
    this.current = undefined
    this.onIdle?.()
  }
}

export function speakError(raw: string) {
  if (/not installed|no tts|provider|api[ _]key|configured to use|403/i.test(raw)) return 'This agent’s voice isn’t set up on Hermes yet.'
  return 'Couldn’t say that out loud. The words are in the chat.'
}

// ── Turning a reply into things to say ──────────────────────────────────────

/** What a reply sounds like: no files, widgets, code, tables, links or markdown marks. */
export function speakable(text: string) {
  return (
    withoutHangup(text)
      // Fenced code: said as nothing (it's on screen).
      .replace(/```[\s\S]*?(```|$)/g, ' ')
      .replace(/^\s*(MEDIA:\S+|::preview\{[^}]*\}).*$/gm, ' ')
      .replace(/^\s*\|.*\|\s*$/gm, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, 'the link')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, '')
      .replace(/(\*\*|__|~~|\*|_)(?=\S)([^*_~]+?)\1/g, '$2')
      .replace(/[ \t]+/g, ' ')
  )
}

/**
 * Cuts finished sentences off the front of a reply as it streams. `take(text)`
 * returns the new sentences since the last call; `rest()` the tail at the end.
 */
export class Sentences {
  private said = 0
  take(text: string, done = false): string[] {
    const clean = speakable(text)
    const out: string[] = []
    let from = this.said
    // A sentence ends at punctuation followed by a space (so "18.5" doesn't), or a line break.
    const end = /[.!?…]+["')\]]*(?=\s)|\n+/g
    end.lastIndex = from
    for (let m = end.exec(clean); m; m = end.exec(clean)) {
      const s = clean.slice(from, m.index + m[0].length).trim()
      from = m.index + m[0].length
      if (s.replace(/[^\p{L}\p{N}]/gu, '').length) out.push(s)
    }
    if (done) {
      const tail = clean.slice(from).trim()
      if (tail.replace(/[^\p{L}\p{N}]/gu, '').length) out.push(tail)
      from = clean.length
    }
    this.said = from
    return merge(out)
  }
}

/** Joins fragments under a few words onto their neighbour, so the voice doesn't stutter. */
function merge(parts: string[]) {
  const out: string[] = []
  for (const p of parts) {
    const last = out.at(-1)
    if (last && last.split(/\s+/).length < 3) out[out.length - 1] = `${last} ${p}`
    else out.push(p)
  }
  return out
}
