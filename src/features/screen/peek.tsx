import './screen.css'
import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Maximize2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { BrowserIcon } from '@/ui/icons'
import type { Speaker } from '@/features/chat/types'
import { SiteIcon } from '@/features/vault/site-icon'
import { Lightbox } from '@/features/media/lightbox'
import type { Kept } from '@/state/browser-frames'
import { sizeOf, useControl, useScreen, useStill } from '@/state/screen'
import { type BrowserStep, useDrawn } from './drawn'
import { useKeeping } from './keeping'
import { Still } from './live-view'
import { openViewer } from './viewer'

/** A site as itself: its own icon when it's a named one, else a browser. */
export function SiteMark({ site, size }: { site?: string; size: number }) {
  return (
    <span aria-hidden className="flex flex-none">
      {site && named(site) ? <SiteIcon host={site} size={size} /> : <BrowserIcon size={Math.round(size * 0.9)} className="text-ink-2" />}
    </span>
  )
}

/**
 * The tag over a picture of the agent's browser: "Live · shop.example.com" or
 * who has it while the agent works, and once it's stopped, the site alone,
 * under its own icon.
 */
function Tag({ text, site, live, left }: { text: string; site?: string; live: boolean; left: boolean }) {
  return (
    <span className="glass pointer-events-none absolute bottom-2.5 left-2.5 flex h-7 max-w-[calc(100%-20px)] items-center rounded-full px-2.5 text-caption font-medium shadow-[inset_0_0_0_0.5px_var(--line-strong)]">
      {left ? (
        <span key="left" className="flex min-w-0 animate-fade items-center gap-1.5">
          <SiteMark site={site} size={16} />
          <span className="truncate">{site ?? 'Browser'}</span>
        </span>
      ) : (
        <span key="live" className="flex min-w-0 items-center gap-1.5">
          <span className={cn('relative flex size-2 flex-none', live && 'live-dot')}>
            <span className={cn('size-2 rounded-full', live ? 'bg-accent' : 'bg-ink-3')} />
          </span>
          <span className="flex-none">{text}</span>
          {site && (
            <>
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              <span className="truncate text-ink-2">{site}</span>
            </>
          )}
        </span>
      )}
    </span>
  )
}

/** A site with a name (not an address like 192.168.1.4): one that may have an icon of its own. */
const named = (site: string) => /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(site.replace(/:\d+$/, ''))

/**
 * The page on its way, the way a browser shows one: its loading bar along the
 * top, and the site where its page will be.
 */
function Opening({ site }: { site?: string }) {
  return (
    <motion.span
      initial={false}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-none absolute inset-0 grid place-items-center bg-elevated"
    >
      <span aria-hidden className="opening-bar absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-fill-2" />
      {site && named(site) ? (
        <span className="opening-icon">
          <SiteIcon host={site} size={40} />
        </span>
      ) : (
        <BrowserIcon size={32} className="opening-icon text-ink-3" />
      )}
    </motion.span>
  )
}

/**
 * A window onto the agent's browser (just the page), a fresh still every
 * moment while the agent has it; opens it big. While the person has it, it
 * stays on the last picture, quieted, or shows who has it. For a turn that
 * has just started browsing, it shows the page opening until the browser has
 * drawn after its first step there (`step`).
 *
 * When the reply ends (`live` off) the window stays, on the page where the
 * agent left it (`left`, the picture kept for the reply), under the site's
 * own name. It still opens the browser while that's the one on show (`open`);
 * after that, it opens the picture.
 */
export function Peek({
  profile,
  agent,
  site,
  reason,
  step,
  live = true,
  left,
  open = true,
  keep,
}: {
  profile: string
  agent: Speaker
  site?: string
  reason?: string
  step?: BrowserStep
  live?: boolean
  left?: Kept | null
  open?: boolean
  /** Where the page it shows is kept as the reply goes: the chat, and the reply's picture there. */
  keep?: { chat: string; frame: string }
}) {
  const screen = useScreen(profile)
  const control = useControl(profile)
  const size = sizeOf(screen)
  const still = useStill(profile, live && !!screen?.running && control === 'agent')
  const drawn = useDrawn(profile, still, size, control === 'agent' ? step : undefined)
  const opening = live && control === 'agent' && !(drawn && still)
  useKeeping(keep?.chat, keep?.frame, live && drawn && control === 'agent' ? still : null, size)
  const tag =
    control === 'you'
      ? 'You’re in control'
      : control === 'elsewhere'
        ? 'In control on another device'
        : opening
          ? 'Opening'
          : 'Live'
  // The page it left settles over the last one it showed, which then goes.
  const page = live ? null : left
  const [settled, setSettled] = useState<string>()
  const under = drawn && (live || !page || settled !== page.src) ? still : null
  const origin = useRef<HTMLButtonElement>(null)
  const [big, setBig] = useState(false)
  const browser = live || (open && !!screen?.running)
  const where = site ?? 'the page'
  return (
    <>
      <button
        ref={origin}
        type="button"
        onClick={() => (browser ? openViewer({ profile, agent, site, reason }) : page && setBig(true))}
        aria-label={
          live ? `Watch ${agent.name} in the browser` : browser ? `Open ${agent.name}’s browser` : `See ${where} as ${agent.name} left it`
        }
        className="group pressable relative block w-full overflow-hidden rounded-[14px] text-left"
      >
        <Still src={under} size={size} shape={page && !under ? page : undefined} dim={live && control !== 'agent'} page />
        {page && (
          <img
            key={page.src}
            src={page.src}
            alt=""
            draggable={false}
            onAnimationEnd={() => setSettled(page.src)}
            className={cn('absolute inset-0 block size-full object-cover object-top select-none', under && 'page-left-in')}
          />
        )}
        <AnimatePresence>{opening && <Opening key="opening" site={site} />}</AnimatePresence>
        {live && !still && control !== 'agent' && (
          // Hermes shows nobody the page while a person has it, so one that arrives then has no picture.
          <BrowserIcon
            size={32}
            className="pointer-events-none absolute inset-x-0 top-[calc(50%-28px)] mx-auto animate-fade text-ink-3"
          />
        )}
        <span className="pointer-events-none absolute inset-0 rounded-[14px] shadow-[inset_0_0_0_0.5px_var(--line-strong)]" />
        <Tag text={tag} site={site} live={control === 'agent' && !opening} left={!live} />
        <span className="glass absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100">
          <Maximize2 size={14} strokeWidth={2} aria-hidden />
        </span>
      </button>
      {big && page && origin.current && (
        <Lightbox
          src={page.src}
          alt={`${where} as ${agent.name} left it`}
          name={site}
          origin={origin.current}
          radius={14}
          onClose={() => setBig(false)}
        />
      )}
    </>
  )
}
