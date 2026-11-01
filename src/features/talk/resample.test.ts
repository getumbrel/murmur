import { describe, expect, it } from 'vitest'
import { Resampler } from './resample'

const tone = (hz: number, rate: number, seconds: number) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate))

const all = (r: Resampler, chunks: Float32Array[]) => {
  const parts = [...chunks.map((c) => r.push(c).slice()), r.flush().slice()]
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) out.set(p, (at += p.length) - p.length)
  return out
}

const slice = (x: Float32Array, size: number) => {
  const out: Float32Array[] = []
  for (let i = 0; i < x.length; i += size) out.push(x.subarray(i, i + size))
  return out
}

/** How far the signal is from a perfect sine of this frequency, in dB. */
function snr(x: Float32Array, hz: number, rate: number) {
  const skip = rate >> 3
  const body = x.subarray(skip, x.length - skip)
  let c = 0
  let s = 0
  for (let i = 0; i < body.length; i++) {
    const a = (2 * Math.PI * hz * i) / rate
    c += body[i] * Math.cos(a)
    s += body[i] * Math.sin(a)
  }
  c *= 2 / body.length
  s *= 2 / body.length
  let error = 0
  let signal = 0
  for (let i = 0; i < body.length; i++) {
    const a = (2 * Math.PI * hz * i) / rate
    const clean = c * Math.cos(a) + s * Math.sin(a)
    signal += clean * clean
    error += (body[i] - clean) ** 2
  }
  return 10 * Math.log10(signal / error)
}

describe('resampling a stream of speech', () => {
  for (const [from, to] of [
    [24000, 48000],
    [24000, 44100],
    [16000, 48000],
    [16000, 44100],
  ]) {
    it(`keeps a voice clean from ${from} to ${to} Hz`, () => {
      const out = all(new Resampler(from, to), slice(tone(3000, from, 1), Math.round(from * 0.08)))
      expect(snr(out, 3000, to)).toBeGreaterThan(70)
    })
    it(`comes out the same however ${from} Hz is cut into chunks`, () => {
      const input = tone(1234, from, 0.5)
      const whole = all(new Resampler(from, to), [input])
      const cut = all(new Resampler(from, to), slice(input, 137))
      expect(cut.length).toBe(whole.length)
      for (let i = 0; i < whole.length; i += 97) expect(cut[i]).toBeCloseTo(whole[i], 4)
    })
    it(`keeps the length from ${from} to ${to} Hz`, () => {
      const out = all(new Resampler(from, to), slice(tone(500, from, 1), 800))
      expect(Math.abs(out.length - to)).toBeLessThan((to / from) * 40)
    })
  }
  it('adds nothing above the voice', () => {
    // A tone near the top of 24 kHz audio, the worst case for images at 48 kHz.
    const out = all(new Resampler(24000, 48000), slice(tone(10000, 24000, 1), 1920))
    expect(snr(out, 10000, 48000)).toBeGreaterThan(60)
  })
  it('leaves silence silent', () => {
    const out = all(new Resampler(24000, 44100), [new Float32Array(24000)])
    expect(Math.max(...out.map(Math.abs))).toBe(0)
  })
})
