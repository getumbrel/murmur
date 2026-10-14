import { useEffect, useRef, type ReactNode } from 'react'
import { useAnimate } from 'motion/react'
import { MurmurWordmark } from '@/ui/brand'
import { usePrefersReducedMotion } from '@/lib/use-media'

// The top of Murmur's pre-app screens (sign in, Connect to Hermes): the
// lockup, then the screen's own title and a line under it. Centred, like
// every onboarding step that follows. `hop` makes the two buddies jump for
// joy (just the mark; the word stays put) when the screen has done its job.

export function BrandHeader({ title, body, hop }: { title: ReactNode; body: ReactNode; hop?: boolean }) {
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const reduced = usePrefersReducedMotion()
  const hopped = useRef(false)

  useEffect(() => {
    if (!hop) {
      hopped.current = false
      return
    }
    const mark = scope.current?.querySelector('.murmur-wordmark-mark')
    if (hopped.current || reduced || !mark) return
    hopped.current = true
    void animate(mark, { y: [0, -8, 0], scaleY: [1, 1.04, 1] }, { duration: 0.5, ease: [0.34, 1.4, 0.64, 1] })
  }, [hop, reduced, animate, scope])

  return (
    <header className="text-center">
      <div ref={scope} className="flex justify-center [&_.murmur-wordmark-mark]:origin-bottom">
        <MurmurWordmark size={32} />
      </div>
      <h1 className="mt-10 text-large font-semibold tracking-[-0.02em] text-balance">{title}</h1>
      <p className="mx-auto mt-2 max-w-[24rem] text-body text-balance text-ink-2">{body}</p>
    </header>
  )
}
