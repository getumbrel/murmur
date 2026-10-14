import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import './transitions.css'

// Navigation, iOS style. Wouter reads its location from here, and the screen
// it shows lags the URL by one view transition: the old page is snapshotted,
// the new one rendered, and then they move.
//
// - Phones: the new page pushes in from the right while the old one drifts
//   left and dims; back reverses it. The agent's buddy flies between its row
//   (or its card in All agents), its page's hero and the chat header
//   (view-transition-name: buddy): roster → agent page → chat and back.
// - Wide: the sidebar stays put and the main pane crossfades; the buddy stays put.
// - Splash and welcome into the app: the Murmur mark settles into the one in
//   the header (or simply dissolves); an agent's buddy lands on its row.
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
  if (kind === 'chat' && prev === `/agent/${id}`) return prev
  if (kind === 'agent' && (prev === '/agents' || prev === `/chat/${id}` || prev.startsWith(`/chat/${id}/`))) return prev
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

/** The face that belongs to a path: `agent` for a chat or an agent's page, `group:<id>` for a group. */
function orbKey(p: string) {
  const m = /^\/(chat|group|agent)\/([^/]+)/.exec(p)
  if (!m) return undefined
  const id = decodeURIComponent(m[2])
  return m[1] === 'group' ? `group:${id}` : id
}

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
  const key = kind === 'pop' ? orbKey(from) : orbKey(to)
  morph(kind, update, {
    from: kind === 'handoff' ? hero : () => (kind === 'pop' ? undefined : tapped(key)) ?? find(key),
    to: (from) => (kind === 'handoff' ? landing(from, key) : find(key)),
  })
}

/** Splash or onboarding into the app: the face on screen becomes the one in the app. */
export function handoff(update: () => void) {
  const key = orbKey(location.pathname)
  if (!supported() || !hero()) return update()
  morph(reduced() ? 'fade' : 'handoff', update, {
    from: hero,
    to: (from) => landing(from, key),
  })
}

/** Where a hero lands: the Murmur mark on the header's mark (if one is on screen), a buddy on its agent. */
function landing(from: HTMLElement | undefined, key: string | undefined) {
  if (from?.dataset.hero === 'brand')
    return biggest([...document.querySelectorAll<HTMLElement>('[data-orb="brand"] .murmur-mark')])
  return key ? find(key) : (find('home') ?? find(mainAgent))
}

// ── Running one ───────────────────────────────────────────────────────────────

let updating = false

type Ends = { from: () => HTMLElement | undefined; to: (from: HTMLElement | undefined) => HTMLElement | undefined }

function morph(kind: Kind, update: () => void, ends: Ends) {
  const root = document.documentElement
  // A face only flies on phones, where the whole page moves with it. With the
  // sidebar always on screen, a flight from row to header reads as a glitch.
  const flies = !reduced() && kind !== 'fade' && kind !== 'pane'
  const a = flies ? ends.from() : undefined
  let b: HTMLElement | undefined
  root.dataset.nav = kind
  name(a, 'buddy')
  const vt = document.startViewTransition(() => {
    name(a)
    updating = true
    try {
      flushSync(update)
    } finally {
      updating = false
    }
    b = a ? ends.to(a) : undefined
    name(b, 'buddy')
  })
  // A newer navigation can skip this one before it starts; that's expected, not an error.
  vt.ready.catch(() => {})
  vt.finished.finally(() => {
    name(b)
    if (root.dataset.nav === kind) delete root.dataset.nav
  })
}

const name = (el: HTMLElement | undefined, value = '') => el && (el.style.viewTransitionName = value)

// ── Finding faces ──────────────────────────────────────────────────────────────

let tap: { el: Element; at: number } | undefined
addEventListener('click', (e) => void (tap = { el: e.target as Element, at: performance.now() }), true)

/** The face inside whatever was just tapped, if it's this agent's. */
function tapped(key: string | undefined) {
  if (!key || !tap || performance.now() - tap.at > 1000) return undefined
  const target = tap.el.closest?.('a, button')
  return target && matches(target, key) ? face(target) : undefined
}

/** Links that lead to a face's screens: a group's chat, or an agent's chats and page. */
const hrefsFor = (key: string) =>
  key.startsWith('group:') ? [`/group/${key.slice(6)}`] : [`/chat/${key}`, `/agent/${key}`]
const matches = (el: Element, key: string) => {
  const href = el.getAttribute('href')
  return el.tagName === 'BUTTON' || hrefsFor(key).some((h) => href === h || !!href?.startsWith(`${h}/`))
}

/** An agent's (or group's) face on screen now: a header's, else its biggest visible row. */
function find(key: string | undefined): HTMLElement | undefined {
  if (!key) return undefined
  const tagged = document.querySelector<HTMLElement>(`[data-orb="${CSS.escape(key)}"]`)
  if (tagged && visible(tagged)) return tagged
  const links = document.querySelectorAll(
    hrefsFor(key)
      .map(CSS.escape)
      .map((h) => `a[href="${h}"], a[href^="${h}/"]`)
      .join(', '),
  )
  return biggest([...links].map(face))
}

/** The smallest box around every buddy inside `el` (a Buddy, a BuddyStack or a BuddyRow). */
function face(el: Element) {
  const buddies = [...el.querySelectorAll<HTMLElement>('.buddy')]
  let box: HTMLElement | null = buddies[0] ?? null
  while (box && box !== el && !buddies.every((o) => box!.contains(o))) box = box.parentElement
  return box && box !== el ? box : undefined
}

/** The one face that's the star of the current screen (the splash or welcome mark, done's buddy). */
function hero() {
  return biggest([...document.querySelectorAll<HTMLElement>('[data-hero], .buddy')])
}

/** Measured by box, so an SVG (the mark) counts too. */
function biggest(els: (HTMLElement | undefined)[]) {
  let best: HTMLElement | undefined
  let most = 0
  for (const el of els) {
    const w = el?.getBoundingClientRect().width ?? 0
    if (el && visible(el) && (!best || w > most)) [best, most] = [el, w]
  }
  return best
}

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const onScreen = r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  return onScreen && (el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true)
}
