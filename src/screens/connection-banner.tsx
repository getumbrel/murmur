import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '@/hermes/gateway'
import { connectionApi, connectionKey, useHermesList } from '@/state/connection'
import { Spinner } from '@/ui/spinner'
import { Orb } from '@/ui/orb'
import { cn } from '@/lib/cn'
import { isBuiltinHermes, isUmbrelHermes } from '@/features/connection/hermes-connection-form'
import { HermesPicker } from '@/features/connection/switcher'

// A Dynamic Island for the connection. It only speaks up when Hermes has been
// unreachable for a moment (blips under 1.5s never show): a small capsule drops
// in and springs open to say what's happening. If Hermes stays away it says
// what to check. When Hermes is back it says "Connected" with a tick, folds
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
  // Idle is before the first dial (Connect to Hermes is up): nothing's away yet.
  return <Island phase={usePhase(state !== 'open' && state !== 'idle', everOpened, hold)} inset={inset} />
}

function usePhase(down: boolean, everOpened: boolean, hold: boolean) {
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
    const waited = Date.now() - since.current
    const trying = everOpened ? 'reconnecting' : 'connecting'
    const show = setTimeout(() => setPhase((p) => (p === 'lost' ? p : trying)), Math.max(0, 1500 - waited))
    // Still away: say what to check, not just "reconnecting". Sooner when it
    // was never reached at all.
    const give = setTimeout(() => setPhase('lost'), Math.max(0, (everOpened ? 12_000 : 6000) - waited))
    return () => {
      clearTimeout(show)
      clearTimeout(give)
    }
  }, [down, everOpened, hold])

  return phase
}

/** The pill itself; `phase` drives it (exported for the UI lab). */
export function Island({ phase, inset = 0 }: { phase: Phase; inset?: number }) {
  // Open as a capsule first, then widen; fold back before leaving.
  const [open, setOpen] = useState(false)
  const visible = phase !== 'hidden'
  useEffect(() => {
    if (!visible) return setOpen(false)
    const t = phase === 'back' ? setTimeout(() => setOpen(false), 1500) : setTimeout(() => setOpen(true), 140)
    return () => clearTimeout(t)
  }, [visible, phase])

  // The Umbrel's own Hermes app, not merely an address from the environment:
  // a standalone Docker run sets HERMES_URL too, and has no Umbrel to check.
  const current = useQuery({
    queryKey: connectionKey,
    queryFn: connectionApi.get,
    enabled: visible,
    staleTime: 60_000,
  }).data
  const umbrel = isUmbrelHermes(current)
  // Murmur's own: nothing to check but Murmur itself.
  const builtin = isBuiltinHermes(current)

  // With another Hermes to go to, the island offers the way there: it hangs
  // where the phone's home keeps its switcher, and a chat has none.
  const elsewhere = (useHermesList().data?.connections.length ?? 0) > 1
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
          {visible && !picking && (
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
                            <span className="block text-white">
                              {builtin ? 'Murmur’s built-in Hermes isn’t responding' : 'Can’t reach Hermes'}
                            </span>
                            {builtin
                              ? 'Try restarting Murmur.'
                              : umbrel
                                ? 'Make sure the Hermes Agent app is running on your Umbrel.'
                                : 'Make sure Hermes is running. Murmur keeps trying.'}
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
