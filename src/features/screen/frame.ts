// The picture kept of an agent's browser (state/browser-frames.ts): what it's
// named, and how it's cut from a still of the screen.

type Size = { w: number; h: number }

/**
 * An id as Murmur's server takes one. Hermes's own are fine as they are; one
 * that isn't (a model's own call id can be anything) is named by its hash.
 */
export function frameId(id: string) {
  if (/^[A-Za-z0-9_-]{1,64}$/.test(id)) return id
  let a = 0xdeadbeef
  let b = 0x41c6ce57
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i)
    a = Math.imul(a ^ c, 2654435761)
    b = Math.imul(b ^ c, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return `h_${(b >>> 0).toString(16).padStart(8, '0')}${(a >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * How a still of a screen `size` big is cut down to its page (what's between
 * `bars`, in the screen's own pixels), at most `width` wide.
 */
export function pageCut(natural: Size, size: Size, bars: { top: number; bottom: number }, width: number) {
  const k = natural.w / size.w
  const top = Math.round(bars.top * k)
  const height = Math.max(1, natural.h - Math.round((bars.top + bars.bottom) * k))
  const w = Math.min(width, natural.w)
  return { top, height, w, h: Math.max(1, Math.round((height * w) / natural.w)) }
}
