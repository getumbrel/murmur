import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { WindowControlsGap } from '@/ui/titlebar'

// The bar over an agent's page and over All agents: a back chevron on phones,
// frosted glass once anything scrolls under it (the status bar's strip on a
// home-screen iPhone included), and a small centred title that takes over
// once the big one has gone under too, iOS style.

export function PageBar({
  title,
  scrolled,
  under,
  back,
  trailing,
}: {
  title: string
  /** Something has scrolled under the bar. */
  scrolled: boolean
  /** The large title has gone under the bar. */
  under: boolean
  /** Where back goes (phones only). */
  back?: { href: string; label: string }
  trailing?: ReactNode
}) {
  return (
    <header
      className={cn(
        'sticky top-0 z-20 safe-top transition-[background-color,box-shadow] duration-300 @container',
        scrolled ? 'glass hairline-b' : 'bg-transparent',
      )}
    >
      {/* The chevron's stroke sits on the page's 20px line, its 44px button around it. */}
      <div className="relative mx-auto flex h-13 max-w-[46rem] items-center justify-between px-1.5 desktop:h-(--titlebar-h)">
        <div className="flex items-center">
          <WindowControlsGap side="start" column={736} />
          {back ? (
            <Link
              href={back.href}
              aria-label={back.label}
              className="pressable relative z-10 flex size-11 flex-none items-center rounded-full pl-1.5 text-accent hover:bg-fill-1"
            >
              <ChevronLeft size={26} strokeWidth={2} aria-hidden />
            </Link>
          ) : (
            <span className="size-11" />
          )}
        </div>
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-16 truncate text-center text-body font-semibold tracking-[-0.015em]',
            'transition-[opacity,transform] duration-300 ease-[var(--ease-out)]',
            under ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
          )}
        >
          {title}
        </span>
        <div className="relative z-10 flex min-w-11 items-center justify-end">
          {trailing}
          <WindowControlsGap side="end" column={736} />
        </div>
      </div>
    </header>
  )
}
