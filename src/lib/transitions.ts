import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import './transitions.css'

// Navigation, iOS style. Wouter reads its location from here, and the screen
// it shows lags the URL by one view transition: the old page is snapshotted,
// the new one rendered, and then they move.
//
// - Phones: the new page pushes in from the right while the old one drifts
//   left and dims; back reverses it. Buddies move with their page: a face
//   flying from one screen to the next read as a glitch more than a link.
// - Wide: the sidebar stays put and the main pane crossfades.
// - Splash and welcome into the app: a soft dissolve.
// - Reduced motion: a 150ms crossfade. No View Transitions: an instant change.

type Kind = 'push' | 'pop' | 'fade' | 'pane' | 'handoff'
type Options = { replace?: boolean; state?: unknown }

const media = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches
const reduced = () => media('(prefers-reduced-motion: reduce)')
const wide = () => media('(min-width: 900px)')
const supported = () => typeof document !== 'undefined' && 'startViewTransition' in document

// ── The location wouter sees ──────────────────────────────────────────────────

let shown = location.pathname
const subscribers = new Set<() => void>()
const subscribe = (fn: () => void) => (subscribers.add(fn), () => void subscribers.delete(fn))
function show(path: string) {
  if (path === shown) return
  shown = path
  subscribers.forEach((fn) => fn())
}

export const useTransitionLocation = (): [string, typeof navigate] => [
  useSyncExternalStore(subscribe, () => shown),
  navigate,
]

// ── Pages that are gone ───────────────────────────────────────────────────────
// A chat deleted while it's still in history (you opened its agent's page from
// it, then deleted it there): going back lands where it's been replaced by,
// never on "This chat isn't here anymore".

const moved = new Map<string, string>()
let movedVersion = 0
const movedSubscribers = new Set<() => void>()

/** `path` is gone: going back (or forward) to it lands on `to` instead. */
export function replaceGone(path: string, to: string) {
  if (path === to) return
  moved.set(path, to)
  movedVersion++
  movedSubscribers.forEach((fn) => fn())
}

/** Where `path` lands now. */
const resolve = (path: string) => moved.get(path) ?? path

/** upFrom, kept current when the page beneath is replaced. */
export function useUpFrom(path: string) {
  useSyncExternalStore(
    (fn) => (movedSubscribers.add(fn), () => void movedSubscribers.delete(fn)),
    () => movedVersion,
  )
  return upFrom(path)
}

// ── History: where we are in it, and each entry's scroll ─────────────────────

history.scrollRestoration = 'manual'
let pos: number = history.state?.murmur ?? 0
const paths: string[] = []
const scrolls: number[] = []
paths[pos] = location.pathname
if (history.state?.murmur == null) history.replaceState({ murmur: pos }, '')

/** The entry beneath this one, if we came from it. */
export const previous = () => paths[pos - 1] && resolve(paths[pos - 1])
export const previousScroll = () => scrolls[pos - 1] ?? 0

let instantNext = false
let arrival: 'push' | 'pop' | 'replace' = 'push'

/** How the page on screen was reached: pages coming back into view can restore where they were. */
export const arrivedBy = () => arrival

export function navigate(to: string, { replace = false, state = null }: Options = {}) {
  const path = to.split(/[?#]/)[0]
  // "Back" to the page we came from is a real back, so history stays a stack.
  if (!replace && path === to && path === previous()) return history.back()
  scrolls[pos] = scrollY
  if (!replace) pos++
  paths.length = pos + 1
  paths[pos] = path
  scrolls[pos] = 0
  history[replace ? 'replaceState' : 'pushState']({ murmur: pos, state }, '', to)
  go(path, replace ? 'replace' : 'push')
}

/** Back without animation: an edge swipe has already done the moving. */
export function backInstantly() {
  instantNext = true
  navigate(upFrom(shown))
}

/**
 * Where "back" goes from a page: the page beneath it when that's where you
 * came from (an agent's page under its chat, the chat you opened its page
 * from, All agents under an agent), otherwise Home. History stays a stack.
 */
export function upFrom(path: string) {
  const prev = previous()
  const m = /^\/(chat|agent)\/([^/]+)/.exec(path)
  if (!prev || !m) return '/'
  const [, kind, id] = m
  if (kind === 'chat' && (prev === `/agent/${id}` || prev === `/chats/${id}`)) return prev
  if (kind === 'agent' && (prev === '/agents' || prev === `/chats/${id}` || prev === `/chat/${id}` || prev.startsWith(`/chat/${id}/`)))
    return prev
  return '/'
}

addEventListener('popstate', (e) => {
  const next: number = e.state?.murmur ?? pos + 1
  const back = next < pos
  scrolls[pos] = scrollY
  pos = next
  // Arriving at a page that's gone: it becomes the page that replaced it.
  const gone = moved.get(location.pathname)
  if (gone) history.replaceState(history.state, '', gone)
  paths[pos] = location.pathname
  // Safari's own swipe-back already animated; don't do it twice.
  if ((e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition) instantNext = true
  go(location.pathname, back ? 'pop' : 'push', scrolls[pos] ?? 0)
})

// ── Planning a move ───────────────────────────────────────────────────────────

/** Moves within a screen (chat to chat of one agent, settings pages) don't transition here. */
const screen = (p: string) =>
  p.startsWith('/welcome')
    ? 'welcome'
    : p.startsWith('/settings')
      ? 'settings'
      : (/^\/(chat|group|agent)\/[^/]+/.exec(p)?.[0] ?? p)

const depth = (p: string) => (p === '/' ? 0 : 1)

let mainAgent = 'default'
export const setMainAgent = (id: string | undefined) => void (mainAgent = id ?? 'default')
/** The main agent's id (for "new chat" with nobody on screen). */
export const mainAgentId = () => mainAgent

function plan(from: string, to: string, how: 'push' | 'pop' | 'replace'): Kind | null {
  const a = screen(from)
  const b = screen(to)
  if (a === b || b === 'welcome') return null
  if (a === 'welcome') return 'handoff'
  const kind = how === 'pop' || depth(to) < depth(from) ? 'pop' : how === 'replace' ? 'fade' : 'push'
  if (wide()) return 'pane'
  return reduced() ? 'fade' : kind
}

function go(to: string, how: 'push' | 'pop' | 'replace', scroll = 0) {
  const from = shown
  arrival = how
  const kind = plan(from, to, how)
  const instant = instantNext
  instantNext = false
  const moved = screen(from) !== screen(to)
  const update = () => {
    show(to)
    if (moved) scrollTo(0, scroll)
  }
  if (!kind || instant || updating || !supported()) return update()
  morph(kind, update)
}

/** Splash or onboarding into the app: the app dissolves in. */
export function handoff(update: () => void) {
  if (!supported()) return update()
  morph(reduced() ? 'fade' : 'handoff', update)
}

// ── Running one ───────────────────────────────────────────────────────────────

let updating = false

function morph(kind: Kind, update: () => void) {
  const root = document.documentElement
  root.dataset.nav = kind
  const vt = document.startViewTransition(() => {
    updating = true
    try {
      flushSync(update)
    } finally {
      updating = false
    }
  })
  // A newer navigation can skip this one before it starts; that's expected, not an error.
  vt.ready.catch(() => {})
  vt.finished.finally(() => {
    if (root.dataset.nav === kind) delete root.dataset.nav
  })
}
