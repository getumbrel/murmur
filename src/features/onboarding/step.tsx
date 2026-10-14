import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/ui/button'
import { cn } from '@/lib/cn'
import { WindowControlsGap } from '@/ui/titlebar'

// The chrome every onboarding step shares, so moving through the flow only
// changes what's on the page: one column (the app's 20px gutter, 30rem wide,
// the same as Welcome and Done), a centred title, and Skip in the same
// top-right spot whenever a step can be skipped.

export const STEP_COLUMN = 'mx-auto w-full max-w-[30rem] px-5'

export function StepHeader({
  title,
  body,
  onSkip,
  animate,
  focus,
  live,
  before,
  className,
}: {
  title: ReactNode
  body: ReactNode
  onSkip?: () => void
  /** Rise in, title then body. */
  animate?: boolean
  /** Take focus on arrival (without a ring), so a screen reader starts with the question. */
  focus?: boolean
  /** The body changes in place (a search finishing): announce it. */
  live?: boolean
  /** Top-left, on Skip's line: a way back. */
  before?: ReactNode
  /** Bottom and wide-screen spacing, which depend on what follows. */
  className?: string
}) {
  const title_ = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focus) title_.current?.focus({ preventScroll: true })
  }, [focus])
  return (
    <>
      {before && (
        <div className="absolute top-[max(8px,env(safe-area-inset-top))] left-0.5 z-10 flex items-center desktop:top-0 desktop:h-(--titlebar-h)">
          <WindowControlsGap side="start" column={480} />
          {before}
        </div>
      )}
      {onSkip && (
        // Its label's right edge, not the button's, meets the content edge. In the
        // desktop app it sits on the titlebar's line, clear of the window's buttons.
        <div className="absolute top-[max(8px,env(safe-area-inset-top))] right-0.5 flex items-center desktop:top-0 desktop:h-(--titlebar-h)">
          <Button variant="ghost" className="h-11 text-ink-2" onClick={onSkip}>
            Skip
          </Button>
          <WindowControlsGap side="end" column={480} />
        </div>
      )}
      {/* On phones the Hermes switcher (onboarding.tsx) shares the top line with
          Skip; the title steps down a little to give it air. */}
      <header className={cn('pt-14 text-center max-md:in-data-[switcher]:pt-16', className)}>
        <h1
          ref={title_}
          tabIndex={focus ? -1 : undefined}
          className={cn('text-large font-semibold tracking-[-0.02em] text-balance outline-none', animate && 'animate-rise')}
        >
          {title}
        </h1>
        <p
          className={cn(
            'mx-auto mt-2 max-w-[24rem] text-body text-balance text-ink-2',
            animate && 'animate-rise [animation-delay:50ms]',
          )}
          aria-live={live ? 'polite' : undefined}
        >
          {body}
        </p>
      </header>
    </>
  )
}

/** A step's way back, top-left on Skip's line: the pill First agent uses for "Templates". */
export function BackPill({ onClick, disabled, children = 'Back' }: { onClick: () => void; disabled?: boolean; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'pressable relative ml-4 inline-flex h-8 animate-fade items-center gap-0.5 rounded-full bg-fill-2 pr-3 pl-1.5',
        'text-footnote font-medium text-ink-2 transition-opacity select-none hover:text-ink disabled:opacity-40',
        // A 44px target around the 32px pill.
        "before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-['']",
      )}
    >
      <ChevronLeft size={16} strokeWidth={2.25} />
      {children}
    </button>
  )
}
