import { AnimatePresence, animate, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button } from '@/ui/button'
import { Buddy, type BuddyState } from '@/ui/buddy'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import { usePrefersReducedMotion } from '@/lib/use-media'
import type { BuiltinState } from '@/state/setup'
import { Bloom } from './bloom'

// Starting fresh, while the Hermes built into Murmur has its first start (from
// about fifteen seconds to a couple of minutes on a small Umbrel). The main
// agent-to-be works away in the middle, and two steps tick off as they really
// happen, never on a timer: Hermes answering, then Murmur signed in to it. A
// state of the gate, not a route, so a reload mid-start comes back here.

const HUE = 278
const ease = [0.16, 1, 0.3, 1] as const
const HERO = 104
/** After this long the words admit it's a slow one… */
const SLOW_MS = 45_000
/** …and after this long they offer a way out. */
const STUCK_MS = 4 * 60_000
/** A blip of "can't reach it" isn't a failure: hold it this long first. */
const FAIL_HOLD_MS = 10_000

type Stage = 'pending' | 'active' | 'done'

export type GettingReadyProps = {
  /** How the built-in is doing (GET /murmur/setup); undefined until asked. */
  state?: BuiltinState
  /** Murmur has signed in to it: ready to use. */
  connected: boolean
  /** Where the Start fresh card's buddy stood, to fly it in from there. */
  from?: DOMRect
  /** After "All set" has had its moment. */
  onDone: () => void
  /** Failed, then Try again: keep asking, and start the clocks over. */
  onRetry?: () => void
  /** "Use a different Hermes…" once it's slow or failed. */
  onOther?: () => void
  /** Playground: start as if this long had already passed… */
  elapsed?: number
  /** …or as if it had already failed. */
  initialFailed?: boolean
}

