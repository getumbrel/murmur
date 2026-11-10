import { useSyncExternalStore } from 'react'

// How big Murmur's words are on this device. Like the theme, the choice is the
// browser's, not any one Hermes's, so it's kept under a shared key; index.html
// applies it before the first paint (keep the two in step), and this module
// changes it live.
//
// <html data-text-size="…"> scales the root font size (styles.css), and every
// size and space in the app is measured from that, so the whole page grows in
// proportion, on top of whatever size the browser itself is set to.

export const TEXT_SIZES = ['small', 'default', 'large', 'larger', 'largest'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export const TEXT_SIZE_KEY = 'murmur:text-size'

const valid = (v: unknown): v is TextSize => TEXT_SIZES.includes(v as TextSize)

function read(): TextSize {
  try {
    const v = localStorage.getItem(TEXT_SIZE_KEY)
    return valid(v) ? v : 'default'
  } catch {
    return 'default'
  }
}

let current = read()
const listeners = new Set<() => void>()

function apply(size: TextSize) {
  const root = document.documentElement
  if (size === 'default') delete root.dataset.textSize
  else root.dataset.textSize = size
}

export function setTextSize(size: TextSize) {
  if (size === current) return
  current = size
  try {
    if (size === 'default') localStorage.removeItem(TEXT_SIZE_KEY)
    else localStorage.setItem(TEXT_SIZE_KEY, size)
  } catch {
    // Private mode: it holds for this visit.
  }
  apply(size)
  listeners.forEach((l) => l())
}

// Another tab changed it: follow along.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== TEXT_SIZE_KEY && e.key !== null) return
    const next = read()
    if (next === current) return
    current = next
    apply(next)
    listeners.forEach((l) => l())
  })
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useTextSize(): [TextSize, (size: TextSize) => void] {
  return [useSyncExternalStore(subscribe, () => current), setTextSize]
}
