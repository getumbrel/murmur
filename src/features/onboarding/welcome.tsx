import { motion, type Variants } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/ui/button'
import { BRAND, ByUmbrel, MurmurMark } from '@/ui/brand'
import { usePrefersReducedMotion } from '@/lib/use-media'
import { startMurmuration, type MurmurStage } from './murmuration'
import { STEP_COLUMN } from './step'
import './welcome.css'

// First run. A murmuration swirls, violet on one wing and coral on the other;
// as it condenses each half finds its own buddy, the two of them land shoulder
// to shoulder as the Murmur mark, blink, and Murmur introduces itself. Tap
// anywhere to skip.

/** The mark's height here, and where its two buddies stand (fractions of its width from centre). */
const MARK = 88
const BUDDY_X = 0.2313

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
  const home = useRef<HTMLDivElement>(null)
  const glow = useRef<HTMLDivElement>(null)
  const skip = useRef<() => void>(undefined)

  useEffect(() => {
    if (still || !canvas.current) return setStage('text')
    const el = canvas.current
    const run = startMurmuration(el, {
      colors: [BRAND.violet, BRAND.coral],
      glow: glow.current,
      targets: () => {
        const a = el.getBoundingClientRect()
        const b = home.current!.getBoundingClientRect()
        const x = b.left - a.left + b.width / 2
        const y = b.top - a.top + b.height / 2
        const d = ((MARK * 83) / 58) * BUDDY_X
        return [
          { x: x - d, y },
          { x: x + d, y },
        ]
      },
      onStage: setStage,
    })
    skip.current = run.skip
    return run.stop
  }, [still, hue])

  const shown = stage === 'text'

  return (
    <main
      className="relative flex min-h-dvh flex-col overflow-hidden bg-bg safe-top md:justify-center"
      style={{ '--hue': hue } as React.CSSProperties}
      onPointerDown={shown ? undefined : () => skip.current?.()}
    >
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 size-full" aria-hidden />

      <div className="relative flex flex-1 flex-col items-center justify-center px-5 pt-16 text-center md:flex-none md:pt-0">
        <div ref={home} className="relative grid h-32 w-40 place-items-center">
          <div
            ref={glow}
            className="pointer-events-none absolute size-96 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--accent)_20%,transparent),transparent)] transition-opacity duration-500"
            style={{ opacity: still ? 1 : 0 }}
            aria-hidden
          />
          {stage !== 'flock' && (
            <motion.div
              data-hero="brand"
              className="welcome-mark relative flex origin-bottom"
              initial={still ? false : { opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', duration: 0.75, bounce: 0.3 }}
            >
              <MurmurMark size={MARK} breathe />
            </motion.div>
          )}
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
