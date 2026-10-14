import { useState, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { WindowControlsGap } from '@/ui/titlebar'

// Settings chrome: a large title that hands off to a small centred one in a
// glass bar once you scroll, iOS style.

export function Page({ title, back, children }: { title: string; back?: { label?: string; onClick: () => void }; children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false)
  return (
    <div className="h-dvh overflow-y-auto overscroll-contain bg-bg" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 36)}>
      <header
        className={cn(
          'sticky top-0 z-10 safe-top transition-[background-color,box-shadow] duration-200 @container',
          scrolled ? 'glass hairline-b' : 'bg-bg',
        )}
      >
        <div className="relative mx-auto flex h-12 w-full max-w-[40rem] items-center px-2 desktop:h-(--titlebar-h)">
          <WindowControlsGap side="start" column={640} />
          {back && (
            <button
              type="button"
              onClick={back.onClick}
              aria-label={back.label ?? 'Back'}
              className="pressable relative z-10 flex h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-body text-accent"
            >
              <ChevronLeft size={24} strokeWidth={2} />
              {back.label}
            </button>
          )}
          <span
            className={cn(
              'pointer-events-none absolute inset-x-0 text-center text-body font-semibold tracking-[-0.01em] transition-opacity duration-200',
              scrolled ? 'opacity-100' : 'opacity-0',
            )}
            aria-hidden
          >
            {title}
          </span>
        </div>
      </header>
      {/* The app's one page gutter (px-5), the same as Home and the sheets. */}
      <div className="mx-auto w-full max-w-[40rem] px-5 pb-[max(40px,env(safe-area-inset-bottom))]">
        <h1 className="pt-1 pb-6 text-large font-semibold tracking-[-0.02em] md:pt-6">{title}</h1>
        <div className="space-y-8">{children}</div>
      </div>
    </div>
  )
}

/**
 * The leading tile for a list row: a 28px soft square in the accent with a
 * 16px line glyph, its 8px corners (~29%) the same proportion as a routine's
 * glyph, the Connect cards' tiles and Murmur's own app tile beside it.
 * Colour belongs to the agents, so Settings uses the app's accent rather
 * than a hue per row.
 */
export function Tile({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-7 flex-none items-center justify-center rounded-sm bg-accent-soft text-accent" aria-hidden>
      {children}
    </span>
  )
}
