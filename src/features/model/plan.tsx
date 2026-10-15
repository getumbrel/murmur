import { Moon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { planUsageLine, untilText, type PlanUsage } from '@/state/limits'

// A plan's headroom at a glance, and the calm way a service that hit its
// limit says when it's back. Used wherever services and models are listed.

/** A tiny capsule that empties as the plan is used: warm when it's running low. */
export function PlanGauge({ left, className }: { left: number; className?: string }) {
  const low = left < 20
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-block h-1.5 w-6 flex-none overflow-hidden rounded-full bg-fill-3 align-middle',
        className,
      )}
    >
      <span
        className={cn(
          'absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-700 ease-[var(--ease-out)] motion-reduce:transition-none',
          low ? 'bg-warning' : 'bg-ink-3',
        )}
        style={{ transform: `scaleX(${Math.max(0.04, left / 100)})` }}
      />
    </span>
  )
}

/** "Resting until 5 PM", with a moon: nothing's broken, it's just waiting out a limit. */
export function Resting({ until, className }: { until: Date; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Moon size={12} strokeWidth={2.25} aria-hidden className="flex-none text-ink-3" />
      <span className="truncate">
        {/* Narrow rows keep the moon and the time; the moon already says it's resting. */}
        <span className="max-[479px]:hidden">Resting </span>until {untilText(until)}
      </span>
    </span>
  )
}

/** A service's name over its models, with how much of its plan is left (or when it's back) on the right. */
export function ServiceHeading({ name, plan, resting }: { name: string; plan?: PlanUsage | null; resting?: Date }) {
  const line = plan ? planUsageLine(plan) : null
  return (
    <h3 className="mb-2 flex items-center justify-between gap-3 px-4 text-footnote font-medium text-ink-2">
      <span className="truncate">{name}</span>
      {resting ? (
        <Resting until={resting} className="animate-fade font-normal text-ink-3" />
      ) : line ? (
        <span className="flex flex-none animate-fade items-center gap-1.5 font-normal text-ink-3 tabular-nums">
          <PlanGauge left={line.left} />
          {line.left >= 50 ? 'Plenty left' : `${line.left}% left`}
        </span>
      ) : null}
    </h3>
  )
}
