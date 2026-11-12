import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useConnection } from '@/hermes/gateway'
import { useAway, type Away } from '@/state/reach'
import { useHermesList } from '@/state/connection'
import { Spinner } from '@/ui/spinner'
import { Orb } from '@/ui/orb'
import { cn } from '@/lib/cn'
import { useAwayWords } from '@/features/connection/away-words'
import { HermesPicker } from '@/features/connection/switcher'

// A Dynamic Island for the connection. It only speaks up when Hermes has been
// unreachable for a moment (blips under 1.5s never show): a small capsule drops
// in and springs open to say what's happening. If Hermes stays away it says
// what to check; if it's this device that's offline, or Murmur itself that
// can't be reached (away from home, say), it says that instead, and that the
// chats on screen are as they were last seen (state/reach.ts, state/kept.ts).
// When Hermes is back it says "Connected" with a tick, folds
// back into the capsule, and goes. It hangs just below the header bar, so the
// chat's name stays readable, centred on the conversation (beside the sidebar
// on wide screens, `inset` from the left). While the splash is up (`hold`) it
// keeps quiet: the splash is already saying "one moment".

type Phase = 'hidden' | 'connecting' | 'reconnecting' | 'lost' | 'back'

const spring = { type: 'spring', visualDuration: 0.38, bounce: 0.22 } as const
const fold = { type: 'spring', visualDuration: 0.3, bounce: 0.1 } as const
const swap = { duration: 0.18, ease: [0.16, 1, 0.3, 1] } as const

export function ConnectionBanner({ inset = 0, hold = false }: { inset?: number; hold?: boolean }) {
  const { state, everOpened } = useConnection()
  const away = useAway()
  // Idle is before the first dial (Connect to Hermes is up): nothing's away yet.
  return <Island phase={usePhase(state !== 'open' && state !== 'idle', everOpened, hold, !!away)} away={away} inset={inset} />
}

/** `away`: it's known what's out of reach, and that it's worth saying (state/reach.ts). */
function usePhase(down: boolean, everOpened: boolean, hold: boolean, away: boolean) {
  const [phase, setPhase] = useState<Phase>('hidden')
  const shown = useRef(false)
  shown.current = phase === 'connecting' || phase === 'reconnecting' || phase === 'lost'
  // Counted from when Hermes went away, not from when the splash let go, so a
  // cold start that already waited on the splash doesn't wait all over again.
  const since = useRef(0)
  if (!down) since.current = 0
  else if (!since.current) since.current = Date.now()

  // Its own effect: the one below re-runs when `everOpened` or `hold` change,
  // which would clear this timer and leave "Connected" up for good.
  useEffect(() => {
    if (phase !== 'back') return
    const t = setTimeout(() => setPhase('hidden'), 1900)
    return () => clearTimeout(t)
  }, [phase])

  useEffect(() => {
    if (!down) {
      if (shown.current) setPhase('back')
      return
    }
    if (hold) return
    // Still away: say what's out of reach and what to check, not just "reconnecting".
    if (away) return setPhase('lost')
    const waited = Date.now() - since.current
    const trying = everOpened ? 'reconnecting' : 'connecting'
    const show = setTimeout(() => setPhase((p) => (p === 'lost' ? p : trying)), Math.max(0, 1500 - waited))
    return () => clearTimeout(show)
  }, [down, everOpened, hold, away])

  return phase
}

