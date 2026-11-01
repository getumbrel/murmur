// Speech arrives at the model's rate (16 or 24 kHz) and the AudioContext runs at the device's (44.1
// or 48 kHz). Web Audio resamples each AudioBufferSourceNode by itself with plain linear
// interpolation, which adds hiss and clicks wherever two nodes meet, so a stream is resampled here
// instead: one band-limited filter that carries on across chunks, as if they'd come as one signal.

const TAPS = 32
/** Just under the input's Nyquist, so nothing folds back or images. */
const CUTOFF = 0.94

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

/** I₀, for the Kaiser window. */
function bessel(x: number) {
  let sum = 1
  let term = 1
  for (let k = 1; k < 24; k++) {
    term *= (x / (2 * k)) ** 2
    sum += term
  }
  return sum
}

/** A windowed sinc for every position an output sample can fall between two input samples. */
function kernels(phases: number) {
  const beta = 9
  const table = new Float32Array(phases * TAPS)
  for (let phase = 0; phase < phases; phase++) {
    const frac = phase / phases
    let sum = 0
    for (let t = 0; t < TAPS; t++) {
      const x = t - (TAPS / 2 - 1) - frac
      const edge = x / (TAPS / 2)
      const window = Math.abs(edge) < 1 ? bessel(beta * Math.sqrt(1 - edge * edge)) / bessel(beta) : 0
      const value = (x === 0 ? 1 : Math.sin(Math.PI * CUTOFF * x) / (Math.PI * CUTOFF * x)) * window
      table[phase * TAPS + t] = value
      sum += value
    }
    for (let t = 0; t < TAPS; t++) table[phase * TAPS + t] /= sum
  }
  return table
}

export class Resampler {
  private up: number
  private down: number
  private table: Float32Array
  /** The input so far that the filter still reaches back to; the newest sample is at the end. */
  private held = new Float32Array(TAPS)
  /** Input sample the next output falls after, counted into `held`, and how far past it. */
  private at = TAPS / 2 - 1
  private phase = 0

  constructor(from: number, to: number) {
    const shared = gcd(from, to)
    this.up = to / shared
    this.down = from / shared
    this.table = kernels(this.up)
  }

  /** Converts this chunk. Whatever the filter still needs comes out with the next one, or `flush`. */
  push(input: Float32Array) {
    const all = new Float32Array(this.held.length + input.length)
    all.set(this.held)
    all.set(input, this.held.length)
    const last = all.length - TAPS / 2 - 1
    const out = new Float32Array(Math.ceil(((last - this.at + 1) * this.up) / this.down) + 1)
    let n = 0
    const { up, down, table } = this
    while (this.at <= last) {
      const from = this.at - (TAPS / 2 - 1)
      const row = this.phase * TAPS
      let value = 0
      for (let t = 0; t < TAPS; t++) value += all[from + t] * table[row + t]
      out[n++] = value
      this.phase += down
      this.at += Math.floor(this.phase / up)
      this.phase %= up
    }
    const keep = Math.max(0, this.at - (TAPS / 2 - 1))
    this.held = all.slice(keep)
    this.at -= keep
    return out.subarray(0, n)
  }

  /** The end of the signal: the filter runs on into silence so the last samples come out. */
  flush() {
    return this.push(new Float32Array(TAPS))
  }
}
