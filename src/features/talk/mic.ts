// The ear of a call. One microphone stream for the whole call, read as raw
// samples so a turn can be cut exactly where speech starts and stops (with a
// little lead-in, so the first syllable isn't clipped), then handed to Hermes
// as a small 16 kHz WAV. Nothing leaves the browser except finished turns.
//
// Turn-taking is a level detector that learns the room: it tracks the noise
// floor while nobody is talking and calls it speech when the level stays well
// above it. While the agent speaks, it listens harder before calling it an
// interruption, so the agent's own voice (mostly removed by echo
// cancellation) doesn't cut it off.

const RATE = 16_000
/** How often the level is judged. */
const FRAME_MS = 20
/** Kept before speech starts, so the first word is whole. */
const LEAD_MS = 400
/** A pause this long ends your turn. */
export const END_SILENCE_MS = 750
/** Shorter than this is a cough or a click, not a turn. */
export const MIN_SPEECH_MS = 280
/** Long enough for a thought; past this the turn is sent anyway. */
export const MAX_TURN_MS = 60_000
/** Speech over the agent this long is an interruption. */
export const BARGE_MS = 320

export type MicMode = 'listen' | 'barge' | 'off'

export type MicEvents = {
  /** 0–1, about 50 times a second. */
  level: (level: number) => void
  speechStart: () => void
  /** A finished turn, ready to transcribe. */
  turn: (wav: Blob, ms: number) => void
  /** You started talking over the agent. */
  barge: () => void
  /** What sounded like speech wasn't, and nothing's coming. */
  nothing?: () => void
  /** The mic stopped, and can't be got back. */
  deaf?: () => void
}

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('murmur-tap', Tap)
`

export class Mic {
  mode: MicMode = 'off'
  muted = false
  private stream?: MediaStream
  private ctx?: AudioContext
  private node?: AudioWorkletNode
  private events: MicEvents
  /** Resampled 16 kHz samples not yet judged. */
  private pending: number[] = []
  /** The last LEAD_MS of audio, for the lead-in. */
  private lead: Float32Array[] = []
  private turnFrames: Float32Array[] = []
  private inSpeech = false
  private speechMs = 0
  private silenceMs = 0
  private aboveMs = 0
  private floor = 0.004
  private ratio = 3
  private stepper = 0
  private acc = 0
  private accN = 0

  /** Make it inside the tap that starts the call: phones only start audio a tap starts. */
  constructor(events: MicEvents) {
    this.events = events
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctx()
    void this.ctx.resume().catch(() => {})
  }

  async open() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    })
    // Hung up, or moved to another voice, while it was asking.
    if (!this.ctx) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('closed')
    }
    this.stream = stream
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {})
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await this.ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'murmur-tap')
    this.ratio = this.ctx.sampleRate / RATE
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.feed(e.data)
    source.connect(this.node)
    // (Not connected onward: nothing is played back.)
  }

  setMode(mode: MicMode) {
    if (mode === this.mode) return
    this.mode = mode
    this.reset()
  }

  setMuted(muted: boolean) {
    this.muted = muted
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !muted))
    if (muted) this.reset()
  }

  close() {
    this.mode = 'off'
    this.node?.port.close()
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close().catch(() => {})
    this.stream = this.ctx = this.node = undefined
  }

  /** Your turn ends now, whatever the level says. */
  finish() {
    if (!this.inSpeech) return
    const frames = this.turnFrames
    this.reset()
    this.events.turn(wav(frames), frames.length * FRAME_MS)
  }

  private reset() {
    this.turnFrames = []
    this.inSpeech = false
    this.speechMs = this.silenceMs = this.aboveMs = 0
  }

  /** Resample whatever the hardware rate is down to 16 kHz (a plain decimating average). */
  private feed(block: Float32Array) {
    const r = this.ratio
    for (let i = 0; i < block.length; i++) {
      this.stepper += 1
      this.acc += block[i]
      this.accN++
      if (this.stepper >= r) {
        this.stepper -= r
        this.pending.push(this.acc / this.accN)
        this.acc = 0
        this.accN = 0
      }
    }
    const size = (RATE * FRAME_MS) / 1000
    while (this.pending.length >= size) this.frame(Float32Array.from(this.pending.splice(0, size)))
  }

  private frame(f: Float32Array) {
    let sum = 0
    for (const v of f) sum += v * v
    const rms = Math.sqrt(sum / f.length)
    // Speech sits around 0.02–0.2 RMS; lift it so a normal voice fills the meter.
    this.events.level(this.muted ? 0 : Math.min(1, rms * 6))
    this.lead.push(f)
    if (this.lead.length > LEAD_MS / FRAME_MS) this.lead.shift()
    if (this.mode === 'off' || this.muted) return

    const barge = this.mode === 'barge'
    const threshold = Math.max(this.floor * (barge ? 5 : 3), barge ? 0.035 : 0.012)
    const loud = rms > threshold
    // Learn the room only while it's quiet.
    if (!loud && !this.inSpeech) this.floor = this.floor * 0.97 + rms * 0.03

    if (barge) {
      this.aboveMs = loud ? this.aboveMs + FRAME_MS : Math.max(0, this.aboveMs - FRAME_MS * 2)
      if (this.aboveMs >= BARGE_MS) {
        this.aboveMs = 0
        // What was said over the agent is the start of the next turn.
        this.turnFrames = [...this.lead]
        this.inSpeech = true
        this.speechMs = BARGE_MS
        this.silenceMs = 0
        this.mode = 'listen'
        this.events.barge()
      }
      return
    }

    if (!this.inSpeech) {
      if (loud) {
        this.inSpeech = true
        this.turnFrames = [...this.lead]
        this.speechMs = FRAME_MS
        this.silenceMs = 0
        this.events.speechStart()
      }
      return
    }
    this.turnFrames.push(f)
    if (loud) {
      this.speechMs += FRAME_MS
      this.silenceMs = 0
    } else this.silenceMs += FRAME_MS
    const total = this.turnFrames.length * FRAME_MS
    if (this.silenceMs >= END_SILENCE_MS || total >= MAX_TURN_MS) {
      const frames = this.turnFrames
      const spoke = this.speechMs
      this.reset()
      if (spoke >= MIN_SPEECH_MS) this.events.turn(wav(frames), total)
    }
  }
}

export const micSupported = () =>
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  typeof AudioWorkletNode !== 'undefined'

/** 16-bit mono PCM WAV. */
function wav(frames: Float32Array[]) {
  const n = frames.reduce((s, f) => s + f.length, 0)
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, RATE, true)
  v.setUint32(28, RATE * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, n * 2, true)
  let o = 44
  for (const f of frames)
    for (const s of f) {
      const x = Math.max(-1, Math.min(1, s))
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true)
      o += 2
    }
  return new Blob([buf], { type: 'audio/wav' })
}

export function micError(e: unknown) {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Murmur can’t use the microphone. Allow it for this site in your browser’s settings, then try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found. Plug one in, then try again.'
  if (name === 'NotReadableError') return 'Another app is using the microphone. Close it, then try again.'
  return 'Couldn’t start the microphone. Try again.'
}
