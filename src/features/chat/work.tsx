import { memo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Ban, ChevronRight, Clock, ShieldCheck, Sparkle, X } from 'lucide-react'
import { Orb } from '@/ui/orb'
import { cn } from '@/lib/cn'
import type { ChatItem } from './types'
import { didSummary, pastLabel, toolCategory } from './tool-labels'
import { ToolIcon } from './tool-icon'
import { AppIcon } from '@/features/apps/app-icon'
import { formatDuration, formatStep } from './format'
import './work.css'

export type ToolItem = Extract<ChatItem, { kind: 'tool' }>
export type ThinkingItem = Extract<ChatItem, { kind: 'thinking' }>
/** A permission request that has been settled reads as just another step. */
export type ApprovalItem = Extract<ChatItem, { kind: 'approval' }>
export type WorkItem = ToolItem | ThinkingItem | ApprovalItem

const timed = (items: WorkItem[]) => items.filter((i) => i.kind !== 'approval')

const said = (label: string, detail?: string) => (detail ? `${label} · ${detail}` : label)

/** What happened, in human words: "Searched the web · 19s", "Thought for 8s", "Worked for 34s · 5 steps". */
export function summary(items: WorkItem[]) {
  // Still going (say, waiting on your OK): it hasn't happened yet.
  const running = items.findLast((i) => i.kind === 'tool' && i.status === 'running')
  if (running?.kind === 'tool') return said(running.label, running.detail)
  const steps = timed(items)
  if (!steps.length) return items.length ? 'Asked for permission' : 'Worked'
  const ms = Math.max(...steps.map((i) => i.endedAt ?? i.startedAt)) - Math.min(...steps.map((i) => i.startedAt))
  const time = ms >= 1000 ? formatDuration(ms) : ''
  const only = items.length === 1 ? items[0] : undefined
  // A single step says it all: "Read notes.md · 2s".
  if (only?.kind === 'tool') {
    const what = said(pastLabel(only.label), only.detail)
    return only.status === 'error' ? `${what} · Didn’t finish` : time ? `${what} · ${time}` : what
  }
  const tools = steps.flatMap((i) => (i.kind === 'tool' ? [i.name] : []))
  if (!tools.length) return time ? `Thought for ${time}` : 'Thought briefly'
  const did = didSummary(tools)
  if (did) return time ? `${did} · ${time}` : did
  return time ? `Worked for ${time} · ${tools.length} steps` : `${tools.length} steps`
}

function liveLine(items: WorkItem[]) {
  const last = items.at(-1)
  if (last?.kind === 'tool' && last.status === 'running') {
    return { key: last.id, text: said(last.label, last.detail), state: 'working' as const }
  }
  return { key: 'thinking', text: 'Thinking', state: 'thinking' as const }
}

const spring = { type: 'spring', duration: 0.35, bounce: 0 } as const
const swap = { duration: 0.28, ease: [0.16, 1, 0.3, 1] } as const

/**
 * The agent's working steps for one stretch of a turn. Live: a single
 * shimmering present-tense line. Done: what it did ("Searched the web · 19s"),
 * which opens into the step list.
 */