/** The pill itself; `phase` drives it (exported for the UI lab). */
export function Island({ phase, away = 'hermes', inset = 0 }: { phase: Phase; away?: Away; inset?: number }) {
  // Open as a capsule first, then widen; fold back before leaving.
  const [open, setOpen] = useState(false)
  const visible = phase !== 'hidden'
  useEffect(() => {
    if (!visible) return setOpen(false)
    // Back: open to say "Connected" (it may have folded to its face meanwhile), then fold.
    const show = setTimeout(() => setOpen(true), 140)
    const fold = phase === 'back' ? setTimeout(() => setOpen(false), 1500) : undefined
    return () => {
      clearTimeout(show)
      clearTimeout(fold)
    }
  }, [visible, phase])

  // Offline, or Murmur out of reach: there's nothing to check and it may last
  // a train ride, so once it's said the island goes, out of the way of what's
  // being read. The sleeping Buddies go on saying it, and a chat says it's as
  // it was last seen. It comes back to say "Connected".
  const resting = phase === 'lost' && away !== 'hermes'
  const [said, setSaid] = useState(false)
  useEffect(() => {
    if (!resting) return setSaid(false)
    const fold = setTimeout(() => setOpen(false), 6000)
    const leave = setTimeout(() => setSaid(true), 6400)
    return () => {
      clearTimeout(fold)
      clearTimeout(leave)
    }
  }, [resting, away])

  const [title, body] = useAwayWords(away, visible)!

  // With another Hermes to go to, the island offers the way there: it hangs
  // where the phone's home keeps its switcher, and a chat has none.
  // Hermes is the one away: Murmur's server is there to say what else it knows.
  const hermes = away === 'hermes'
  const elsewhere = (useHermesList(hermes).data?.connections.length ?? 0) > 1 && hermes
  const [picking, setPicking] = useState(false)

  return (
    <MotionConfig reducedMotion="user">
      <HermesPicker open={picking} onOpenChange={setPicking} />
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-0 top-[calc(env(safe-area-inset-top)+var(--titlebar-h,3.5rem)+6px)] z-[70] flex justify-center px-4"
        style={{ left: inset }}
      >
        <AnimatePresence>
          {/* Steps aside while the picker it opened is up; the list says the same. */}
          {visible && !picking && !(resting && said) && (
            <Pill key="pill">
              {/* Icon and words crossfade together, in place, stacked in one
                  cell: the pill keeps the old size until the old words have
                  gone, then springs to fit the new ones. Never an empty frame. */}
              {/* A few points more on the left of the taller "lost" pill, so the face
                  sits as far in from the edge as its rounder corner. */}
              <span className={cn('grid size-10 flex-none place-items-center', phase === 'lost' && 'ml-1')}>
                <AnimatePresence initial={false}>
                  <motion.span
                    key={phase}
                    className="flex size-5 items-center justify-center [grid-area:1/1]"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5, transition: swap }}
                    transition={{ ...spring, opacity: swap }}
                  >
                    <Glyph phase={phase} />
                  </motion.span>
                </AnimatePresence>
              </span>
              <span className="grid items-center">
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.span
                      key={phase}
                      className="block pr-4 text-footnote font-medium whitespace-nowrap [grid-area:1/1]"
                      initial={{ opacity: 0, filter: 'blur(3px)' }}
                      animate={{ opacity: 1, filter: 'blur(0px)', transition: swap }}
                      exit={{ opacity: 0, filter: 'blur(3px)', transition: { duration: 0.12 } }}
                    >
                      {phase === 'lost' ? (
                        <span className="flex items-center gap-3">
                          <Hug
                            className={cn(
                              'py-2.5 whitespace-normal text-balance text-white/65',
                              elsewhere ? 'max-w-[12.25rem]' : 'max-w-[15.5rem]',
                            )}
                          >
                            <span className="block text-white">{title}</span>
                            {body}
                          </Hug>
                          {elsewhere && (
                            <button
                              type="button"
                              onClick={() => setPicking(true)}
                              aria-label="Switch server"
                              className="pressable -mr-1 h-8 flex-none rounded-full bg-white/15 px-3 font-semibold text-white transition-colors hover:bg-white/25 focus-visible:outline-white active:bg-white/25"
                            >
                              Switch
                            </button>
                          )}
                        </span>
                      ) : phase === 'back' ? (
                        'Connected'
                      ) : phase === 'connecting' ? (
                        'Connecting to Hermes…'
                      ) : (
                        'Reconnecting to Hermes…'
                      )}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </Pill>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}

/**
 * A block of wrapped text as wide as its longest line. A wrapped block keeps
 * its full max-width even when every line is shorter, which would leave the
 * pill a ragged gap on the right; measured, it hugs the words.
 */
function Hug({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.width = ''
    // Only the words' own boxes: a range over the element would also count
    // the full-width boxes of the blocks inside it.
    const lines: DOMRect[] = []
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    while (walk.nextNode()) {
      range.selectNodeContents(walk.currentNode)
      lines.push(...range.getClientRects())
    }
    // The pill may still be springing in, scaled; measure in layout pixels.
    const scale = el.getBoundingClientRect().width / el.offsetWidth || 1
    if (!lines.length) return
    const width = (Math.max(...lines.map((r) => r.right)) - Math.min(...lines.map((r) => r.left))) / scale
    el.style.width = `${Math.ceil(width)}px`
  })
  return (
    <span ref={ref} className={cn('block', className)}>
      {children}
    </span>
  )
}

/** The black capsule. Its size springs to whatever it holds, measured. */
function Pill({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion()
  const inner = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number }>()
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ width: el.offsetWidth, height: el.offsetHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <motion.div
      className="pointer-events-auto flex items-center overflow-hidden bg-black text-white shadow-float ring-1 ring-white/10"
      style={{ borderRadius: 28 }}
      initial={{ opacity: 0, scale: 0.6, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0, width: size?.width ?? 'auto', height: size?.height ?? 'auto' }}
      exit={{ opacity: 0, scale: 0.6, y: -8, transition: fold }}
      transition={{
        ...spring,
        opacity: { duration: 0.2 },
        ...(reduce && { width: { duration: 0 }, height: { duration: 0 } }),
      }}
    >
      <div ref={inner} className="flex w-max flex-none items-center">
        {children}
      </div>
    </motion.div>
  )
}

function Glyph({ phase }: { phase: Phase }) {
  return phase === 'lost' ? (
    <Orb hue={278} size={22} state="offline" seed="murmur" />
  ) : phase === 'back' || phase === 'hidden' ? (
    <Tick />
  ) : (
    <Spinner size={16} className="text-white/70" />
  )
}

/** A green disc whose check draws itself in. */
function Tick() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="10" fill="var(--success)" />
      <motion.path
        d="M6 10.4l2.7 2.6L14 7.6"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.32, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  )
}
