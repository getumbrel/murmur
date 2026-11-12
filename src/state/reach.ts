// What's out of reach, when something is. Murmur talks to its own server,
// which talks to Hermes, so three things can be away, and each wants its own
// words: this device has no connection, Murmur's server doesn't answer (the
// phone has left home, the Umbrel is off), or Murmur is there and Hermes isn't.
//
// While anything is, the Buddies sleep, the island says which (screens/
// connection-banner.tsx), and chats show as they were last seen (state/kept.ts).

import { create } from 'zustand'
import { useConnection } from '@/hermes/gateway'
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

/** What's out of reach right now, if anything. */
export const useAway = () => useReach((s) => s.away)
export const away = () => useReach.getState().away

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

/** Follows the connection to Hermes; mount once, before it's dialled. */
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
    const patience = found === 'hermes' && !away() ? hermesPatience(useConnection.getState().everOpened) : 0
    if (waited >= patience) say(found)
    // Seen less often in a hidden tab; coming back looks at once.
    lookIn(waited < patience ? patience - waited : document.visibilityState === 'visible' ? LOOK_AGAIN_MS : 60_000)
  }
  const follow = (state: string) => {
    const down = state !== 'open' && state !== 'idle'
    if (!down) {
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
  follow(useConnection.getState().state)
  useConnection.subscribe((s) => follow(s.state))
  const now = () => void (since && look())
  window.addEventListener('online', now)
  window.addEventListener('offline', now)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && now())
}