export function Work({ items, live, hue, seed }: { items: WorkItem[]; live: boolean; hue: number; seed?: string }) {
  const [open, setOpen] = useState(false)
  const reduce = useReducedMotion()
  const line = live ? liveLine(items) : null
  // One step is already said in full on the line itself; there's nothing more to open.
  const only = items.length === 1 ? items[0] : undefined
  const canOpen = items.length > 1 || only?.kind === 'approval' || (only?.kind === 'thinking' && !!only.text.trim())
  // Steps already on screen when the list opened don't rise in; ones that arrive while you watch do.
  const shown = useRef(new Set<string>())
  const toggle = () => {
    if (!open) shown.current = new Set(items.map((i) => i.id))
    setOpen(!open)
  }
  const rise = (id: string) => {
    const fresh = !shown.current.has(id)
    shown.current.add(id)
    return fresh && !reduce
  }

  return (
    <div className="-mx-1">
      <button
        type="button"
        disabled={!canOpen}
        aria-expanded={canOpen ? open : undefined}
        onClick={toggle}
        className={cn(
          'group relative flex h-8 max-w-full items-center gap-2 rounded-full px-1 text-left text-subhead outline-offset-0 after:absolute after:-inset-y-1.5 after:inset-x-0',
          !line && 'text-ink-3 transition-colors duration-150',
          !line && canOpen && 'hover:text-ink-2',
        )}
      >
        {line && <Orb hue={hue} size={18} state={line.state} seed={seed} className="flex-none" />}
        <span className="relative min-w-0 overflow-hidden" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={line ? line.key : 'done'}
              className={cn('flex items-center gap-1.5', line && 'text-shimmer')}
              // A short roll: the old line leaves upward as the new one rises in under it.
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0, transition: swap }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -14, transition: { ...swap, duration: 0.2 } }}
            >
              <span className="truncate">{line ? line.text : summary(items)}</span>
              {!line && canOpen && (
                <ChevronRight
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                  className={cn('flex-none transition-transform duration-300 ease-(--ease-sheet)', open && 'rotate-90')}
                />
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="steps"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{
              height: 0,
              opacity: 0,
              transition: reduce ? { duration: 0 } : { height: spring, opacity: { duration: 0.16 } },
            }}
            transition={reduce ? { duration: 0.12 } : { height: spring, opacity: { duration: 0.24, delay: 0.04 } }}
            className="overflow-hidden"
          >
            <ol className="px-1 pt-2 pb-2">
              {items.map((item, i) => (
                <Step key={item.id} item={item} last={i === items.length - 1} live={live} rise={rise(item.id)} />
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const APPROVAL = { approved: 'Allowed', denied: 'Not allowed', expired: 'Timed out', pending: 'Waiting' } as const
const EMAIL_APPROVAL = { approved: 'Send approved', denied: 'Not sent', expired: 'Timed out', pending: 'Waiting' } as const

const Step = memo(function Step({
  item,
  last,
  live,
  rise,
}: {
  item: WorkItem
  last: boolean
  /** While the turn is live, finished steps tick off; afterwards they show what kind of step they were. */
  live: boolean
  rise: boolean
}) {
  const [rising] = useState(rise)
  const running = item.kind === 'tool' ? item.status === 'running' : item.kind === 'thinking' && item.streaming
  const failed = item.kind === 'tool' && item.status === 'error'
  const took = item.kind !== 'approval' && item.endedAt ? formatStep(item.endedAt - item.startedAt) : ''
  // Only a step you watched finish draws its check.
  const watched = useRef(false)
  if (running) watched.current = true

  let icon = <Sparkle size={13} strokeWidth={1.75} aria-hidden />
  let label = running ? 'Thinking' : 'Thought'
  let detail: string | undefined
  if (item.kind === 'tool') {
    icon = item.app ? (
      <AppIcon name={item.app} size={14} className="shadow-none" />
    ) : (
      <ToolIcon category={toolCategory(item.name)} size={13} />
    )
    label = running ? item.label : pastLabel(item.label)
    detail = item.detail
  } else if (item.kind === 'approval') {
    const Icon = item.status === 'approved' ? ShieldCheck : item.status === 'expired' ? Clock : Ban
    icon = <Icon size={13} strokeWidth={1.75} aria-hidden />
    label = item.email ? EMAIL_APPROVAL[item.status] : APPROVAL[item.status]
    detail = item.command ?? item.title
  }
  if (failed) icon = <X size={13} strokeWidth={2} aria-hidden />
  else if (running || (live && watched.current)) icon = <Tick done={!running} />
  else if (watched.current) icon = <span className="flex animate-fade">{icon}</span>

  return (
    <li className={cn('relative flex gap-3 pb-3 last:pb-0', rising && 'animate-step')}>
      {!last && <span aria-hidden className="absolute top-[26px] bottom-0.5 left-[11.5px] w-px bg-line-strong" />}
      <span
        className={cn(
          'relative flex size-6 flex-none items-center justify-center rounded-full',
          failed ? 'bg-danger/12 text-danger' : 'bg-fill-2 text-ink-2',
        )}
      >
        {icon}
      </span>

      <div className="min-w-0 flex-1 pt-[3px]">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 truncate text-footnote text-ink-2">
            {label}
            {detail && (
              <span className={cn('text-ink-3', item.kind === 'approval' && !item.prose && 'font-mono text-caption tracking-normal')}>
                {' · '}
                {detail}
              </span>
            )}
          </p>
          <span className="flex-none text-caption text-ink-3 tabular-nums">{failed ? 'Didn’t finish' : took}</span>
        </div>
        {item.kind === 'thinking' && item.text && <Reasoning text={item.text} />}
      </div>
    </li>
  )
})

/** A thin ring that spins while the step runs, then lets go as a check draws in. */
function Tick({ done }: { done: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden className="absolute inset-0 text-accent">
      <circle
        cx="12"
        cy="12"
        r="11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        pathLength={1}
        className={cn('step-ring', done && 'step-ring-done')}
      />
      {done && (
        <path
          d="M8 12.4l2.6 2.6L16 9.6"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className="step-check"
        />
      )}
    </svg>
  )
}

function Reasoning({ text }: { text: string }) {
  const long = text.length > 420
  const [more, setMore] = useState(false)
  return (
    <div className="mt-1">
      <p className={cn('text-footnote leading-[1.6] whitespace-pre-wrap text-ink-3', long && !more && 'line-clamp-5')}>
        {text.trim()}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          className="relative mt-1 text-footnote font-medium text-ink-2 select-none hover:text-ink after:absolute after:-inset-x-2 after:-inset-y-3"
        >
          {more ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
