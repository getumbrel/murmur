import { motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { Orb } from '@/ui/orb'
import { cn } from '@/lib/cn'
import { TEMPLATES, type Template } from './templates'

// The first thing you see when making an agent: a few ready-made helpers,
// each in its own colour, and a quiet way to start from nothing.

export const orbLayoutId = (from: string) => `template-orb-${from}`

// Six tracks fit two or three cards a row, and let a short last row share its
// width evenly: a lone card spans the row and lies on its side, so the grid
// always ends square whatever the count.
const TRACKS = 6

type Props = {
  onPick: (template: Template) => void
  onScratch: () => void
  /** Each card's Buddy seed: the id the agent it makes will get. */
  seedFor?: (template: Template) => string
  /** Wide sheets fit three across. */
  columns?: 2 | 3
  className?: string
}

export function TemplateGrid({ onPick, onScratch, seedFor, columns = 2, className }: Props) {
  const tail = TEMPLATES.length % columns
  return (
    <div className={className}>
      <p className="animate-fade pb-4 text-subhead text-pretty text-ink-2">
        Start with a helper. You can change anything before it’s made.
      </p>
      <ul className="grid grid-cols-6 gap-3">
        {TEMPLATES.map((t, i) => {
          const span = i >= TEMPLATES.length - tail ? TRACKS / tail : TRACKS / columns
          return (
            <li
              key={t.id}
              className="animate-rise"
              style={{ gridColumn: `span ${span} / span ${span}`, animationDelay: `${40 + i * 35}ms` }}
            >
              <TemplateCard
                template={t}
                seed={seedFor?.(t) ?? t.id}
                onPick={() => onPick(t)}
                wide={span === TRACKS}
              />
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={onScratch}
        style={{ animationDelay: `${40 + TEMPLATES.length * 35}ms` }}
        className="pressable mt-3 flex w-full animate-rise items-center gap-3.5 rounded-2xl p-4 text-left ring-1 ring-line ring-inset hover:bg-fill-1"
      >
        <motion.span
          layoutId={orbLayoutId('scratch')}
          transition={{ type: 'spring', duration: 0.5, bounce: 0.18 }}
          className="grid size-11 flex-none place-items-center rounded-full border-[1.5px] border-dashed border-line-strong text-ink-2"
        >
          <Plus size={18} strokeWidth={1.85} />
        </motion.span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold tracking-[-0.015em]">Start from scratch</span>
          <span className="block truncate text-footnote text-ink-2">Name it and describe it yourself</span>
        </span>
        <ChevronRight size={18} className="flex-none text-ink-3" />
      </button>
    </div>
  )
}

type CardProps = {
  template: Template
  seed: string
  onPick: () => void
  /** Alone on the last row: full width, Buddy beside the words. */
  wide?: boolean
}

function TemplateCard({ template, seed, onPick, wide }: CardProps) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`${template.title}: ${template.promise}`}
      className={cn(
        'hue-scope pressable group relative flex h-full w-full overflow-hidden rounded-2xl p-4 text-left',
        wide ? 'flex-row items-center gap-3.5' : 'flex-col items-start',
        'bg-fill-1 ring-[0.5px] ring-line ring-inset hover:bg-fill-2',
      )}
      style={{ '--hue': template.hue } as CSSProperties}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -top-14 -left-14 size-44 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)] opacity-90 transition-opacity duration-300 group-hover:opacity-100"
      />
      {/* -ml-2: a 44px Buddy's body starts ~8px into its box; this puts it on the title's left edge.
          Lying on its side it lines up with "Start from scratch" below instead: same box, same gap. */}
      <motion.span
        layoutId={orbLayoutId(template.id)}
        transition={{ type: 'spring', duration: 0.5, bounce: 0.18 }}
        className={cn('relative block flex-none', !wide && '-ml-2')}
      >
        <Orb hue={template.hue} size={44} seed={seed} className="block" />
      </motion.span>
      <span className={cn('relative flex min-w-0 flex-col', !wide && 'mt-5')}>
        <span className="text-body font-semibold tracking-[-0.015em]">{template.title}</span>
        <span className={cn('text-footnote text-balance text-ink-2', !wide && 'mt-0.5')}>{template.promise}</span>
      </span>
    </button>
  )
}
