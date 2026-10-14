import { motion } from 'motion/react'
import { useEffect, useState, type CSSProperties } from 'react'
import { Button } from '@/ui/button'
import { ByUmbrel } from '@/ui/brand'
import { Orb, type OrbState } from '@/ui/orb'
import { Bloom } from './bloom'
import { STEP_COLUMN } from './step'

// Onboarding's last beat: the new agent lands with a little bounce and a
// ripple, says it's ready, and the words follow it in. Signed like the
// welcome, so the first and last screens frame the setup.

export function Done({ name, hue, seed, onStart }: { name: string; hue: number; seed: string; onStart: () => void }) {
  const [state, setState] = useState<OrbState>('done')
  useEffect(() => {
    const id = setTimeout(() => setState('idle'), 1600)
    return () => clearTimeout(id)
  }, [])

  return (
    <main
      className="hue-scope relative flex min-h-dvh flex-col items-center overflow-hidden text-center safe-top md:justify-center"
      style={{ '--hue': hue } as CSSProperties}
    >
      <div className="flex w-full flex-1 flex-col items-center justify-center px-5 md:flex-none">
        <div className="relative grid size-32 place-items-center">
          <motion.span
            className="pointer-events-none absolute size-80 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            aria-hidden
          />
          <span className="relative block size-28">
            <Bloom delay={0.35} />
            <motion.span
              className="relative block"
              initial={{ opacity: 0, scale: 0.8, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', duration: 0.7, bounce: 0.3 }}
            >
              <Orb hue={hue} size={112} state={state} seed={seed} />
            </motion.span>
          </span>
        </div>
        <h1 className="mt-10 w-full max-w-[22rem] animate-rise text-large font-semibold tracking-[-0.02em] text-balance break-words [animation-delay:260ms]">
          {name} is ready
        </h1>
        <p className="mt-2 max-w-[18rem] animate-rise text-body text-balance text-ink-2 [animation-delay:330ms]">
          Ask anything, from quick questions to bigger jobs.
        </p>
      </div>
      <div className={`animate-rise pt-8 pb-[max(24px,env(safe-area-inset-bottom))] [animation-delay:480ms] md:pt-10 md:pb-0 ${STEP_COLUMN}`}>
        <Button size="lg" variant="accent" onClick={onStart}>
          Start chatting
        </Button>
        <div className="mt-5 flex justify-center md:mt-8">
          <ByUmbrel />
        </div>
      </div>
    </main>
  )
}