export function GettingReady({
  state,
  connected,
  from,
  onDone,
  onRetry,
  onOther,
  elapsed = 0,
  initialFailed = false,
}: GettingReadyProps) {
  const reduced = usePrefersReducedMotion()
  const [round, setRound] = useState(0)
  const [late, setLate] = useState<'no' | 'slow' | 'stuck'>(
    elapsed >= STUCK_MS ? 'stuck' : elapsed >= SLOW_MS ? 'slow' : 'no',
  )

  // Words that change with time; the clocks start over on Try again.
  useEffect(() => {
    const base = round ? 0 : elapsed
    const slow = setTimeout(() => setLate((l) => (l === 'no' ? 'slow' : l)), Math.max(0, SLOW_MS - base))
    const stuck = setTimeout(() => setLate('stuck'), Math.max(0, STUCK_MS - base))
    return () => {
      clearTimeout(slow)
      clearTimeout(stuck)
    }
  }, [round, elapsed])

  // Failed: can't be reached, and still can't ten seconds later.
  const [failed, setFailed] = useState(initialFailed)
  useEffect(() => {
    if (state !== 'unreachable') return setFailed(false)
    if (failed) return
    const t = setTimeout(() => setFailed(true), FAIL_HOLD_MS)
    return () => clearTimeout(t)
  }, [state, round])

  const up = connected || state === 'ready'
  const stages: [Stage, Stage] = [up ? 'done' : 'active', connected ? 'done' : up ? 'active' : 'pending']
  const finished = connected

  // All set: a beat to land, then on to the app.
  useEffect(() => {
    if (!finished) return
    const t = setTimeout(onDone, reduced ? 500 : 900)
    return () => clearTimeout(t)
  }, [finished])

  // The buddy goes from error to asleep once the failure has been seen.
  const [face, setFace] = useState<BuddyState>('working')
  useEffect(() => {
    if (finished) return setFace('done')
    if (!failed) return setFace('working')
    setFace('error')
    const t = setTimeout(() => setFace('offline'), 1400)
    return () => clearTimeout(t)
  }, [failed, finished])

  // Arriving from the Start fresh card: its buddy grows into this one.
  const hero = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = hero.current
    if (!el || !from || reduced) return
    const to = el.getBoundingClientRect()
    if (!to.width) return
    const dx = from.left + from.width / 2 - (to.left + to.width / 2)
    const dy = from.top + from.height / 2 - (to.top + to.height / 2)
    const s = from.width / to.width
    void animate(el, { x: [dx, 0], y: [dy, 0], scale: [s, 1] }, { type: 'spring', duration: 0.5, bounce: 0.15 })
  }, [])
  const flew = !!from && !reduced

  const title = failed ? 'Couldn’t get things ready' : finished ? 'All set' : 'Getting ready'
  const body = failed
    ? 'Murmur’s built-in Hermes didn’t start. Try restarting Murmur, then try again.'
    : late === 'stuck'
      ? 'This is taking longer than it should. Try restarting Murmur if it doesn’t finish.'
      : late === 'slow'
        ? 'Still going. The very first start can take a couple of minutes.'
        : 'Murmur is making a home for your agents. The first start takes a minute or so.'

  return (
    <main
      className="hue-scope relative flex min-h-dvh flex-col items-center overflow-hidden px-5 text-center safe-top md:justify-center"
      style={{ '--hue': HUE } as CSSProperties}
    >
      <div className="flex w-full flex-1 flex-col items-center justify-center pb-[8vh] md:flex-none md:pb-0">
        <div className="relative grid size-32 place-items-center">
          <motion.span
            className={cn(
              'pointer-events-none absolute size-80 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)] transition-opacity duration-500',
              failed && 'opacity-0',
            )}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.2, ease }}
            aria-hidden
          />
          <span className="relative block" style={{ width: HERO, height: HERO }}>
            {finished && <Bloom />}
            <motion.span
              ref={hero}
              className="relative block"
              initial={flew ? false : reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={reduced ? { duration: 0.15 } : { type: 'spring', duration: 0.6, bounce: 0.2 }}
            >
              <Buddy hue={HUE} size={HERO} seed="default" state={face} />
            </motion.span>
          </span>
        </div>

        <h1 className="mt-10 grid animate-rise text-large font-semibold tracking-[-0.02em] text-balance [animation-delay:120ms]">
          <Swap k={title}>{title}</Swap>
        </h1>
        <p
          className="mt-2 grid max-w-[21rem] animate-rise text-body text-balance text-ink-2 [animation-delay:170ms]"
          aria-live="polite"
        >
          <Swap k={body}>{body}</Swap>
        </p>

        <AnimatePresence mode="popLayout" initial={false}>
          {failed ? (
            <motion.div
              key="failed"
              className="mt-8 w-full max-w-[22rem]"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease }}
            >
              <Button
                size="lg"
                variant="accent"
                onClick={() => {
                  setFailed(false)
                  setLate('no')
                  setRound((r) => r + 1)
                  onRetry?.()
                }}
              >
                Try again
              </Button>
            </motion.div>
          ) : (
            <motion.ol
              key="stages"
              role="status"
              aria-live="polite"
              className="mt-8 inline-flex animate-rise flex-col items-start gap-3 text-left text-subhead [animation-delay:240ms]"
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <Step stage={stages[0]}>Starting up</Step>
              <Step stage={stages[1]}>Making room for your agents</Step>
            </motion.ol>
          )}
        </AnimatePresence>

        <div className="mt-6 h-11">
          <AnimatePresence>
            {onOther && (failed || late === 'stuck') && !finished && (
              <motion.button
                type="button"
                onClick={onOther}
                className="pressable flex h-11 items-center rounded-full px-4 text-subhead font-medium text-accent select-none hover:bg-fill-1 active:bg-fill-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                Use a different Hermes…
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  )
}

/** Words that change in place: the old fade out as the new fade in, in the same cell. */
function Swap({ k, children }: { k: string; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      <motion.span
        key={k}
        className="[grid-area:1/1]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  )
}

function Step({ stage, children }: { stage: Stage; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="grid size-4 flex-none place-items-center" aria-hidden>
        {stage === 'done' ? (
          <DrawnCheck />
        ) : stage === 'active' ? (
          <Spinner size={14} className="text-ink-2" />
        ) : (
          <span className="size-1.5 rounded-full bg-fill-3" />
        )}
      </span>
      <span className={cn('grid', stage === 'pending' && 'text-ink-3')}>
        <Swap k={stage}>
          <span className={cn(stage === 'active' && 'text-shimmer', stage === 'done' && 'text-ink')}>{children}</span>
        </Swap>
      </span>
      <span className="sr-only">{stage === 'done' ? 'done' : stage === 'active' ? 'in progress' : 'waiting'}</span>
    </li>
  )
}

/** A tick that draws itself in. Under reduced motion it's simply there. */
function DrawnCheck() {
  const reduced = usePrefersReducedMotion()
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className="text-success">
      <motion.path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      />
    </svg>
  )
}
