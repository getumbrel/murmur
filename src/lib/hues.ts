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
