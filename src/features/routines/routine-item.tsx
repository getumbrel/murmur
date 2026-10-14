import { useEffect, useRef } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from 'motion/react'
import { MoreHorizontal } from 'lucide-react'
import { Toggle } from '@/ui/toggle'
import { cn } from '@/lib/cn'
import { useRunningNow, type Routine } from '@/state/routines'
import { Glyph } from './glyph'
import { iconFor } from './templates'
import { capitalize, describeNext, describeWhen } from './schedule'
import './routines.css'

const ACTION = 84
const REVEAL = ACTION * 2
const snap = { type: 'spring', stiffness: 500, damping: 42 } as const

/** What's going on with a routine, in a few words. */
export function routineStatus(
  r: Routine,
  running: boolean,
  /** Say "next" on this zone's calendar (the agent's), not the browser's. */
  zone?: string,
): { text: string; tone: 'live' | 'muted' | 'danger' | 'plain' } {
  if (running) return { text: 'Working on it now', tone: 'live' }
  if (r.done) return { text: 'Done', tone: 'muted' }
  if (!r.enabled) return { text: 'Off', tone: 'muted' }
  if (r.lastOk === false) return { text: 'The last run hit a problem', tone: 'danger' }
  const next = describeNext(r.when, r.nextAt, undefined, zone)
  return next ? { text: `Next: ${next}`, tone: 'plain' } : { text: '', tone: 'plain' }
}

export function StatusLine({ routine, zone, className }: { routine: Routine; zone?: string; className?: string }) {
  const running = useRunningNow((s) => Boolean(s.ids[routine.id]))
  const status = routineStatus(routine, running, zone)
  if (!status.text) return null
  return (
    <span
      className={cn(
        'block truncate',
        status.tone === 'live' && 'text-shimmer',
        status.tone === 'danger' && 'text-danger',
        status.tone === 'muted' && 'text-ink-3',
        status.tone === 'plain' && 'text-ink-3',
        className,
      )}
    >
      {status.text}
    </span>
  )
}

/**
 * A routine in the list: tap for details, flip the switch to pause, swipe
 * left (or long-press, or right-click) for Run now and Delete.
 */
export function RoutineItem({
  routine,
  revealed,
  onReveal,
  onOpen,
  onToggle,
  onRunNow,
  onDelete,
  born,
}: {
  routine: Routine
  revealed: boolean
  onReveal: (on: boolean) => void
  onOpen: () => void
  onToggle: (on: boolean) => void
  onRunNow: () => void
  onDelete: () => void
  /** Just created: arrive with a little flourish. */
  born?: boolean
}) {
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const actionsOpacity = useTransform(x, [-REVEAL, -1, 0], [1, 1, 0])
  const press = useRef<ReturnType<typeof setTimeout>>(undefined)
  const longPressed = useRef(false)
  const running = useRunningNow((s) => Boolean(s.ids[routine.id]))

  useEffect(() => {
    const c = animate(x, revealed ? -REVEAL : 0, snap)
    return () => c.stop()
  }, [revealed, x])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const open = info.offset.x < -ACTION / 2 || info.velocity.x < -400
    animate(x, open ? -REVEAL : 0, { ...snap, velocity: info.velocity.x })
    onReveal(open)
  }

  const Icon = iconFor(routine.template, routine.name)

  return (
    <motion.li
      layout
      initial={born && !reduce ? { opacity: 0, scale: 0.97, y: 8 } : { opacity: 0 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={
        born ? { type: 'spring', duration: 0.5, bounce: 0.2 } : { type: 'spring', stiffness: 420, damping: 40 }
      }
      className="group relative overflow-hidden [&+&]:shadow-[inset_0_0.5px_0_var(--line)]"
    >
      <motion.div
        className="absolute inset-y-0 right-0 flex"
        style={{ width: REVEAL, opacity: actionsOpacity }}
        aria-hidden={!revealed}
      >
        <button
          type="button"
          tabIndex={revealed ? 0 : -1}
          disabled={running}
          onClick={() => {
            onReveal(false)
            onRunNow()
          }}
          className="flex flex-1 items-center justify-center bg-accent text-subhead font-medium text-accent-ink disabled:opacity-60"
        >
          Run now
        </button>
        <button
          type="button"
          tabIndex={revealed ? 0 : -1}
          onClick={onDelete}
          className="flex flex-1 items-center justify-center bg-danger text-subhead font-medium text-white"
        >
          Delete
        </button>
      </motion.div>

      <motion.div
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -REVEAL, right: 0 }}
        dragElastic={{ left: 0.12, right: 0 }}
        onDragEnd={onDragEnd}
        className={cn(
          'relative flex items-center bg-elevated [background-image:linear-gradient(var(--fill-1),var(--fill-1))]',
          born && 'routine-born',
        )}
      >
        <button
          type="button"
          onPointerDown={() => {
            longPressed.current = false
            press.current = setTimeout(() => {
              longPressed.current = true
              onReveal(true)
            }, 500)
          }}
          onPointerUp={() => clearTimeout(press.current)}
          onPointerLeave={() => clearTimeout(press.current)}
          onPointerCancel={() => clearTimeout(press.current)}
          onContextMenu={(e) => {
            e.preventDefault()
            onReveal(true)
          }}
          onClick={() => {
            if (longPressed.current) return
            if (revealed) onReveal(false)
            else onOpen()
          }}
          className="flex min-h-[68px] min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-4 text-left transition-colors hover:bg-fill-1 active:bg-fill-2"
        >
          <span className={cn('transition-opacity duration-200', !routine.enabled && !running && 'opacity-45')}>
            <Glyph icon={Icon} size={36} />
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate text-body', !routine.enabled && 'text-ink-2')}>{routine.name}</span>
            <span className="block truncate text-footnote text-ink-2">
              {capitalize(describeWhen(routine.when, routine.scheduleText))}
            </span>
            <StatusLine routine={routine} className="text-caption" />
          </span>
        </button>
        <button
          type="button"
          onClick={() => onReveal(!revealed)}
          tabIndex={revealed ? -1 : 0}
          aria-label={`More for “${routine.name}”`}
          className={cn(
            'pressable hidden size-8 flex-none items-center justify-center rounded-full text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-fill-2 hover:text-ink focus-visible:opacity-100 [@media(hover:hover)]:flex',
            revealed && 'invisible',
          )}
        >
          <MoreHorizontal size={16} strokeWidth={2} />
        </button>
        <span className={cn('flex-none pr-4 pl-1.5', routine.done && 'invisible')}>
          <Toggle checked={routine.enabled} onChange={onToggle} label={`${routine.name} on`} />
        </span>
      </motion.div>
    </motion.li>
  )
}
