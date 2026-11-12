// The ear of a call on iOS, where Web Audio can't be used (see ios.ts). A call to itself lets the
// connection's stats say how loud the mic is, ten times a second, which is how it knows it's being
// talked over. Knowing when you've finished takes more than that, because echo cancelling moves the
// level around: on the image's plugin the mic goes to the agent's machine as it's recorded, and
// that says when a turn ends and sends it back (core/hear.py). Without the plugin it takes the same
// turns as Mic from the level, and each finished turn is the recording since the last one.

import { hermesOf, profileOf } from '@/hermes/instance'
import { hermesSocket } from '@/hermes/rest'
import { BARGE_MS, END_SILENCE_MS, MAX_TURN_MS, MIN_SPEECH_MS, type MicEvents, type MicMode } from './mic'

const FRAME_MS = 100
/** While nobody's talking the recording starts over this often, so a turn doesn't carry a long silence. */
const FRESH_MS = 8_000
/** A recording that hasn't said it stopped by now isn't going to. */
const STOP_MS = 1_500
/** How often the recorder hands over what it has (Safari: about once a second, whatever's asked). */
const SLICE_MS = 250
/** How long the agent's machine gets to take the mic before the level has to do. */
const HEAR_WAIT_MS = 2_000
/** No audio for this long and the mic has stopped, whatever its track says. */
const DEAD_MS = 1_500
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }

export const recorderSupported = () => typeof MediaRecorder !== 'undefined' && typeof RTCPeerConnection !== 'undefined'

/** `profile` is the agent's id: the socket goes to its Hermes, under the name it has there. */
const hearUrl = (profile: string) =>
  hermesSocket(`/api/plugins/murmur-voice/hear?${new URLSearchParams({ profile: profileOf(profile) })}`, hermesOf(profile))

export class RecorderMic {
  mode: MicMode = 'off'
  muted = false
  private stream?: MediaStream
  private recorder?: MediaRecorder
  /** The agent's machine, taking the mic and saying when each turn ends. */
  private ear?: WebSocket
  private parts: Blob[] = []
  private since = 0
  private a?: RTCPeerConnection
  private b?: RTCPeerConnection
  private poll?: ReturnType<typeof setInterval>
  private inSpeech = false
  private speechMs = 0
  private silenceMs = 0
  private aboveMs = 0
  private turnMs = 0
  private floor = 0.004
  /** How loud you are this turn: when you've stopped, the room can be well above the floor. */
  private voice = 0
  /** Seconds of audio the mic has delivered, and when that last grew. */
  private delivered = 0
  private deliveredAt = 0
  private reviving = false
  private closed = false

  constructor(
    private events: MicEvents,
    private profile?: string,
  ) {}

