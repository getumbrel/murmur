import type { ReactNode } from 'react'
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
  className,
}: {
  title: ReactNode
  body: ReactNode
  onSkip?: () => void
  /** Rise in, title then body. */
  animate?: boolean
  /** Bottom and wide-screen spacing, which depend on what follows. */
  className?: string
}) {
  return (
    <>
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
        <h1 className={cn('text-large font-semibold tracking-[-0.02em] text-balance', animate && 'animate-rise')}>
          {title}
        </h1>
        <p
          className={cn(
            'mx-auto mt-2 max-w-[24rem] text-body text-balance text-ink-2',
            animate && 'animate-rise [animation-delay:50ms]',
          )}
        >
          {body}
        </p>
      </header>
    </>
  )
}
