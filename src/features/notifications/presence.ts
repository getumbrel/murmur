// Where the person is, so Murmur's server knows who to tell (server/notifications.ts):
// whether this tab is in front, in a focused window, and was touched in the
// last two minutes, and which chat or group it shows. Said when any of that
// changes, every 20 seconds while in front, and as the tab goes. Every tab
// says, notifications on or not: someone in Murmur needs no buzz elsewhere.

import { tabHermes } from '@/hermes/instance'
import { useNotifications } from './notifications'

const IDLE_MS = 2 * 60_000
const EVERY_MS = 20_000

/** This tab, until it's closed or reloaded. */
const tab = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
let touched = Date.now()
let viewing: string | undefined
let said = ''
let started = false
let every: ReturnType<typeof setInterval> | undefined
let idle: ReturnType<typeof setTimeout> | undefined

const inFront = () => document.visibilityState === 'visible' && document.hasFocus()
const active = () => inFront() && Date.now() - touched < IDLE_MS

const body = () =>
  JSON.stringify({
    tab,
    device: useNotifications.getState().device,
    hermes: tabHermes() ?? undefined,
    active: active(),
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

/** Say where the person is if it changed (or `always`, to keep the server's memory of this tab fresh). */
function tell(always = false) {
  const now = body()
  if (always || now !== said) send(now)
  // Going quiet is a change too: look again when the two minutes are up.
  clearTimeout(idle)
  if (active()) idle = setTimeout(() => tell(), touched + IDLE_MS - Date.now() + 50)
  clearInterval(every)
  if (inFront()) every = setInterval(() => tell(true), EVERY_MS)
}

function touch() {
  const was = active()
  touched = Date.now()
  if (!was) tell()
}

/** What's on screen: a chat's or group's notification tag (shared/notes.ts), or nothing. */
export function setViewing(tag: string | undefined) {
  if (tag === viewing) return
  viewing = tag
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