  async open() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO })
    // Hung up, or moved to another voice, while it was asking.
    if (this.closed) return stream.getTracks().forEach((t) => t.stop())
    this.stream = stream
    if (!(await this.attach()) && !this.closed) this.record()
    if (this.closed) return
    const a = (this.a = new RTCPeerConnection())
    const b = (this.b = new RTCPeerConnection())
    a.onicecandidate = (e) => void (e.candidate && b.addIceCandidate(e.candidate))
    b.onicecandidate = (e) => void (e.candidate && a.addIceCandidate(e.candidate))
    a.addTrack(this.stream.getAudioTracks()[0], this.stream)
    await a.setLocalDescription(await a.createOffer())
    await b.setRemoteDescription(a.localDescription!)
    await b.setLocalDescription(await b.createAnswer())
    await a.setRemoteDescription(b.localDescription!)
    this.poll = setInterval(() => void this.measure(), FRAME_MS)
  }

  setMode(mode: MicMode) {
    if (mode === this.mode) return
    this.mode = mode
    this.reset()
    this.tell({ mode })
  }

  /** Your turn ends now, whatever it sounded like: on the plugin, the last few seconds if nothing seemed said. */
  finish() {
    if (this.ear) return this.tell({ finish: true })
    const { turnMs } = this
    this.reset()
    void this.roll().then((blob) => this.events.turn(blob, turnMs))
  }

  setMuted(muted: boolean) {
    this.muted = muted
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !muted))
    if (muted) this.reset()
  }

  close() {
    this.closed = true
    this.mode = 'off'
    clearInterval(this.poll)
    this.a?.close()
    this.b?.close()
    const ear = this.ear
    this.ear = undefined
    ear?.close()
    if (this.recorder?.state === 'recording') this.recorder.stop()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = this.recorder = this.a = this.b = undefined
  }

  private tell(command: object) {
    if (this.ear?.readyState === WebSocket.OPEN) this.ear.send(JSON.stringify(command))
  }

  /** One recording, handed over as it's made. */
  private send(ws: WebSocket) {
    const recorder = new MediaRecorder(this.stream!)
    recorder.ondataavailable = (e) => void (e.data.size && ws.readyState === WebSocket.OPEN && ws.send(e.data))
    recorder.start(SLICE_MS)
    this.recorder = recorder
  }

  /** Hands the mic to the agent's machine, if it can take it. */
  private attach() {
    if (!this.profile) return Promise.resolve(false)
    return new Promise<boolean>((taken) => {
      const ws = new WebSocket(hearUrl(this.profile!))
      const late = setTimeout(() => ws.close(), HEAR_WAIT_MS)
      ws.onopen = () => {
        clearTimeout(late)
        this.ear = ws
        this.send(ws)
        taken(true)
      }
      ws.onmessage = (m: MessageEvent<Blob | string>) => {
        if (typeof m.data !== 'string') return this.events.turn(new Blob([m.data], { type: 'audio/wav' }), 0)
        const { type } = JSON.parse(m.data) as { type: string }
        if (type === 'speech') this.events.speechStart()
        if (type === 'nothing') this.events.nothing?.()
      }
      ws.onclose = () => {
        clearTimeout(late)
        taken(false)
        // Lost during the call: the level takes over from here.
        if (this.ear !== ws) return
        this.ear = undefined
        if (this.recorder?.state === 'recording') this.recorder.stop()
        this.reset()
        this.record()
        this.events.nothing?.()
      }
    })
  }

  private reset() {
    this.inSpeech = false
    this.speechMs = this.silenceMs = this.aboveMs = this.turnMs = this.voice = 0
  }

  private record() {
    const recorder = new MediaRecorder(this.stream!)
    const parts: Blob[] = []
    recorder.ondataavailable = (e) => void (e.data.size && parts.push(e.data))
    recorder.start()
    this.recorder = recorder
    this.parts = parts
    this.since = performance.now()
  }

  /** Ends this recording and starts the next one first, so nothing falls between them. */
  private roll() {
    const done = this.recorder!
    const parts = this.parts
    this.record()
    return new Promise<Blob>((resolve) => {
      const hand = () => {
        clearTimeout(late)
        resolve(new Blob(parts, { type: done.mimeType }))
      }
      const late = setTimeout(hand, STOP_MS)
      done.onstop = hand
      if (done.state === 'inactive') hand()
      else done.stop()
    })
  }

  private async measure() {
    const stats = await this.a?.getStats().catch(() => undefined)
    for (const report of stats?.values() ?? []) {
      if (report.type !== 'media-source' || report.kind !== 'audio') continue
      this.watch(report.totalSamplesDuration)
      return this.judge(Number(report.audioLevel ?? 0))
    }
  }

  /** iOS can stop the mic and leave its track saying it's live: the audio arriving is what counts. */
  private watch(seconds: number | undefined) {
    if (seconds === undefined) return
    const now = performance.now()
    if (seconds > this.delivered) {
      this.delivered = seconds
      this.deliveredAt = now
    } else if (this.deliveredAt && now - this.deliveredAt > DEAD_MS) void this.revive()
  }

  /** A new mic in the old one's place, and a new recording from it. */
  private async revive() {
    if (this.reviving || !this.stream) return
    this.reviving = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO })
      const old = this.stream
      if (!old) return stream.getTracks().forEach((t) => t.stop())
      this.stream = stream
      await this.a?.getSenders()[0]?.replaceTrack(stream.getAudioTracks()[0])
      if (this.recorder) {
        this.recorder.ondataavailable = null
        if (this.recorder.state === 'recording') this.recorder.stop()
      }
      old.getTracks().forEach((t) => t.stop())
      this.delivered = 0
      this.deliveredAt = performance.now()
      if (this.ear) {
        this.tell({ restart: true })
        this.send(this.ear)
      } else this.record()
    } catch {
      this.events.deaf?.()
    } finally {
      this.reviving = false
    }
  }

  /** How loud the mic is now: the same turn-taking as Mic, in longer steps. */
  judge(level: number) {
    this.events.level(this.muted ? 0 : Math.min(1, level * 3))
    if (!this.recorder) return
    const barge = this.mode === 'barge'
    const threshold = Math.max(this.floor * (barge ? 5 : 3), barge ? 0.035 : 0.012, this.voice / 4)
    const loud = level > threshold
    // Never once someone may be starting to talk: their first words stay in the one recording.
    if (!this.ear && !this.inSpeech && !loud && !this.aboveMs && performance.now() - this.since > FRESH_MS) void this.roll()
    if (this.mode === 'off' || this.muted) return

    // Learn the room only while it's quiet, and not from the agent talking: echo cancelling all
    // but silences the mic then, and everyone's room would seem silent when it stops.
    if (!loud && !this.inSpeech && !barge) this.floor = this.floor * 0.97 + level * 0.03

    if (barge) {
      this.aboveMs = loud ? this.aboveMs + FRAME_MS : Math.max(0, this.aboveMs - FRAME_MS * 2)
      if (this.aboveMs < BARGE_MS) return
      this.aboveMs = 0
      this.mode = 'listen'
      if (this.ear) {
        this.tell({ interrupted: true })
        return this.events.barge()
      }
      // What was said over the agent is the start of the next turn.
      this.inSpeech = true
      this.speechMs = BARGE_MS
      this.silenceMs = this.turnMs = 0
      this.voice = level
      return this.events.barge()
    }
    if (this.ear) return

    if (!this.inSpeech) {
      if (!loud) return
      this.inSpeech = true
      this.speechMs = FRAME_MS
      this.silenceMs = this.turnMs = 0
      this.voice = level
      return this.events.speechStart()
    }
    this.turnMs += FRAME_MS
    if (loud) {
      this.speechMs += FRAME_MS
      this.silenceMs = 0
    } else this.silenceMs += FRAME_MS
    // It falls slowly, so a loud room can't talk it down to its own level.
    this.voice = Math.max(level, this.voice * 0.98)
    if (this.silenceMs < END_SILENCE_MS && this.turnMs < MAX_TURN_MS) return
    const { speechMs, turnMs } = this
    this.reset()
    void this.roll().then((blob) => {
      if (speechMs >= MIN_SPEECH_MS) this.events.turn(blob, turnMs)
    })
  }
}
