import type { ReactElement, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Search } from 'lucide-react'
import { Buddy } from '@/ui/buddy'
import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import type { Agent } from '@/state/agents'
import { AppIcon } from './app-icon'

// The pieces every view of the Apps sheet is made of: the app and the agent
// joined by a line, a heading, the wall's tiles, and their loading shapes.

export const ease = [0.16, 1, 0.3, 1] as const
export const pop = { type: 'spring', duration: 0.45, bounce: 0.45 } as const
/** An app icon lifted off the sheet, for the one a view is about. */
export const lift = 'shadow-[inset_0_0_0_0.5px_var(--line-strong),0_8px_20px_rgb(0_0_0/0.14)]'

/** The line between two things: dotted and drifting while it's only a promise, drawn solid once it's real. */
export function Link({ state, width = 'w-14', delay = 0 }: { state: 'linking' | 'linked' | 'broken'; width?: string; delay?: number }) {
  const linked = state === 'linked'
  return (
    <span
      aria-hidden
      className={cn(
        'relative block h-[3px] flex-none overflow-hidden rounded-full',
        width,
        state === 'linking' ? 'umbrel-link' : 'bg-fill-3',
      )}
    >
      <motion.span
        className="umbrel-link-fill absolute inset-0 origin-left rounded-full"
        initial={false}
        animate={{ scaleX: linked ? 1 : 0 }}
        transition={{ type: 'spring', duration: 0.7, bounce: 0, delay: linked ? delay : 0 }}
      />
    </span>
  )
}

/** The app and the agent, side by side, and the link between them. The app is its icon's name, or art of its own. */
export function Pair({
  agent,
  icon,
  state,
}: {
  agent: Agent
  icon: string | ReactElement
  state: 'linking' | 'linked' | 'broken'
}) {
  const linked = state === 'linked'
  return (
    <div className="flex items-center justify-center pt-3">
      <span className="relative">
        {typeof icon === 'string' ? <AppIcon name={icon} size={68} className={lift} /> : icon}
        <AnimatePresence>
          {linked && (
            <motion.span
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...pop, delay: 0.35 }}
              className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full bg-success text-white ring-3 ring-elevated"
            >
              <Check size={14} strokeWidth={3} aria-hidden />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="mx-4">
        <Link state={state} />
      </span>
      <Buddy hue={agent.hue} seed={agent.id} size={68} state={linked ? 'done' : state === 'broken' ? 'idle' : 'waiting'} />
    </div>
  )
}

export function Heading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mt-6 text-center">
      <h2 className="text-title font-semibold tracking-[-0.02em] text-balance">{title}</h2>
      {children && <p className="mx-auto mt-1.5 max-w-80 text-subhead text-balance text-ink-2">{children}</p>}
    </div>
  )
}

/** The top of a view about one app: its icon, lifted, its name, and a line about it. */
export function AppHeader({ icon, title, children }: { icon: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center pt-3 text-center">
      <AppIcon name={icon} size={72} className={lift} />
      <h2 className="mt-4 text-title font-semibold tracking-[-0.02em] text-balance">{title}</h2>
      {children && <p className="mx-auto mt-1 max-w-80 text-subhead text-balance text-ink-2">{children}</p>}
    </div>
  )
}

/** A row's second line that changes in place: it rolls up to its new words. */
export function RowStatus({ id, children }: { id: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={id}
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -3 }}
        transition={{ duration: 0.2, ease }}
        className="block truncate text-footnote text-ink-2"
      >
        {children}
      </motion.span>
    </AnimatePresence>
  )
}

export function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative flex h-9 w-40 flex-none items-center rounded-full bg-fill-1 transition-colors focus-within:bg-fill-2 sm:w-48">
      <Search size={15} strokeWidth={2.2} className="pointer-events-none absolute left-3 text-ink-3" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search"
        aria-label="Search apps"
        className="h-full w-full rounded-full bg-transparent pr-3 pl-8.5 text-subhead text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  )
}

/** Apps to add, as a phone's home screen lays them out. */
export function WallGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-4 gap-x-2 gap-y-5 sm:grid-cols-5">{children}</div>
}

export function Tile({
  name,
  hint,
  index,
  onClick,
  children,
}: {
  name: string
  hint?: string
  index: number
  onClick: () => void
  children: ReactNode
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      title={hint || undefined}
      aria-label={hint ? `${name}: ${hint}` : name}
      // The wall settles in from the top, quickly, and only the first screenful takes turns.
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease, delay: Math.min(index, 16) * 0.012 }}
      className="group flex min-w-0 flex-col items-center gap-1.5 rounded-xl py-1 outline-offset-2 select-none"
    >
      <span className="transition-[scale,filter] duration-150 ease-out group-hover:brightness-105 group-active:scale-[.92]">
        {children}
      </span>
      <span className="max-w-full truncate px-0.5 text-caption text-ink">{name}</span>
    </motion.button>
  )
}

export function RowsLoading() {
  return (
    <div className="list-group overflow-hidden rounded-xl bg-fill-1" aria-busy aria-label="Loading">
      {[0, 1].map((i) => (
        <div key={i} className="flex h-15 items-center gap-3 px-4">
          <Skeleton className="size-[30px] rounded-[7px]" />
          <span className="flex-1 space-y-2">
            <Skeleton className="block h-3 w-24 rounded-full" />
            <Skeleton className="block h-2.5 w-44 rounded-full" />
          </span>
        </div>
      ))}
    </div>
  )
}

export function WallLoading() {
  return (
    <div className="grid grid-cols-4 gap-x-2 gap-y-5 sm:grid-cols-5" aria-busy aria-label="Loading">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex flex-col items-center gap-2 py-1">
          <Skeleton className="size-14 rounded-[12.5px]" />
          <Skeleton className="h-2 w-10 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/** A link out of Murmur (a provider's own page, Nous's privacy terms), in a new tab. */
export function OutLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded-sm text-footnote font-medium text-accent hover:underline',
        // A 44px target around a one-line link.
        'after:absolute after:-inset-x-1 after:-inset-y-3',
        className,
      )}
    >
      {children}
    </a>
  )
}
