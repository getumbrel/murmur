import { useEffect, useState, type RefObject } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, X } from 'lucide-react'
import { Orb, type OrbState } from '@/ui/orb'
import { cn } from '@/lib/cn'
import type { ChatItem, Speaker } from './types'
import { formatDuration } from './format'

export type HelperItem = Extract<ChatItem, { kind: 'helper' }>
type WakeItem = Extract<ChatItem, { kind: 'wake' }>

const roll = { duration: 0.28, ease: [0.16, 1, 0.3, 1] } as const
const arrive = { type: 'spring', duration: 0.45, bounce: 0.2 } as const
const pop = { type: 'spring', duration: 0.42, bounce: 0.45 } as const

/** Kin of the agent: its hue, nudged a little for each helper. */
const kin = (hue: number, i: number) => (hue + 24 * (i + 1)) % 360

const FACE: Record<HelperItem['status'], OrbState> = {
  running: 'working',
  done: 'idle',
  error: 'error',
  stopped: 'idle',
  back: 'idle',
}

const took = (h: HelperItem) =>
  h.endedAt && h.endedAt - h.startedAt >= 1000 ? formatDuration(h.endedAt - h.startedAt) : ''

/** The first thing a summary says, as plain words: it's written in markdown, often opening on a code block. */
const firstLine = (summary = '') =>
  summary
    .split('\n')
    .filter((l) => !/^\s*(```|~~~)/.test(l))
    .map((l) =>
      l
        .replace(/^[#>*\-\s]+/, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*\*|__|`/g, '')
        .trim(),
    )
    .find(Boolean)

/** The line under a helper's goal: what it's doing, or how it went. */
function lineOf(h: HelperItem, now: number) {
  // Until it says what it's on: just sent, it's getting started; any later (the chat opened mid-errand), it's at work.
  if (h.status === 'running') return h.line ?? (now - h.startedAt < 15_000 ? 'Getting started' : 'Working')
  if (h.status === 'stopped') return 'Stopped'
  if (h.status === 'error') return ['Couldn’t finish', h.line].filter(Boolean).join(' · ')
  if (h.status === 'back') return ['Back', took(h)].filter(Boolean).join(' · ')
  return firstLine(h.summary) || ['Done', took(h)].filter(Boolean).join(' · ')
}

const howMany = (n: number) => (n === 1 ? 'a helper' : `${n} helpers`)

/** "3 helpers finished", or how many didn't. */
function doneLine(all: number, ok: number) {
  const who = all === 1 ? 'Helper' : `${all} helpers`
  if (ok === all) return `${who} finished`
  if (!ok) return `${who} didn’t finish`
  return `${ok} of ${all} helpers finished`
}

/** How long helpers were away, from the first one leaving to the last one back (or now). */
function awayFor(items: HelperItem[], now = 0) {
  const left = Math.min(...items.map((h) => h.startedAt))
  const back = Math.max(...items.map((h) => h.endedAt ?? Math.max(now, h.startedAt)))
  return back - left >= 1000 ? formatDuration(back - left) : ''
}

/** The time, every second while something's counting. */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

/** The card holding any of these helpers, in this scroller. */
const cardOf = (root: ParentNode | null | undefined, ids: string[]) =>
  ids
    .map((id) => root?.querySelector(`[data-helper="${CSS.escape(id)}"]`)?.closest<HTMLElement>('[data-helpers]'))
    .find(Boolean)

// (Mixed rather than --accent-soft, which light mode computes inside oklch(): that won't ease.)
const lit = (line: number, halo: number) =>
  `0 0 0 ${line}px color-mix(in oklab, var(--accent) 60%, transparent), 0 0 0 ${halo}px color-mix(in oklab, var(--accent) 12%, transparent)`
const RING = lit(1.5, 6)
const UNLIT = lit(0, 0)

