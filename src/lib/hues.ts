// Every agent owns a hue. Accents are OKLCH, so any of these reads equally
// well in light and dark mode. Agents without a chosen hue get a stable one.

export const HUES = [278, 250, 222, 192, 160, 128, 82, 52, 28, 4, 338, 308] as const

export function hueFor(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return HUES[Math.abs(h) % HUES.length]
}

/** Deterministic 0..1 for staggering per-agent animations (blinks etc). */
export function phaseFor(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

/** The nearest palette hue, so pickers can show it as selected. */
const snapHue = (h: number) =>
  HUES.reduce((best, x) => (Math.abs(((x - h + 540) % 360) - 180) < Math.abs(((best - h + 540) % 360) - 180) ? x : best), HUES[0])

/** Hue angle of a hex colour in OKLCH, for agents coloured in Hermes Desktop. */
export function hexHue(hex: unknown): number | undefined {
  const m = typeof hex === 'string' ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null
  if (!m) return undefined
  const lin = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const [r, g, b] = lin
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s
  if (Math.hypot(A, B) < 0.02) return undefined // grey: no hue to speak of
  return snapHue((Math.atan2(B, A) * 180) / Math.PI + 360)
}
