import { useSyncExternalStore } from 'react'

// Light, dark, or whatever the device is set to. The choice is the browser's,
// not any one Hermes's, so it's kept under a shared key. index.html applies it
// before the first paint (keep the two in step); this module changes it live.
//
// <html data-theme="light|dark"> forces one; no attribute follows the system.
// The tokens in styles.css (and brand.css, buddy.css) read it that way.

export type ThemePref = 'system' | 'light' | 'dark'

export const THEME_KEY = 'murmur:theme'
/** Fired on window when the theme changes, for surfaces that copy the tokens (inline previews). */
export const THEME_EVENT = 'murmur:theme'

/** The browser chrome around the app: the same colours as --bg. */
const CHROME = { light: '#fbfbfa', dark: '#0b0b0c' } as const

const valid = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark'

function read(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return valid(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

let current = read()
const listeners = new Set<() => void>()

function apply(pref: ThemePref) {
  const root = document.documentElement
  // Swap in one frame: colour transitions (bars, rows) would otherwise fade
  // through each other at different speeds.
  const still = document.createElement('style')
  still.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.append(still)
  if (pref === 'system') delete root.dataset.theme
  else root.dataset.theme = pref
  void getComputedStyle(root).color
  requestAnimationFrame(() => requestAnimationFrame(() => still.remove()))
  // Each theme-color meta answers for its own scheme unless one is forced.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = pref !== 'system' ? pref : meta.media.includes('dark') ? 'dark' : 'light'
    meta.content = CHROME[scheme]
  }
  const scheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (scheme) scheme.content = pref === 'system' ? 'light dark' : pref
  window.dispatchEvent(new Event(THEME_EVENT))
}

export function setTheme(pref: ThemePref) {
  if (pref === current) return
  current = pref
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, pref)
  } catch {
    // Private mode: it holds for this visit.
  }
  apply(pref)
  listeners.forEach((l) => l())
}

// Another tab changed it: follow along.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== THEME_KEY && e.key !== null) return
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

export function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  return [useSyncExternalStore(subscribe, () => current), setTheme]
}