/** Brings the helpers' card into view, and lights it up a moment, once it's there, so the eye lands on it. */
function showCard(root: ParentNode | null | undefined, ids: string[], reduce: boolean) {
  const card = cardOf(root, ids)
  if (!card) return
  card.scrollIntoView({ behavior: reduce ? 'instant' : 'smooth', block: 'center' })
  if (reduce) return
  card.animate(
    [
      { boxShadow: UNLIT, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      { boxShadow: RING, offset: 0.2 },
      { boxShadow: RING, offset: 0.55, easing: 'ease-in-out' },
      { boxShadow: UNLIT },
    ],
    { duration: 1800, delay: 380 },
  )
}

/** The agent with its helpers beside it, a little smaller, shoulder to shoulder. */
function Huddle({ items, agent, hue, size }: { items: HelperItem[]; agent?: Speaker; hue: number; size: number }) {
  const ok = items.every((h) => h.status === 'done')
  return (
    <span className="flex flex-none items-end" aria-hidden>
      <Orb hue={hue} size={size} seed={agent?.id} state={ok ? 'done' : 'idle'} className="relative z-10" />
      <Faces items={items} hue={hue} size={Math.round(size * 0.68)} className="-ml-1.5" />
    </span>
  )
}

function Faces({
  items,
  hue,
  size,
  className,
}: {
  items: HelperItem[]
  hue: number
  size: number
  className?: string
}) {
  return (
    <span className={cn('flex flex-none items-end', className)} aria-hidden>
      {items.slice(0, 4).map((h, i) => (
        <span key={h.id} className="relative" style={{ marginLeft: i ? -Math.round(size * 0.3) : 0, zIndex: 4 - i }}>
          <Orb hue={kin(hue, i)} size={size} seed={h.subagentId} state={FACE[h.status]} />
        </span>
      ))}
    </span>
  )
}

/**
 * The helpers an agent sent off, as one card in its name: "Zaira is working
 * with 2 helpers", and a tile for each, its own little buddy in the agent's
 * colours, what it was asked and one live line. Stop calls one back. Helpers
 * work in the background, past the end of the reply that sent them: the card
 * stays where they were sent, and says how each one went once they're back.
 */
export function Helpers({
  items,
  agent,
  hue,
  live,
  onStop,
}: {
  items: HelperItem[]
  agent?: Speaker
  hue: number
  live: boolean
  onStop?: (subagentId: string) => void
}) {
  const reduce = useReducedMotion()
  // Arriving as it happens, the card unfolds; read back from history, it's simply there.
  const [arriving] = useState(live)
  const out = items.some((h) => h.status === 'running')
  const now = useNow(out)
  const who = howMany(items.length)
  const title = agent
    ? `${agent.name} ${out ? 'is working' : 'worked'} with ${who}`
    : `${out ? 'Working' : 'Worked'} with ${who}`
  return (
    <motion.section
      data-helpers=""
      aria-label={title}
      initial={arriving && !reduce ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="scroll-mt-20 rounded-[20px] bg-fill-1 p-1.5"
    >
      <header className="flex h-11 items-center gap-2.5 pr-3 pl-2">
        <Huddle items={items} agent={agent} hue={hue} size={28} />
        <h3 className="min-w-0 flex-1 truncate text-subhead font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        <span className="hidden flex-none text-footnote text-ink-3 tabular-nums sm:block">{awayFor(items, now)}</span>
      </header>
      <ul className="flex flex-col gap-1" aria-label="Helpers">
        {items.map((h, i) => (
          // One working in the background can be called back after the turn that sent it.
          <Tile
            key={h.id}
            h={h}
            i={i}
            hue={hue}
            now={now}
            arriving={arriving}
            onStop={live || h.background ? onStop : undefined}
          />
        ))}
      </ul>
    </motion.section>
  )
}

function Tile({
  h,
  i,
  hue,
  now,
  arriving,
  onStop,
}: {
  h: HelperItem
  i: number
  hue: number
  now: number
  arriving: boolean
  onStop?: (subagentId: string) => void
}) {
  const reduce = useReducedMotion()
  const running = h.status === 'running'
  const line = lineOf(h, now)
  const goal = h.goal || 'Helping out'
  return (
    <motion.li
      data-helper={h.id}
      layout="position"
      initial={!arriving ? false : reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0.15 } : { ...arrive, delay: Math.min(i, 4) * 0.06 }}
      className="group/helper flex items-start gap-3 rounded-[14px] bg-elevated py-2.5 pr-2.5 pl-3 shadow-[inset_0_0_0_0.5px_var(--line)]"
    >
      <Orb hue={kin(hue, i)} size={24} seed={h.subagentId} state={FACE[h.status]} className="mt-px flex-none" />
      <div className="min-w-0 flex-1">
        <p title={goal} className="line-clamp-2 text-footnote text-ink sm:line-clamp-1">
          {goal}
        </p>
        {running ? (
          <div className="relative mt-0.5 h-4 overflow-hidden" aria-live="polite">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={line}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: roll }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, transition: { ...roll, duration: 0.2 } }}
                className="truncate text-caption text-shimmer"
              >
                {line}
              </motion.p>
            </AnimatePresence>
          </div>
        ) : (
          <p className={cn('mt-0.5 line-clamp-2 text-caption', h.status === 'error' ? 'text-danger' : 'text-ink-3')}>
            {line}
          </p>
        )}
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        {running ? (
          <motion.span
            key="out"
            exit={{ opacity: 0, scale: 0.6 }}
            // With a pointer, Stop shows on hover, in place of how far along it is.
            className={cn('relative flex h-[18px] flex-none items-center justify-end gap-1', onStop && 'min-w-6')}
          >
            {h.tools > 0 && (
              <span
                className={cn(
                  'mr-0.5 hidden text-caption text-ink-3 tabular-nums transition-opacity sm:block',
                  onStop &&
                    '[@media(hover:hover)]:group-focus-within/helper:opacity-0 [@media(hover:hover)]:group-hover/helper:opacity-0',
                )}
              >
                {h.tools} {h.tools === 1 ? 'step' : 'steps'}
              </span>
            )}
            {onStop && (
              <button
                type="button"
                onClick={() => onStop(h.subagentId)}
                disabled={h.line === 'Stopping'}
                aria-label={`Stop helper: ${goal}`}
                title="Stop"
                className="pressable relative flex size-6 items-center justify-center rounded-full text-ink-3 transition-opacity after:absolute after:-inset-2 hover:bg-fill-2 hover:text-ink-2 disabled:opacity-40 [@media(hover:hover)]:absolute [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:right-0 [@media(hover:hover)]:-translate-y-1/2 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/helper:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            )}
          </motion.span>
        ) : h.status === 'done' || h.status === 'error' ? (
          <motion.span
            key={h.status}
            initial={arriving ? { scale: 0.4, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={pop}
            className={cn(
              'mt-px mr-0.5 flex size-5 flex-none items-center justify-center rounded-full',
              h.status === 'done' ? 'bg-accent text-accent-ink' : 'bg-danger/12 text-danger',
            )}
          >
            {h.status === 'done' ? (
              <Check size={12} strokeWidth={3} aria-hidden />
            ) : (
              <X size={12} strokeWidth={3} aria-hidden />
            )}
            <span className="sr-only">{h.status === 'done' ? 'Done' : 'Didn’t finish'}</span>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.li>
  )
}

/**
 * Helpers back from the background: one quiet line opening the turn Hermes
 * wakes the agent with, their faces and how it went. Their card is where they
 * were sent; the line takes you there.
 */
export function HelpersBack({ items, back, hue }: { items: HelperItem[]; back: WakeItem; hue: number }) {
  const reduce = useReducedMotion()
  const all = back.helpers ?? items.length
  const ok = all - (back.failed ?? 0)
  const away = back.took != null && back.took >= 1000 ? formatDuration(back.took) : items.length ? awayFor(items) : ''
  // Their faces, the same as on their card; ones out of view are drawn from who the wake says went.
  const faces: HelperItem[] = items.length
    ? items
    : Array.from({ length: Math.min(all, 4) }, (_, i) => {
        const subagentId = back.subagentIds?.[i] ?? `${back.delegationId ?? back.id}-${i}`
        return { kind: 'helper', id: subagentId, subagentId, goal: '', status: 'done', tools: 0, startedAt: 0 }
      })
  return (
    <button
      type="button"
      disabled={!items.length}
      onClick={(e) =>
        showCard(
          e.currentTarget.closest('[role=log]'),
          items.map((h) => h.id),
          !!reduce,
        )
      }
      className={cn(
        'group relative -mx-1 flex h-8 max-w-full items-center gap-2 self-start rounded-full px-1 text-left text-subhead text-ink-3 transition-colors duration-150 after:absolute after:-inset-y-1.5 after:inset-x-0',
        items.length > 0 && 'hover:text-ink-2',
      )}
    >
      <span className="flex flex-none -space-x-1.5">
        {faces.slice(0, 4).map((h, i) => (
          <Orb key={h.id} hue={kin(hue, i)} size={20} seed={h.subagentId} state={FACE[h.status]} />
        ))}
      </span>
      <span className="truncate">{[doneLine(all, ok), away].filter(Boolean).join(' · ')}</span>
    </button>
  )
}

/**
 * Whether the card holding any of these helpers is in sight in the scroller
 * (below the floating header, above the composer).
 */
export function useCardInSight(scrollRef: RefObject<HTMLElement | null>, ids: string[], under: number) {
  const key = ids.join(' ')
  const [inSight, setInSight] = useState(true)
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !key) return
    const cards = new Set(key.split(' ').flatMap((id) => cardOf(root, [id]) ?? []))
    // Nowhere to take you: nothing to point at either.
    if (!cards.size) return setInSight(true)
    const seen = new Map<Element, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target, e.isIntersecting)
        setInSight([...seen.values()].some(Boolean))
      },
      { root, rootMargin: `-64px 0px -${Math.max(0, under)}px 0px` },
    )
    cards.forEach((c) => io.observe(c))
    return () => io.disconnect()
  }, [scrollRef, key, under])
  return inSight
}

