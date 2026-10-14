import { motion, useReducedMotion } from 'motion/react'
import { useId, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'

type Option<T extends string> = { value: T; label: string }

// The thumb glides between segments on a spring and gives a little under your
// finger when you press the selected one. Arrow keys move the selection.
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  /** What the choice is about, for screen readers ("Repeat"). */
  label?: string
  className?: string
}) {
  const id = useId()
  const reduce = useReducedMotion()

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = options.findIndex((o) => o.value === value)
    const next = options[(i + step + options.length) % options.length]
    onChange(next.value)
    e.currentTarget.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex rounded-full bg-fill-2 p-1', className)}
    >
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            type="button"
            key={o.value}
            role="radio"
            aria-checked={active}
            tabIndex={active || (i === 0 && !options.some((x) => x.value === value)) ? 0 : -1}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'group relative h-8 min-w-0 flex-1 rounded-full px-3 text-footnote select-none transition-[color,font-weight] duration-200',
              active ? 'font-semibold text-ink' : 'font-medium text-ink-2 hover:text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId={id}
                className="absolute inset-0"
                transition={reduce ? { duration: 0 } : { type: 'spring', visualDuration: 0.3, bounce: 0.18 }}
              >
                <span className="block size-full rounded-full bg-elevated shadow-[0_1px_2px_rgb(0_0_0/0.08),0_2px_8px_-2px_rgb(0_0_0/0.08),0_0_0_0.5px_var(--line)] transition-[scale] duration-300 ease-spring-soft group-active:scale-[0.95] group-active:duration-150" />
              </motion.span>
            )}
            <span className="relative block truncate">
              {o.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
