import { useEffect, useRef, useState } from 'react'
import {
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type MotionValue,
  type PanInfo,
} from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

// A row you swipe sideways to act on, the way Mail's are: a short swipe opens
// the action's button, a long one does it outright, with a tick under your
// thumb as it gets there. Chats swipe right to pin and left to archive; models
// swipe right to pin.

/** A swiped-open action's width. */
const REVEAL = 80
/** How far across its row a swipe goes to do its action outright. */
const FULL = 0.5
const spring = { type: 'spring', stiffness: 500, damping: 42 } as const

export type Side = 'leading' | 'trailing'

export type SwipeOption = {
  label: string
  icon: LucideIcon
  run: () => void
  tone: 'accent' | 'warning' | 'danger'
  /** It takes the row out of the list. */
  removes: boolean
}

/**
 * The row's slide. Spread `drag` on the part that moves, put the actions
 * beside it, and hold the row (`row`, the part that stays) open on `revealed`.
 */
export function useSwipe<T extends HTMLElement>({
  leading,
  trailing,
  revealed,
  onReveal,
}: {
  leading?: SwipeOption
  trailing?: SwipeOption
  revealed: Side | null
  onReveal: (side: Side | null) => void
}) {
  const row = useRef<T>(null)
  const width = useRef(0)
  const dragging = useRef(false)
  /** Moved since the pointer went down: the click that ends a swipe opens nothing. */
  const dragged = useRef(false)
  // Swiped all the way: the row has gone with its action, and stays gone.
  const leaving = useRef(false)
  const present = useIsPresent()

  const x = useMotionValue(0)
  // Far enough to do it outright: the action says so, with a tick under your thumb.
  const [armed, setArmed] = useState<Side | null>(null)
  useMotionValueEvent(x, 'change', (v) => {
    const far = width.current * FULL
    const next = !far ? null : trailing && v <= -far ? 'trailing' : leading && v >= far ? 'leading' : null
    if (next === armed) return
    setArmed(next)
    if (next && dragging.current) navigator.vibrate?.(10)
  })

  useEffect(() => {
    if (leaving.current) return
    const controls = animate(x, revealed === 'trailing' ? -REVEAL : revealed === 'leading' ? REVEAL : 0, spring)
    return () => controls.stop()
  }, [revealed, x])
  // Put back (Undo, or Hermes said no) before it had quite gone.
  useEffect(() => {
    if (!present || !leaving.current) return
    leaving.current = false
    animate(x, 0, spring)
  }, [present, x])

  const run = (side: Side) => {
    const action = side === 'trailing' ? trailing : leading
    if (!action) return
    if (action.removes) {
      leaving.current = true
      const w = width.current || row.current?.offsetWidth || 400
      onReveal(null)
      // Out the side it was pushed, then the list closes over it.
      void animate(x, side === 'trailing' ? -w : w, { type: 'spring', stiffness: 420, damping: 44, restDelta: 2 }).then(
        action.run,
      )
    } else {
      onReveal(null)
      animate(x, 0, spring)
      action.run()
    }
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    dragging.current = false
    const v = x.get()
    const far = width.current * FULL
    if (trailing && v <= -far) return run('trailing')
    if (leading && v >= far) return run('leading')
    const side: Side | null =
      trailing && (v < -REVEAL / 2 || (info.velocity.x < -400 && v < 0))
        ? 'trailing'
        : leading && (v > REVEAL / 2 || (info.velocity.x > 400 && v > 0))
          ? 'leading'
          : null
    // Settle even when the state doesn't change (a short drag that snaps back).
    animate(x, side === 'trailing' ? -REVEAL : side === 'leading' ? REVEAL : 0, spring)
    onReveal(side)
  }

  const drag = {
    style: { x },
    drag: leading || trailing ? ('x' as const) : false,
    dragDirectionLock: true,
    dragConstraints: { left: trailing ? -4000 : 0, right: leading ? 4000 : 0 },
    dragElastic: 0,
    dragMomentum: false,
    onDragStart: () => {
      dragging.current = true
      dragged.current = true
      width.current = row.current?.offsetWidth ?? 0
    },
    onDragEnd,
  }

  return { row, x, armed, dragged, run, drag }
}

const tones = {
  accent: 'bg-accent text-accent-ink',
  warning: 'bg-warning text-accent-ink',
  danger: 'bg-danger text-white',
}

/** What a swipe shows: as wide as the row has moved, its label kept against the row's edge. */
export function SwipeAction({
  side,
  action,
  x,
  armed,
  shown,
  onPress,
}: {
  side: Side
  action: SwipeOption
  x: MotionValue<number>
  armed: boolean
  shown: boolean
  onPress: () => void
}) {
  const width = useTransform(x, (v) => Math.max(0, side === 'trailing' ? -v : v))
  // What it said as you let go, until the row is closed: a pin lands while the row
  // slides back, and the strip going with it still says Pin, not Unpin.
  const [face, setFace] = useState(action)
  if (face.label !== action.label && x.get() === 0) setFace(action)
  useMotionValueEvent(x, 'change', (v) => v === 0 && face.label !== action.label && setFace(action))
  return (
    <motion.button
      type="button"
      data-swipe-action=""
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
      onClick={onPress}
      className={cn(
        'absolute inset-y-0 flex items-center overflow-hidden',
        side === 'trailing' ? 'right-0 justify-start' : 'left-0 justify-end',
        tones[face.tone],
      )}
      style={{ width }}
    >
      <motion.span
        className="flex flex-none flex-col items-center justify-center gap-1 text-caption font-medium"
        style={{ width: REVEAL }}
        animate={{ scale: armed ? 1.1 : 1 }}
        transition={{ type: 'spring', duration: 0.3, bounce: 0.4 }}
      >
        <face.icon size={20} strokeWidth={1.85} aria-hidden />
        {face.label}
      </motion.span>
    </motion.button>
  )
}