/**
 * While helpers are out and their card is out of sight: who's working and
 * for how long, floating over the composer. Tap it to go to their card.
 */
export function HelperPill({
  items,
  agent,
  hue,
  scrollRef,
}: {
  /** The helpers sent off with the ones still out (for how far along they are). */
  items: HelperItem[]
  agent?: Speaker
  hue: number
  scrollRef: RefObject<HTMLElement | null>
}) {
  const reduce = useReducedMotion()
  const out = items.filter((h) => h.status === 'running')
  const now = useNow(out.length > 0)
  const working = `${out.length} ${out.length === 1 ? 'helper' : 'helpers'} working`
  return (
    <button
      type="button"
      onClick={() =>
        showCard(
          scrollRef.current,
          out.map((h) => h.id),
          !!reduce,
        )
      }
      className="glass pressable relative flex h-9 max-w-full items-center gap-2 rounded-full pr-2.5 pl-1.5 shadow-float ring-[0.5px] ring-line-strong after:absolute after:-inset-1"
    >
      <Huddle items={items} agent={agent} hue={hue} size={22} />
      <span className="truncate text-footnote font-medium text-ink">{working}</span>
      <span className="flex-none text-footnote text-ink-3 tabular-nums">{awayFor(items, now)}</span>
      <Progress done={items.length - out.length} total={items.length} />
    </button>
  )
}

/** How many are back, as a ring filling up. */
function Progress({ done, total }: { done: number; total: number }) {
  const r = 6.5
  const c = 2 * Math.PI * r
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden className="flex-none -rotate-90 text-accent">
      <circle cx="8.5" cy="8.5" r={r} fill="none" stroke="var(--fill-3)" strokeWidth="2" />
      <circle
        cx="8.5"
        cy="8.5"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${Math.max(c * (done / total), c * 0.08)} ${c}`}
        className="transition-[stroke-dasharray] duration-500 ease-(--ease-sheet)"
      />
    </svg>
  )
}
