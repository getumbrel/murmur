import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useLocation } from 'wouter'
import { toast } from 'sonner'
import { create } from 'zustand'
import { Buddy } from '@/ui/buddy'
import { Button } from '@/ui/button'
import { ListGroup, ListRow } from '@/ui/list'
import { Toggle } from '@/ui/toggle'
import { desktop } from '@/lib/desktop'
import { useAgents } from '@/state/agents'
import { useGroupSummaries } from '@/state/groups'
import { onChatMoment, viewingChat } from '@/state/status'
import { Tile } from '@/features/settings/page'
import { chatNote, groupNote } from './compose'
import { BellIcon } from '@/ui/icons'
import {
  isOn,
  notificationsSupported,
  setNotifications,
  shouldOffer,
  showNote,
  useNotifications,
  watchPermission,
} from './notifications'

/**
 * Where notifications are allowed. The desktop app always reads as allowed to
 * the page (the OS decides later, out of its sight), so there it's also
 * where to look when none appear.
 */
const allowIn = desktop
  ? desktop.platform === 'darwin'
    ? 'System Settings › Notifications'
    : desktop.platform === 'win32'
      ? 'Settings › System › Notifications'
      : 'your system’s settings'
  : 'your browser’s settings for this site'

/** Is the person looking at this right now: on screen, in a window that has focus? */
const looking = (onScreen: boolean) => onScreen && document.visibilityState === 'visible' && document.hasFocus()

/** The offer, once a reply has landed: whose buddy to show beside it. */
const useOffer = create<{ offer: { hue: number; seed: string } | null }>(() => ({ offer: null }))

let offered = false

/** Right after a reply lands is when the offer makes sense: once, and only to someone looking. */
function offerSoon(face: { hue: number; seed: string }) {
  if (offered || !notificationsSupported() || !shouldOffer()) return
  offered = true
  setTimeout(() => {
    if (document.visibilityState === 'visible' && shouldOffer()) useOffer.setState({ offer: face })
    else offered = false
  }, 1200)
}

/**
 * Tells the person, with a system notification, when an agent finishes a reply
 * or needs them in a chat or group they aren't looking at. Mount once, in the
 * app. Chats are told by the chat store (src/state/status.ts); groups by their
 * summaries, when a round ends.
 */
export function useSystemNotifications() {
  const [location, navigate] = useLocation()
  const agents = useAgents().data
  const groups = useGroupSummaries().data
  const latest = useRef({ location, navigate, agents })
  latest.current = { location, navigate, agents }

  useEffect(() => {
    watchPermission()
    return onChatMoment((moment) => {
      const { navigate, agents } = latest.current
      const agent = agents?.find((a) => a.id === moment.chat.profile)
      const note = chatNote(moment, agent?.name ?? moment.chat.speaker?.name ?? 'Murmur')
      if (!note) return
      if (!looking(viewingChat() === moment.chat.id)) showNote(note, navigate)
      if (moment.kind === 'finished') offerSoon({ hue: agent?.hue ?? 278, seed: agent?.id ?? moment.chat.profile })
    })
  }, [])

  const rounds = useRef(new Map<string, boolean>())
  useEffect(() => {
    if (!groups) return
    for (const group of groups) {
      const wasLive = rounds.current.get(group.id)
      rounds.current.set(group.id, group.live)
      if (!wasLive || group.live) continue
      const note = groupNote(group)
      if (note && !looking(latest.current.location === note.href)) showNote(note, latest.current.navigate)
    }
  }, [groups])
}

/**
 * "Get notified when an agent finishes?", asked in Murmur's own words before
 * the browser asks in its own: a small card under the top bar, centred on the
 * conversation (`inset` from the left, beside the sidebar).
 */
export function NotificationOffer({ inset = 0 }: { inset?: number }) {
  const offer = useOffer((s) => s.offer)
  const [asking, setAsking] = useState(false)
  const close = () => useOffer.setState({ offer: null })

  const allow = async () => {
    setAsking(true)
    const on = await setNotifications(true)
    setAsking(false)
    close()
    if (!on && useNotifications.getState().permission === 'denied') {
      toast(`Notifications are blocked for Murmur. You can allow them in ${allowIn}.`)
    }
  }
  const later = () => {
    void setNotifications(false)
    close()
  }

  return (
    <div
      className="pointer-events-none fixed right-0 top-[calc(env(safe-area-inset-top)+var(--titlebar-h,3.5rem)+8px)] z-[60] flex justify-center px-4"
      style={{ left: inset }}
    >
      <AnimatePresence>
        {offer && (
          <motion.div
            key="offer"
            role="dialog"
            aria-label="Notifications"
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
            transition={{ type: 'spring', duration: 0.45, bounce: 0.18, opacity: { duration: 0.2 } }}
            className="notify-offer pointer-events-auto flex w-full max-w-[25rem] origin-top items-center gap-3 rounded-[22px] py-2.5 pr-2.5 pl-3"
          >
            <span className="-my-1 flex-none">
              <Buddy hue={offer.hue} size={30} state="done" seed={offer.seed} />
            </span>
            <p className="min-w-0 flex-1 text-subhead leading-5 font-medium tracking-[-0.01em] text-balance">
              Get notified when an agent finishes?
            </p>
            <div className="flex flex-none items-center gap-1">
              <Button size="sm" variant="ghost" className="text-ink-2" onClick={later} disabled={asking}>
                Not now
              </Button>
              <Button size="sm" variant="accent" onClick={allow} loading={asking}>
                Allow
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Settings: the switch, where this browser (or the desktop app) can show notifications at all. */
export function NotificationsSetting() {
  const state = useNotifications()
  const [busy, setBusy] = useState(false)
  if (!notificationsSupported()) return null
  const on = isOn(state)
  const blocked = state.permission === 'denied'
  return (
    <ListGroup
      footer={
        blocked
          ? `Notifications are blocked for Murmur. Allow them in ${allowIn}, then turn this on.`
          : desktop
            ? `Murmur lets you know when an agent finishes or needs you while you’re somewhere else. None showing up? Make sure Murmur is allowed in ${allowIn}.`
            : 'Murmur lets you know when an agent finishes or needs you while you’re somewhere else.'
      }
    >
      <ListRow
        icon={
          <Tile>
            <BellIcon size={19} />
          </Tile>
        }
        title="Notifications"
        trailing={
          <Toggle
            label="Notifications"
            checked={on}
            onChange={async (next) => {
              if (busy) return
              setBusy(true)
              await setNotifications(next)
              setBusy(false)
            }}
          />
        }
      />
    </ListGroup>
  )
}
