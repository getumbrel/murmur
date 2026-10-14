import { motion, type Variants } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/ui/button'
import { ByUmbrel, MurmurMark } from '@/ui/brand'
import { usePrefersReducedMotion } from '@/lib/use-media'
import { startMurmuration, type MurmurStage } from './murmuration'
import { STEP_COLUMN } from './step'
import './welcome.css'

// First run. A murmuration swirls, violet on one wing and coral on the other;
// each wing spirals down into a dotted buddy, the dots swell into two soft
// bodies, the two lean in and bump shoulders into the Murmur mark, open their
// eyes, and Murmur introduces itself. Tap anywhere to skip.

/** The mark's height here. */
const MARK = 88

type Stage = 'flock' | MurmurStage

const rise: Variants = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  shown: (i: number) => ({
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: i * 0.09 },
  }),
}

export function Welcome({ onContinue, hue = 278, settled = false }: { onContinue: () => void; hue?: number; settled?: boolean }) {
  const reduced = usePrefersReducedMotion()
  // Coming back to it (browser back from the next step): already landed, no murmuration again.
  const still = reduced || settled
  const [stage, setStage] = useState<Stage>(still ? 'text' : 'flock')
  const canvas = useRef<HTMLCanvasElement>(null)
  const mark = useRef<HTMLDivElement>(null)
  const glow = useRef<HTMLDivElement>(null)
  const skip = useRef<() => void>(undefined)

  // Before paint, so the mark never shows for a frame ahead of the flock.
  useLayoutEffect(() => {
    if (still || !canvas.current || !mark.current) return setStage('text')
    const run = startMurmuration(canvas.current, { mark: mark.current, glow: glow.current, onStage: setStage })
    skip.current = run.skip
    return run.stop
  }, [still])

  const shown = stage === 'text'

  return (
    <main
      className="relative flex min-h-dvh flex-col overflow-hidden bg-bg safe-top md:justify-center"
      style={{ '--hue': hue } as React.CSSProperties}
      onPointerDown={shown ? undefined : () => skip.current?.()}
    >
      {/* Above the glow (so the buddies it draws aren't tinted by it), under the mark it hands over to. */}
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 z-1 size-full" aria-hidden />

      <div className="relative flex flex-1 flex-col items-center justify-center px-5 pt-16 text-center md:flex-none md:pt-0">
        <div className="relative grid h-32 w-40 place-items-center">
          <div
            ref={glow}
            className="pointer-events-none absolute size-96 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--accent)_20%,transparent),transparent)] transition-opacity duration-500"
            style={{ opacity: still ? 1 : 0 }}
            aria-hidden
          />
          <div ref={mark} className="welcome-mark relative z-2 flex">
            <MurmurMark size={MARK} breathe />
          </div>
        </div>

        <motion.h1
          className="mt-12 text-large font-semibold tracking-[-0.02em]"
          variants={rise}
          custom={0}
          initial={still ? false : 'hidden'}
          animate={shown ? 'shown' : 'hidden'}
        >
          Meet Murmur
        </motion.h1>
        <motion.p
          className="mt-2 max-w-[18rem] text-body text-balance text-ink-2 md:max-w-sm"
          variants={rise}
          custom={1}
          initial={still ? false : 'hidden'}
          animate={shown ? 'shown' : 'hidden'}
        >
          A beautiful way to talk to your Hermes agents.
        </motion.p>
      </div>

      <motion.div
        className={`relative pt-8 pb-[max(24px,env(safe-area-inset-bottom))] md:pt-10 md:pb-0 ${STEP_COLUMN}`}
        variants={rise}
        custom={2.4}
        initial={still ? false : 'hidden'}
        animate={shown ? 'shown' : 'hidden'}
        inert={!shown}
      >
        <Button size="lg" variant="accent" onClick={onContinue}>
          Get started
        </Button>
        <div className="mt-5 flex justify-center md:mt-8">
          <ByUmbrel />
        </div>
      </motion.div>
    </main>
  )
}
