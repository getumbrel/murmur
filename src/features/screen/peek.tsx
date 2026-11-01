import './screen.css'
import { motion, useReducedMotion } from 'motion/react'
import { Maximize2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { BrowserIcon } from '@/ui/icons'
import type { Speaker } from '@/features/chat/types'
import { sizeOf, useControl, useScreen, useStill } from '@/state/screen'
import { type BrowserStep, useDrawn } from './drawn'
import { Still } from './live-view'
import { openViewer } from './viewer'

/** The tag over a picture of the agent's browser: "Live · shop.example.com", or who has it. */
function LiveTag({ text, site, live }: { text: string; site?: string; live: boolean }) {
  return (
    <span className="glass pointer-events-none absolute bottom-2.5 left-2.5 flex h-7 max-w-[calc(100%-20px)] items-center gap-1.5 rounded-full px-2.5 text-caption font-medium shadow-[inset_0_0_0_0.5px_var(--line-strong)]">
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
  )
}

/**
 * A window onto the agent's browser (just the page), a fresh still every
 * moment while the agent has it; opens it big. While the person has it, it
 * stays on the last picture, quieted, or shows who has it. For a turn that
 * has just started browsing, it waits for the browser to draw after its first
 * step there (`step`).
 */
export function Peek({
  profile,
  agent,
  site,
  reason,
  step,
}: {
  profile: string
  agent: Speaker
  site?: string
  reason?: string
  step?: BrowserStep
}) {
  const screen = useScreen(profile)
  const control = useControl(profile)
  const size = sizeOf(screen)
  const still = useStill(profile, !!screen?.running && control === 'agent')
  const drawn = useDrawn(profile, still, size, control === 'agent' ? step : undefined)
  const tag =
    control === 'you' ? 'You’re in control' : control === 'elsewhere' ? 'In control on another device' : 'Live'
  return (
    <button
      type="button"
      onClick={() => openViewer({ profile, agent, site, reason })}
      aria-label={`Watch ${agent.name} in the browser`}
      className="group pressable relative block w-full overflow-hidden rounded-[14px] text-left"
    >
      <Still src={drawn ? still : null} size={size} dim={control !== 'agent'} loading={!drawn} page />
      {!still && control !== 'agent' && (
        // Hermes shows nobody the page while a person has it, so one that arrives then has no picture.
        <BrowserIcon
          size={32}
          className="pointer-events-none absolute inset-x-0 top-[calc(50%-28px)] mx-auto animate-fade text-ink-3"
        />
      )}
      <span className="pointer-events-none absolute inset-0 rounded-[14px] shadow-[inset_0_0_0_0.5px_var(--line-strong)]" />
      <LiveTag text={tag} site={site} live={control === 'agent'} />
      <span className="glass absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100">
        <Maximize2 size={14} strokeWidth={2} aria-hidden />
      </span>
    </button>
  )
}

/**
 * The agent's browser while it works in it, under what it's doing: only when
 * there's a screen to show (a browser that runs where nobody can see it shows
 * nothing).
 */
export function BrowserPeek({
  profile,
  agent,
  site,
  step,
}: {
  profile: string
  agent: Speaker
  site?: string
  step: BrowserStep
}) {
  const reduce = useReducedMotion()
  const running = useScreen(profile)?.running
  if (!running) return null
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
      className="max-w-[560px]"
    >
      <Peek profile={profile} agent={agent} site={site} step={step} />
    </motion.div>
  )
}
