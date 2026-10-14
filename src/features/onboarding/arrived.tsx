import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/ui/button'
import { Buddy, type BuddyState } from '@/ui/buddy'
import { ByUmbrel } from '@/ui/brand'
import { haptic } from '@/lib/haptics'
import { useMedia, usePrefersReducedMotion } from '@/lib/use-media'
import { Bloom } from './bloom'
import { arrivedCopy } from './setup-copy'
import { STEP_COLUMN } from './step'

// Chose a Hermes that already had agents: rather than meet a new one, the
// person's own agents gather on screen. Each flies in from a loose ring,
// others first and the outermost soonest, and the main agent lands last, in
// the middle. A tap anywhere settles it at once. Built like Done, so the last
// onboarding screens rhyme.

const ease = [0.16, 1, 0.3, 1] as const
/** The main agent and five others; the rest are "+N". */
const SHOWN = 6
/** Slot width as a share of a buddy's: shoulder to shoulder, not squeezed. */
const SLOT = 0.8
const STAGGER = 0.09
/** When a spring of this feel reads as landed, though it still settles. */
const LANDS = 0.5

export type ArrivedAgent = { id: string; name: string; hue: number; isDefault?: boolean; at?: number }

export function Arrived({
  agents,
  chats = 0,
  onStart,
}: {
  agents: ArrivedAgent[]
  chats?: number
  onStart: () => void
}) {
  const reduced = usePrefersReducedMotion()
  // The row never wraps: six buddies and a "+N" fit a 375px phone at 58px.
  const narrow = useMedia('(max-width: 359px)')
  const phone = useMedia('(max-width: 419px)')
  const row = narrow ? 50 : phone ? 58 : 64
  const [settled, setSettled] = useState(reduced)

  // Main first, then whoever was busy most recently.
  const ordered = useMemo(() => {
    const main = agents.find((a) => a.isDefault) ?? agents[0]
    const rest = agents.filter((a) => a !== main).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    return main ? [main, ...rest] : rest
  }, [agents])
  const shown = ordered.slice(0, SHOWN)
  // One agent stands alone, as large as Done's.
  const size = shown.length === 1 ? 96 : row
  const more = ordered.length - shown.length
  const main = shown[0]
  const { title, body } = arrivedCopy(
    ordered.map((a) => a.name),
    ordered.length,
    chats,
  )

  // Row order: the main agent in the centre, the most recent nearest it, alternating sides.
  const n = shown.length
  const centre = Math.floor(n / 2)
  const slots = useMemo(() => {
    const at: number[] = [centre]
    for (let k = 1; at.length < n; k++) {
      if (centre - k >= 0) at.push(centre - k)
      if (at.length < n && centre + k < n) at.push(centre + k)
    }
    return at // at[i] = the slot for shown[i]
  }, [n, centre])

  // Landing order: outermost first, the main agent last.
  const order = useMemo(() => {
    const others = shown.map((_, i) => i).filter((i) => i !== 0)
    others.sort((a, b) => Math.abs(slots[b] - centre) - Math.abs(slots[a] - centre) || slots[a] - slots[b])
    return [...others, 0]
  }, [shown, slots, centre])
  const delayOf = (i: number) => 0.15 + order.indexOf(i) * STAGGER
  const landed = delayOf(0) + LANDS

  const [states, setStates] = useState<BuddyState[]>(() => shown.map(() => (reduced ? 'done' : 'idle')))
  const [arrived, setArrived] = useState(reduced)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (s: number, fn: () => void) => timers.push(setTimeout(fn, s * 1000))
    const set = (i: number, state: BuddyState) => setStates((all) => all.map((s, j) => (j === i ? state : s)))
    if (settled) {
      // Everyone's here: happy eyes, then at rest.
      setStates(shown.map(() => 'done'))
      setArrived(true)
      at(1.2, () => setStates(shown.map(() => 'idle')))
      at(0.05, () => button.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions))
    } else {
      shown.forEach((_, i) => {
        at(delayOf(i) + LANDS, () => set(i, 'done'))
        at(delayOf(i) + LANDS + 1.2, () => set(i, 'idle'))
      })
      at(landed, () => {
        setArrived(true)
        haptic('tick')
      })
      at(landed + 0.5, () => button.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions))
    }
    return () => timers.forEach(clearTimeout)
  }, [settled])

  // Where each starts: a point on a loose ring, the same for an agent every time.
  const ring = (id: string, i: number) => {
    const r = rand(id)
    const angle = r() * Math.PI * 2
    const radius = 150 + r() * 70
    const slotX = (slots[i] - (n - 1) / 2) * size * SLOT
    return { x: Math.cos(angle) * radius - slotX, y: Math.sin(angle) * radius * 0.75 }
  }

  const text = (delay: number) =>
    settled
      ? { initial: false as const, animate: { opacity: 1, y: 0 }, transition: { duration: 0.15 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.46, ease, delay: landed + delay },
        }

  return (
    <main
      className="hue-scope relative flex min-h-dvh flex-col items-center overflow-hidden text-center safe-top md:justify-center"
      style={{ '--hue': main?.hue ?? 278 } as CSSProperties}
      onPointerDown={settled ? undefined : () => setSettled(true)}
    >
      <div className="flex w-full flex-1 flex-col items-center justify-center px-5 md:flex-none">
        <div className="relative grid h-32 w-full place-items-center">
          <motion.span
            className="pointer-events-none absolute size-80 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={arrived ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }}
            transition={{ duration: 1.2, ease }}
            aria-hidden
          />
          <span className="relative flex items-end gap-2" aria-hidden>
            <span className="relative">
              {arrived && !reduced && (
                <span
                  className="absolute top-1/2 left-1/2 -translate-1/2"
                  style={{ width: size * 1.2, height: size * 1.2 }}
                >
                  <Bloom />
                </span>
              )}
              <span className="buddy-row relative" style={{ height: size }}>
                {slots
                  .map((slot, i) => ({ slot, i }))
                  .sort((a, b) => a.slot - b.slot)
                  .map(({ i }) => {
                    const a = shown[i]
                    const from = ring(a.id, i)
                    return (
                      <motion.span
                        key={`${a.id}-${settled}`}
                        className="buddy-row-slot"
                        style={{ width: size * SLOT, height: size, zIndex: i === 0 ? 3 : 1 }}
                        initial={
                          settled ? false : { x: from.x, y: from.y, scale: 0.7, opacity: 0, filter: 'blur(4px)' }
                        }
                        animate={{ x: 0, y: 0, scale: 1, opacity: 1, filter: 'blur(0px)' }}
                        transition={{
                          type: 'spring',
                          duration: 0.8,
                          bounce: 0.25,
                          delay: delayOf(i),
                          opacity: { duration: 0.3, delay: delayOf(i) },
                          filter: { duration: 0.4, delay: delayOf(i) },
                        }}
                      >
                        <Buddy hue={a.hue} size={size} seed={a.id} state={states[i]} />
                      </motion.span>
                    )
                  })}
              </span>
            </span>
            {more > 0 && (
              <motion.span
                className="mb-2 inline-flex h-6 items-center rounded-full bg-fill-2 px-2 text-caption font-semibold text-ink-2 tabular-nums"
                {...(settled
                  ? { initial: false as const, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.15 } }
                  : {
                      initial: { opacity: 0, scale: 0.8 },
                      animate: { opacity: 1, scale: 1 },
                      transition: { type: 'spring' as const, duration: 0.4, bounce: 0.3, delay: landed },
                    })}
              >
                +{more}
              </motion.span>
            )}
          </span>
        </div>
        <motion.h1
          className="mt-10 w-full max-w-[22rem] text-large font-semibold tracking-[-0.02em] text-balance"
          {...text(0.2)}
        >
          {title}
        </motion.h1>
        <motion.p className="mt-2 max-w-[20rem] text-body text-balance text-ink-2" {...text(0.26)}>
          {body}
        </motion.p>
      </div>
      <motion.div
        className={`pt-8 pb-[max(24px,env(safe-area-inset-bottom))] md:pt-10 md:pb-0 ${STEP_COLUMN}`}
        {...text(0.44)}
      >
        <Button ref={button} size="lg" variant="accent" onClick={onStart}>
          Start chatting
        </Button>
        <div className="mt-5 flex justify-center md:mt-8">
          <ByUmbrel />
        </div>
      </motion.div>
    </main>
  )
}

/** A small seeded random, so each agent's starting point is its own and never changes. */
function rand(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Who came along ──────────────────────────────────────────────────────────
// Choosing an existing Hermes notes it here, so the app (on the far side of a
// reload, perhaps) greets its agents once. Per tab, and gone once shown.

const ARRIVED = 'murmur:arrived'

export type Arrival = { name: string; chats?: number }

export function markArrived(arrival: Arrival) {
  try {
    sessionStorage.setItem(ARRIVED, JSON.stringify(arrival))
  } catch {
    // Private mode: the app goes straight home instead.
  }
}

export function readArrived(): Arrival | null {
  try {
    return JSON.parse(sessionStorage.getItem(ARRIVED) ?? 'null') as Arrival | null
  } catch {
    return null
  }
}

export function clearArrived() {
  try {
    sessionStorage.removeItem(ARRIVED)
  } catch {
    // Nothing kept.
  }
}
