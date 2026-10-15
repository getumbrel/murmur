import type { CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Sheet } from '@/ui/sheet'
import { ListGroup, ListRow } from '@/ui/list'
import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import {
  contextWorthShowing,
  money,
  tokensText,
  useContextBreakdown,
  type ChatUsage,
  type Slice,
} from '@/state/insights'

// How much room a chat has left, and what it's cost. Only past half full does
// a small ring show in the composer; any time, the chat's menu opens the same
// sheet, where the ring is big and the room is broken down.

const FULL = 80

/** A ring that fills as the agent's room in this chat does. */
function Ring({ value, size, stroke, className }: { value: number; size: number; stroke: number; className?: string }) {
  const reduce = useReducedMotion()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className={cn('-rotate-90', className)}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-fill-3" />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        className={value >= FULL ? 'stroke-warning' : 'stroke-current'}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - Math.max(0.02, value / 100)) }}
        transition={reduce ? { duration: 0 } : { type: 'spring', duration: 0.8, bounce: 0 }}
      />
    </svg>
  )
}

/** Beside the model chip, once the chat is past half full. */
export function ContextRing({ usage, onClick }: { usage?: ChatUsage; onClick: () => void }) {
  const shown = contextWorthShowing(usage)
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.button
          type="button"
          onClick={onClick}
          aria-label={`${usage!.context}% of this chat’s room used`}
          title={`${usage!.context}% full`}
          className="pressable relative flex h-9 flex-none items-center gap-1.5 rounded-full px-2.5 text-footnote font-medium text-ink-3 tabular-nums select-none after:absolute after:-inset-y-1 after:inset-x-0 hover:bg-fill-2 hover:text-ink-2"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
        >
          <Ring value={usage!.context!} size={15} stroke={2.5} />
          {/* The number too: a lone arc reads as a spinner. */}
          {usage!.context}%
        </motion.button>
      )}
    </AnimatePresence>
  )
}

/** Each part of the room in the agent's own colour, the chat itself boldest. */
const SHADE: Record<Slice['id'], number> = { chat: 1, tools: 0.62, instructions: 0.42, skills: 0.3, memory: 0.22 }
const shade = (id: Slice['id']) => `color-mix(in oklab, var(--accent) ${SHADE[id] * 100}%, transparent)`

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: { name: string; hue: number }
  usage?: ChatUsage
  /** The chat's live id in Hermes, for what's taking up its room. */
  runtimeId?: string
}

export function ChatInfoSheet({ open, onOpenChange, agent, usage, runtimeId }: Props) {
  const breakdown = useContextBreakdown(runtimeId, open)
  const slices = breakdown.data?.slices ?? []
  const total = slices.reduce((n, s) => n + s.tokens, 0)
  const context = usage?.context
  const full = (context ?? 0) >= FULL

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="This chat" width={420}>
      <div className="hue-scope space-y-7 pt-1" style={{ '--hue': agent.hue } as CSSProperties}>
        <div className="flex flex-col items-center text-center">
          <div className="relative grid place-items-center text-accent">
            <Ring value={context ?? 0} size={120} stroke={10} />
            <span className="absolute inset-0 grid place-items-center">
              <span className="text-large font-semibold tracking-[-0.03em] text-ink tabular-nums">
                {context === undefined ? '—' : `${context}%`}
              </span>
            </span>
          </div>
          <p className="mt-4 max-w-72 text-subhead text-balance text-ink-2">
            {context === undefined
              ? `${agent.name} hasn’t needed much room here yet.`
              : full
                ? `Getting full. ${agent.name} will tidy older messages away to make room.`
                : `of what ${agent.name} can keep in mind`}
          </p>
        </div>

        {(breakdown.isPending && open && runtimeId) || slices.length > 0 ? (
          <section aria-label="What’s taking up room">
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-fill-2">
              {breakdown.isPending ? (
                <Skeleton className="h-full w-full" />
              ) : (
                slices.map((s, i) => (
                  <motion.span
                    key={s.id}
                    className="h-full origin-left first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${(s.tokens / total) * 100}%`, background: shade(s.id) }}
                    initial={{ opacity: 0, scaleX: 0.6 }}
                    animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.04 }}
                  />
                ))
              )}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 px-1">
              {slices.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-footnote">
                  <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: shade(s.id) }} />
                  <span className="min-w-0 flex-1 truncate text-ink-2">{s.label}</span>
                  <span className="text-ink-3 tabular-nums">{tokensText(s.tokens)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {(usage?.cost !== undefined || usage?.included || !!usage?.compressions) && (
          <ListGroup>
            {usage?.cost !== undefined && (
              <ListRow title="Spent" detail={<span className="tabular-nums">≈ {money(usage.cost)}</span>} />
            )}
            {usage?.included && <ListRow title="Spent" detail="Covered by your plan" />}
            {!!usage?.compressions && (
              <ListRow title="Made room" detail={usage.compressions === 1 ? 'Once' : `${usage.compressions} times`} />
            )}
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}
