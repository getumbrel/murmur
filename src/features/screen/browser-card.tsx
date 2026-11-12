import './screen.css'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight } from 'lucide-react'
import type { Speaker } from '@/features/chat/types'
import { useMediaContext } from '@/features/media/context'
import { Lightbox } from '@/features/media/lightbox'
import { useKeptFrame, type Kept } from '@/state/browser-frames'
import { sizeOf, useScreen, useScreens, useShowable } from '@/state/screen'
import { keepLast } from './keeping'
import { Peek, SiteMark } from './peek'
import type { Browsing } from './place'
import { ScreenSetup, useScreenOffer } from './screen-setup'

/**
 * An agent's browser in a reply, under the steps that last used it. While
 * the agent works in it, the browser itself, live; once it stops, the window
 * stays, on the page where it left off. In an earlier reply, once a later one
 * shows the browser, it folds to a line, so a chat has one browser per agent.
 *
 * Where there was no picture to keep (a browser nobody could see, a reply
 * nobody watched), it's a line with the site that opens the page itself; with
 * no site either, nothing.
 */
export function BrowserCard({
  browsing,
  agent,
  live,
  folded,
}: {
  browsing: Browsing
  agent: Speaker
  live: boolean
  folded?: boolean
}) {
  const { step, frame, site, page } = browsing
  const profile = agent.id
  const { sessionId, frames } = useMediaContext()
  const chat = frames ?? sessionId
  const reduce = useReducedMotion()
  const screen = useScreen(profile)
  const showable = useShowable(profile)
  const unseen = useScreens((s) => !!s.unseen[profile])
  const { offer, notNow } = useScreenOffer(profile)
  // Once the setup's begun here, it stays to the end.
  const [settingUp, setSettingUp] = useState(false)
  const left = useKeptFrame(chat, frame)

  // The reply ending is when its page is kept: until that's done, the window waits as it is.
  const [wasLive, setWasLive] = useState(live)
  const [settling, setSettling] = useState(false)
  if (wasLive !== live) {
    setWasLive(live)
    if (!live && chat && frame) setSettling(true)
  }
  const size = sizeOf(screen)
  useEffect(() => {
    if (!settling || !chat || !frame) return
    let here = true
    void keepLast(chat, frame, profile, size).finally(() => here && setSettling(false))
    return () => {
      here = false
    }
  }, [settling])
  // One that's here from the start is where the chat left it: it doesn't unfold again.
  const watched = useRef(live)
  watched.current ||= live

  // No screen to show on this Hermes, as far as it says: the site stands in from the start.
  const none = !!screen && (!screen.supported || !screen.installed || unseen)
  const setup = live && (offer || settingUp)
  const link = page ? 'link' : null
  const form = setup
    ? 'setup'
    : folded
      ? left
        ? 'folded'
        : left === null
          ? link
          : null
      : (live && showable) || left || settling
        ? 'peek'
        : (live ? none : left === null)
          ? link
          : null

  return (
    <AnimatePresence initial={false}>
      {form && (
        <motion.div
          key={form}
          initial={watched.current && (reduce ? { opacity: 0 } : { opacity: 0, height: 0 })}
          animate={{ opacity: 1, height: 'auto' }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
          className="max-w-[560px] overflow-hidden"
        >
          {form === 'setup' ? (
            <ScreenSetup agent={agent} onStart={() => setSettingUp(true)} onNotNow={notNow} />
          ) : form === 'folded' ? (
            <Folded left={left!} site={site} agent={agent} />
          ) : form === 'link' ? (
            <PageLink page={page!} site={site} />
          ) : (
            <Peek
              profile={profile}
              agent={agent}
              site={site}
              step={step}
              live={live}
              left={left}
              open={!folded}
              keep={chat && frame ? { chat, frame } : undefined}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const ROW = 'pressable flex w-fit max-w-full items-center rounded-[18px] bg-fill-1 py-2 text-left hover:bg-fill-2'

/** An earlier reply's browser, once a later one shows it: the page it left, small, and its site. Opens the picture. */
function Folded({ left, site, agent }: { left: Kept; site?: string; agent: Speaker }) {
  const [open, setOpen] = useState(false)
  const origin = useRef<HTMLButtonElement>(null)
  const where = site ?? 'the page'
  return (
    <>
      <button
        ref={origin}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`See ${where} as ${agent.name} left it`}
        className={`${ROW} gap-3 pr-5 pl-2`}
      >
        <img
          src={left.src}
          alt=""
          draggable={false}
          className="block w-16 flex-none rounded-[8px] object-cover object-top ring-[0.5px] ring-line select-none"
          style={{ aspectRatio: `${left.w} / ${left.h}` }}
        />
        <span className="truncate text-footnote font-medium text-ink">{site ?? 'Browser'}</span>
      </button>
      {open && origin.current && (
        <Lightbox
          src={left.src}
          alt={`${where} as ${agent.name} left it`}
          name={site}
          origin={origin.current}
          radius={8}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** Where the agent's browser left off, when there's no picture of it: the site, which opens the page itself. */
function PageLink({ page, site }: { page: string; site?: string }) {
  return (
    <a href={page} target="_blank" rel="noopener noreferrer" className={`${ROW} gap-2.5 pr-4 pl-2`}>
      <SiteMark site={site} size={28} />
      <span className="truncate text-footnote font-medium text-ink">{site}</span>
      <ArrowUpRight size={15} strokeWidth={2} aria-hidden className="flex-none text-ink-3" />
    </a>
  )
}
