import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useLocation } from 'wouter'
import { toast } from 'sonner'
import { create } from 'zustand'
import { Buddy } from '@/ui/buddy'
import { Button } from '@/ui/button'
import { ListGroup, ListRow } from '@/ui/list'
import { Toggle } from '@/ui/toggle'
import { desktop, focusWindow } from '@/lib/desktop'
import { tabHermes, HERMES_PARAM } from '@/hermes/instance'
import { useAgents } from '@/state/agents'
import { onChatMoment } from '@/state/status'
import { Tile } from '@/features/settings/page'
import { HomeScreenSteps } from '@/features/home/install-tip'
import { BellIcon } from '@/ui/icons'
import { chatTag, groupTag } from '@shared/notes.ts'
import { isOn, setNotifications, shouldOffer, support, syncNotifications, useNotifications, type Problem } from './notifications'
import { setViewing, startPresence } from './presence'

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

const brave = typeof navigator !== 'undefined' && 'brave' in navigator

/** What went wrong turning them on, and what to do about it. */
const PROBLEMS: Record<Problem, string> = {
  'no-push': brave
    ? 'Brave needs Google’s push service to deliver them. Turn on “Use Google services for push messaging” in Brave’s privacy settings, then try again.'
    : 'This browser couldn’t sign up for notifications. In a private window, try a normal one.',
  unreachable: 'Couldn’t reach Murmur to turn them on. Check your connection, then try again.',
}

/** The tag of what's on screen (shared/notes.ts), so a note about it needn't be sent. */
function onScreen(location: string) {
  const chat = /^\/chat\/[^/]+\/([^/]+)/.exec(location)?.[1]
  if (chat && chat !== 'new') return chatTag(decodeURIComponent(chat))
  const group = /^\/group\/([^/]+)/.exec(location)?.[1]
  return group ? groupTag(decodeURIComponent(group)) : undefined
}

/** The offer, once a reply has landed: whose buddy to show beside it. */
const useOffer = create<{ offer: { hue: number; seed: string } | null }>(() => ({ offer: null }))

let offered = false

/** Right after a reply lands is when the offer makes sense: once, and only to someone looking. */
function offerSoon(face: { hue: number; seed: string }) {
  if (offered || !shouldOffer()) return
  offered = true
  setTimeout(() => {
    if (document.visibilityState === 'visible' && shouldOffer()) useOffer.setState({ offer: face })
    else offered = false
  }, 1200)
}

/**
 * Notifications on this device, mounted once in the app. Murmur's server sends
 * them (server/notifications.ts); here the device stays signed up, says where
 * the person is (presence.ts), opens the chat a clicked notification is about,
 * and offers notifications when the first reply lands.
 */
export function useNotifier() {
  const [location, navigate] = useLocation()
  const agents = useAgents().data
  const latest = useRef({ navigate, agents })
  latest.current = { navigate, agents }

  useEffect(() => {
    void syncNotifications()
    startPresence()
  }, [])

  useEffect(() => setViewing(onScreen(location)), [location])

  // A notification was clicked (public/sw.js, or the desktop app): open what it's about, on its Hermes.
  useEffect(() => {
    const open = (note: unknown) => {
      const { href, hermes } = (note ?? {}) as { href?: unknown; hermes?: unknown }
      if (typeof href !== 'string' || !href.startsWith('/')) return
      if (typeof hermes === 'string' && hermes && hermes !== tabHermes()) {
        return window.location.assign(`${href}?${HERMES_PARAM}=${encodeURIComponent(hermes)}`)
      }
      focusWindow()
      latest.current.navigate(href)
    }
    const fromWorker = (event: MessageEvent) => event.data?.type === 'murmur:open' && open(event.data)
    const worker = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined
    worker?.addEventListener('message', fromWorker)
    worker?.startMessages()
    const stopDesktop = desktop?.onOpen?.(open)
    return () => {
      worker?.removeEventListener('message', fromWorker)
      stopDesktop?.()
    }
  }, [])

  useEffect(
    () =>
      onChatMoment((moment) => {
        if (moment.kind !== 'finished') return
        const agent = latest.current.agents?.find((a) => a.id === moment.chat.profile)
        offerSoon({ hue: agent?.hue ?? 278, seed: agent?.id ?? moment.chat.profile })
      }),
    [],
  )
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
    if (on) return
    const { permission, problem } = useNotifications.getState()
    if (permission === 'denied') toast(`Notifications are blocked for Murmur. You can allow them in ${allowIn}.`)
    else if (problem) toast(PROBLEMS[problem])
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

const bell = (
  <Tile>
    <BellIcon size={19} />
  </Tile>
)

/** Settings: the switch, wherever this device can get notifications; on an iPhone in Safari, how it can. */
export function NotificationsSetting() {
  const state = useNotifications()
  const [pending, setPending] = useState<boolean | null>(null)
  if (support === 'none') return null
  if (support === 'home-screen') return <HomeScreenFirst />

  const blocked = state.permission === 'denied'
  return (
    <ListGroup
      footer={
        blocked
          ? `Notifications are blocked for Murmur. Allow them in ${allowIn}, then turn this on.`
          : state.problem
            ? PROBLEMS[state.problem]
            : desktop
              ? `Murmur lets you know when an agent finishes, needs you or has news from a routine. None showing up? Make sure Murmur is allowed in ${allowIn}.`
              : 'Murmur lets you know when an agent finishes, needs you or has news from a routine, even when it’s closed.'
      }
    >
      <ListRow
        icon={bell}
        title="Notifications"
        trailing={
          <Toggle
            label="Notifications"
            checked={pending ?? isOn(state)}
            onChange={async (next) => {
              if (pending !== null) return
              setPending(next)
              await setNotifications(next)
              setPending(null)
            }}
          />
        }
      />
    </ListGroup>
  )
}

/** Safari on an iPhone or iPad notifies only for apps on the Home Screen: the two taps, then the switch. */
function HomeScreenFirst() {
  const device = /iPhone|iPod/.test(navigator.userAgent) ? 'iPhone' : 'iPad'
  return (
    <ListGroup footer="Then open Murmur from your Home Screen and turn notifications on here.">
      <div className="flex gap-3 px-4 py-3">
        <span className="flex size-7 flex-none items-center justify-center">{bell}</span>
        <div className="min-w-0 flex-1">
          <p className="text-body">Notifications</p>
          <p className="mt-0.5 text-footnote text-pretty text-ink-2">
            To get them on this {device}, add Murmur to your Home Screen.
          </p>
          <HomeScreenSteps className="mt-3" />
        </div>
      </div>
    </ListGroup>
  )
}
