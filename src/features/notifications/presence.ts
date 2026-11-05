// Where the person is, so Murmur's server knows who to tell (server/notifications.ts).
// Active: this tab is in front, in a focused window, and was touched in the
// last two minutes (opening it from a notification is a touch: the tap was
// outside the page), or has a call going (talking touches nothing, and the
// window needn't be in front). Here: the person's at this device, if not in
// this tab right now: it was touched in the last two minutes, in front or not,
// or a reply came in on screen in front of them then (watching one touches
// nothing), or a call's going. And which chat or group it shows. Said when any
// of that changes, every 20 seconds while here, and as the tab goes. Every tab
// says, notifications on or not: someone in Murmur needs no buzz elsewhere.

import { tabHermes } from '@/hermes/instance'
import { useNotifications } from './notifications'

const IDLE_MS = 2 * 60_000
const EVERY_MS = 20_000

/** This tab, until it's closed or reloaded. */
const tab = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
let touched = Date.now()
/** When a reply was last coming in on screen, in front. */
let watched = 0
let viewing: string | undefined
let replying = false
let calling = false
let said = ''
let started = false
let every: ReturnType<typeof setInterval> | undefined
let idle: ReturnType<typeof setTimeout> | undefined

const inFront = () => document.visibilityState === 'visible' && document.hasFocus()
const watching = () => replying && inFront()
const active = () => calling || (inFront() && Date.now() - touched < IDLE_MS)
const here = () => calling || Date.now() - Math.max(touched, watched) < IDLE_MS

const body = () =>
  JSON.stringify({
    tab,
    device: useNotifications.getState().device,
    hermes: tabHermes() ?? undefined,
    active: active(),
    here: here(),
    viewing,
  })

function send(text: string) {
  said = text
  void fetch('/murmur/presence', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: text,
    keepalive: true,
  }).catch(() => {})
}

let wasWatching = false

/** Say where the person is if it changed (or `always`, to keep the server's memory of this tab fresh). */
function tell(always = false) {
  // Watching till now, or just stopped (the window went behind, the reply landed): the two minutes start here.
  const now = Date.now()
  if (wasWatching || watching()) watched = now
  wasWatching = watching()
  const text = body()
  if (always || text !== said) send(text)
  // Going quiet is a change too: look again when the two minutes are up.
  clearTimeout(idle)
  const lapses = [touched + IDLE_MS, watched + IDLE_MS].filter((at) => at > now)
  if (lapses.length) idle = setTimeout(() => tell(), Math.min(...lapses) - now + 50)
  // Kept going, not started afresh with each touch, so moving about can't hold it off.
  if (here() && !every) every = setInterval(() => tell(true), EVERY_MS)
  if (!here() && every) {
    clearInterval(every)
    every = undefined
  }
}

const state = () => `${active()} ${here()}`

/** The person did something here: touched the page, or opened it from a notification. */
export function touch() {
  const was = state()
  touched = Date.now()
  if (state() !== was) tell()
}

/** What's on screen: a chat's or group's notification tag (shared/notes.ts), or nothing. */
export function setViewing(tag: string | undefined) {
  if (tag === viewing) return
  viewing = tag
  if (started) tell()
}

/** The chat on screen is mid-reply: someone watching it come in touches nothing. */
export function setReplying(on: boolean) {
  if (on === replying) return
  replying = on
  if (started) tell()
}

/** A call is going in this tab (src/features/talk): the person's here, talking, whatever the window's doing. */
export function setCalling(on: boolean) {
  if (on === calling) return
  calling = on
  if (started) tell()
}

export function startPresence() {
  if (started) return
  started = true
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const) {
    addEventListener(type, touch, { passive: true, capture: true })
  }
  addEventListener('focus', () => tell())
  addEventListener('blur', () => tell())
  document.addEventListener('visibilitychange', () => tell())
  // Gone: closed, reloaded, or put away by a phone.
  addEventListener('pagehide', () => navigator.sendBeacon('/murmur/presence', new Blob([JSON.stringify({ tab, gone: true })], { type: 'application/json' })))
  addEventListener('pageshow', (event) => event.persisted && tell(true))
  useNotifications.subscribe((now, before) => now.device !== before.device && tell())
  tell(true)
}
