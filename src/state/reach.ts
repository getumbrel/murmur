// What's out of reach, when something is. Murmur talks to its own server,
// which talks to each Hermes, so three things can be away, and each wants its
// own words: this device has no connection, Murmur's server doesn't answer
// (the phone has left home, the Umbrel is off), or Murmur is there and Hermes
// isn't.
//
// The first two take every agent with them, and so does the third when no
// Hermes answers. With several, one Hermes away on its own is only its own
// agents' business: they doze off where they are and the rest carry on
// (`useAwayOn`, features/connection/unreachable.ts).
//
// While anything is, the Buddies sleep, the island says which (screens/
// connection-banner.tsx), and chats show as they were last seen (state/kept.ts).

import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { gateway, stateOfAll, useAway as useHermesAway, useConnection } from '@/hermes/gateway'
import { hermesIds, onHermesIds } from '@/hermes/instance'
import { openedKept } from '@/lib/keep-app'

export type Away = 'offline' | 'murmur' | 'hermes'

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false

/**
 * `away` is set once it's worth saying: at once when the page itself came
 * from the device because the server didn't answer, a moment after the
 * connection drops when the device or Murmur is out of reach, and after the
 * few seconds a restart takes when it's only Hermes.
 */
export const useReach = create<{ away?: Away }>(() => ({ away: openedKept ? (online() ? 'murmur' : 'offline') : undefined }))

/** What's out of reach for every agent right now, if anything. */
export const useAway = () => useReach((s) => s.away)
export const away = () => useReach.getState().away

const several = () => hermesIds().length > 1

/** What's out of reach for one Hermes's agents: whatever is for all of them, or, with several, that Hermes alone. */
export function useAwayOn(hermes: string | null | undefined): Away | undefined {
  const all = useAway()
  const alone = useHermesAway(hermes)
  const many = useSyncExternalStore(onHermesIds, several)
  return all ?? (alone && many ? 'hermes' : undefined)
}

/** The same, now. */
export const awayOn = (hermes: string | null | undefined): Away | undefined =>
  away() ?? (several() && useConnection.getState(hermes).away ? 'hermes' : undefined)

/** Whether any Hermes has ever been reached on this page. */
const everOpened = () => (hermesIds().length ? hermesIds() : [null]).some((hermes) => useConnection.getState(hermes).everOpened)

/** Blips shorter than this are never mentioned. */
const BLIP_MS = 1500
/** How long Hermes alone may be away before it's said: longer once it has been reached, as a restart is likelier. */
export const hermesPatience = (everOpened: boolean) => (everOpened ? 12_000 : 6000)
const LOOK_AGAIN_MS = 8000

/** Asks Murmur's server the smallest thing it answers, to tell which side of it the trouble is. */
async function whatsAway(): Promise<Away> {
  if (!online()) return 'offline'
  try {
    const res = await fetch('/murmur/session', { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    // Something in front of Murmur answering for it (a proxy's error page) isn't Murmur.
    return res.ok ? 'hermes' : 'murmur'
  } catch {
    return online() ? 'murmur' : 'offline'
  }
}

let wired = false

/** Follows the connections to Hermes; mount once, before they're dialled. */
export function wireReach() {
  if (wired) return
  wired = true
  /** When the connection went down; 0 while it's up (or not dialled yet). */
  let since = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let looks = 0
  const say = (next?: Away) => {
    if (useReach.getState().away !== next) useReach.setState({ away: next })
  }
  const lookIn = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(look, ms)
  }
  async function look() {
    clearTimeout(timer)
    if (!since) return
    const mine = ++looks
    const found = await whatsAway()
    if (mine !== looks || !since) return
    const waited = Date.now() - since
    const patience = found === 'hermes' && !away() ? hermesPatience(everOpened()) : 0
    if (waited >= patience) say(found)
    // Seen less often in a hidden tab; coming back looks at once.
    lookIn(waited < patience ? patience - waited : document.visibilityState === 'visible' ? LOOK_AGAIN_MS : 60_000)
  }
  // Every Hermes as one: down while none is open and one is being dialled.
  const follow = () => {
    const state = stateOfAll()
    if (state !== 'down') {
      since = 0
      looks++
      clearTimeout(timer)
      // Not dialled yet: what the page knew when it opened still stands.
      if (state === 'open') say(undefined)
    } else if (!since) {
      since = Date.now()
      lookIn(away() || !online() ? 0 : BLIP_MS)
    }
  }
  follow()
  gateway.onState(follow)
  onHermesIds(follow)
  const now = () => void (since && look())
  window.addEventListener('online', now)
  window.addEventListener('offline', now)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && now())
}
