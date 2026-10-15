import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ChatItem, Todo } from './types'
import './work.css'

type PlanItem = Extract<ChatItem, { kind: 'plan' }>

const spring = { type: 'spring', duration: 0.35, bounce: 0 } as const
const pop = { type: 'spring', duration: 0.42, bounce: 0.45 } as const
const ease = [0.16, 1, 0.3, 1] as const

/** "3 of 5": cancelled items don't count either way. */
export function progressOf(todos: Todo[]) {
  const counted = todos.filter((t) => t.status !== 'cancelled')
  return { done: counted.filter((t) => t.status === 'completed').length, total: counted.length }
}

/**
 * The agent's checklist for this turn. While it works, a small card that
 * ticks itself off; once the reply is done, one quiet line ("Plan · 5 of 5
 * done") that opens back into the list.
 */
export function Plan({ item, live }: { item: PlanItem; live: boolean }) {
  const [open, setOpen] = useState(false)
  const reduce = useReducedMotion()
  const expanded = live || open
  const { done, total } = progressOf(item.todos)
  const finished = total > 0 && done === total

  return (
    <motion.div
      // A card while it's live, the same edges as the helpers; afterwards it lets
      // go of its padding so its line sits with the other steps.
      className="rounded-[18px]"
      initial={false}
      animate={{
        backgroundColor: live ? 'var(--fill-1)' : 'rgba(0,0,0,0)',
        paddingTop: live ? 8 : 0,
        paddingBottom: live ? 10 : 0,
        paddingLeft: live ? 12 : 0,
        paddingRight: live ? 14 : 0,
      }}
      transition={reduce ? { duration: 0.15 } : spring}
    >
      <button
        type="button"
        disabled={live}
        aria-expanded={live ? undefined : open}
        onClick={() => setOpen(!open)}
        className={cn(
          'group relative flex h-8 max-w-full items-center gap-2 text-left text-subhead after:absolute after:-inset-y-1.5 after:inset-x-0',
          live ? 'w-full text-ink-2' : 'text-ink-3 transition-colors duration-150 hover:text-ink-2',
        )}
      >
        <Ring done={done} total={total} />
        <span className="truncate">
          {live ? 'Plan' : finished ? `Plan · All ${total} done` : `Plan · ${done} of ${total} done`}
        </span>
        {live ? (
          <span className="ml-auto pl-3 text-footnote text-ink-3 tabular-nums">
            {done} of {total}
          </span>
        ) : (
          <ChevronRight
            size={14}
            strokeWidth={2}
            aria-hidden
            className={cn('flex-none transition-transform duration-300 ease-(--ease-sheet)', open && 'rotate-90')}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ol
            key="todos"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{
              height: 0,
              opacity: 0,
              transition: reduce ? { duration: 0 } : { height: spring, opacity: { duration: 0.14 } },
            }}
            transition={reduce ? { duration: 0.12 } : { height: spring, opacity: { duration: 0.22, delay: 0.04 } }}
            className="overflow-hidden"
          >
            {item.todos.map((todo) => (
              <Row key={todo.id} todo={todo} live={live} nested={!!todo.parent} />
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function Row({ todo, live, nested }: { todo: Todo; live: boolean; nested: boolean }) {
  const done = todo.status === 'completed'
  const gone = todo.status === 'cancelled'
  const now = todo.status === 'in_progress' && live
  return (
    <motion.li
      layout="position"
      // New items join the list the way steps do.
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease }}
      className={cn('flex min-h-7 items-start gap-2.5 py-[3px]', nested && 'pl-[26px]')}
    >
      <Check status={todo.status} live={live} />
      {/* Ticked off: the words fade back and a strike settles through them. */}
      <span
        className={cn(
          // (No strike until it's ticked: the shimmer would paint it.)
          'min-w-0 pt-px text-footnote leading-[18px] transition-colors duration-500 ease-(--ease-out)',
          done || gone ? 'text-ink-3 line-through decoration-ink-3/70' : now ? 'text-ink' : 'text-ink-2',
        )}
      >
        <span className={cn(now && 'text-shimmer')}>{todo.content}</span>
      </span>
      <span className="sr-only">{done ? ', done' : gone ? ', dropped' : now ? ', in progress' : ''}</span>
    </motion.li>
  )
}

/** Empty, spinning while it's the one being done, then a filled check that pops in. */
function Check({ status, live }: { status: Todo['status']; live: boolean }) {
  const done = status === 'completed'
  return (
    <span aria-hidden className="relative mt-px flex size-4 flex-none items-center justify-center">
      <span
        className={cn(
          'absolute inset-0 rounded-full ring-[1.5px] transition-[box-shadow,opacity] duration-200 ring-inset',
          status === 'cancelled' ? 'ring-line-strong opacity-60' : 'ring-line-strong',
          done && 'opacity-0',
        )}
      />
      {status === 'in_progress' && live && (
        <svg viewBox="0 0 16 16" className="absolute inset-0 text-accent">
          <circle
            cx="8"
            cy="8"
            r="7.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            pathLength={1}
            className="step-ring"
          />
        </svg>
      )}
      <AnimatePresence initial={false}>
        {done && (
          <motion.svg
            key="done"
            viewBox="0 0 16 16"
            className="absolute inset-0 text-accent"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.15 } }}
            transition={pop}
          >
            <circle cx="8" cy="8" r="8" fill="currentColor" />
            <motion.path
              d="M4.9 8.3l2.1 2.1 4.2-4.6"
              fill="none"
              stroke="var(--accent-ink)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.22, ease, delay: 0.08 }}
            />
          </motion.svg>
        )}
      </AnimatePresence>
    </span>
  )
}

/** How far along the plan is, as a ring that fills, and closes on a check. */
function Ring({ done, total }: { done: number; total: number }) {
  const share = total ? done / total : 0
  if (total && done === total)
    return (
      <motion.svg
        width="18"
        height="18"
        viewBox="0 0 16 16"
        aria-hidden
        className="flex-none text-accent"
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={pop}
      >
        <circle cx="8" cy="8" r="8" fill="currentColor" />
        <path
          d="M4.9 8.3l2.1 2.1 4.2-4.6"
          fill="none"
          stroke="var(--accent-ink)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </motion.svg>
    )
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="flex-none -rotate-90 text-accent">
      <circle cx="9" cy="9" r="7" fill="none" stroke="var(--fill-3)" strokeWidth="2" />
      <motion.circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: share, opacity: share ? 1 : 0 }}
        transition={spring}
      />
    </svg>
  )
}
