import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, ChevronRight, X } from 'lucide-react'
import { Orb, type OrbState } from '@/ui/orb'
import { cn } from '@/lib/cn'
import type { ChatItem } from './types'
import { formatDuration } from './format'

export type HelperItem = Extract<ChatItem, { kind: 'helper' }>

const roll = { duration: 0.28, ease: [0.16, 1, 0.3, 1] } as const
const arrive = { type: 'spring', duration: 0.45, bounce: 0.2 } as const
const spring = { type: 'spring', duration: 0.35, bounce: 0 } as const

/** Kin of the agent: its hue, nudged a little for each helper. */
const kin = (hue: number, i: number) => (hue + 24 * (i + 1)) % 360

const FACE: Record<HelperItem['status'], OrbState> = {
  running: 'working',
  done: 'idle',
  error: 'error',
  stopped: 'idle',
}

/** The one line under a helper's goal: what it's doing, or how it went. */
function lineOf(h: HelperItem) {
  if (h.status === 'running') return h.line ?? 'Getting started'
  if (h.status === 'stopped') return 'Stopped'
  if (h.status === 'error') return 'Didn’t finish'
  const took = h.endedAt && h.endedAt - h.startedAt >= 1000 ? formatDuration(h.endedAt - h.startedAt) : ''
  const first = h.summary
    ?.split('\n')
    .find((l) => l.trim())
    ?.replace(/^[#>*\-\s]+/, '')
  return first || ['Done', took].filter(Boolean).join(' · ')
}

/** Afterwards: "3 helpers finished", or how many didn't. */
function doneLine(items: HelperItem[]) {
  const ok = items.filter((h) => h.status === 'done').length
  const who = items.length === 1 ? 'Helper' : `${items.length} helpers`
  if (ok === items.length) return `${who} finished`
  return `${who} · ${ok} finished`
}

/**
 * The helpers the agent sent off, as small cards: each its own little buddy
 * in the agent's colours, its goal, and one live line. Stop calls one back.
 * Once they're all back and the reply is done, they fold into one line.
 */
export function Helpers({
  items,
  hue,
  live,
  onStop,
}: {
  items: HelperItem[]
  hue: number
  live: boolean
  onStop?: (subagentId: string) => void
}) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const folded = !live && !items.some((h) => h.status === 'running')
  const shown = !folded || open
  return (
    <div>
      <AnimatePresence initial={false}>
        {folded && (
          <motion.button
            key="line"
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="group relative -mx-1 flex h-8 max-w-full items-center gap-2 rounded-full px-1 text-left text-subhead text-ink-3 transition-colors duration-150 after:absolute after:-inset-y-1.5 after:inset-x-0 hover:text-ink-2"
          >
            <span className="flex flex-none -space-x-1.5">
              {items.slice(0, 4).map((h, i) => (
                <Orb key={h.id} hue={kin(hue, i)} size={20} seed={h.subagentId} />
              ))}
            </span>
            <span className="truncate">{doneLine(items)}</span>
            <ChevronRight
              size={14}
              strokeWidth={2}
              aria-hidden
              className={cn('flex-none transition-transform duration-300 ease-(--ease-sheet)', open && 'rotate-90')}
            />
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {shown && (
          <motion.ul
            key="cards"
            aria-label="Helpers"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{
              height: 0,
              opacity: 0,
              transition: reduce ? { duration: 0 } : { height: spring, opacity: { duration: 0.14 } },
            }}
            transition={reduce ? { duration: 0.12 } : { height: spring, opacity: { duration: 0.22 } }}
            className={cn('flex flex-col gap-1.5 overflow-hidden', folded && 'pt-2')}
          >
            {items.map((h, i) => (
              <Card key={h.id} h={h} i={i} hue={hue} onStop={live ? onStop : undefined} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

function Card({ h, i, hue, onStop }: { h: HelperItem; i: number; hue: number; onStop?: (subagentId: string) => void }) {
  const reduce = useReducedMotion()
  const running = h.status === 'running'
  const line = lineOf(h)
  return (
    <motion.li
      layout="position"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0.15 } : { ...arrive, delay: Math.min(i, 4) * 0.06 }}
      className="group/helper flex items-center gap-3 rounded-[18px] bg-fill-1 py-2.5 pr-2.5 pl-3"
    >
      <Orb hue={kin(hue, i)} size={28} seed={h.subagentId} state={FACE[h.status]} className="flex-none" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-footnote font-medium text-ink">{h.goal}</p>
        <div className="relative h-4 overflow-hidden" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={line}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: roll }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, transition: { ...roll, duration: 0.2 } }}
              className={cn('truncate text-caption', running ? 'text-shimmer' : 'text-ink-3')}
            >
              {line}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        {running && onStop ? (
          <motion.button
            key="stop"
            type="button"
            onClick={() => onStop(h.subagentId)}
            disabled={h.line === 'Stopping'}
            aria-label={`Stop helper: ${h.goal}`}
            title="Stop"
            exit={{ opacity: 0, scale: 0.6 }}
            className="pressable relative flex size-7 flex-none items-center justify-center rounded-full text-ink-3 transition-opacity after:absolute after:-inset-2 hover:bg-fill-2 hover:text-ink-2 disabled:opacity-40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/helper:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
          >
            <X size={15} strokeWidth={2} aria-hidden />
          </motion.button>
        ) : h.status === 'done' ? (
          <motion.span
            key="done"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', duration: 0.42, bounce: 0.45 }}
            className="mr-1 flex size-5 flex-none items-center justify-center rounded-full bg-accent text-accent-ink"
          >
            <Check size={12} strokeWidth={3} aria-hidden />
            <span className="sr-only">Done</span>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.li>
  )
}
