import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useIsWide, usePrefersReducedMotion } from '@/lib/use-media'

// A two-level navigation stack, iOS style. On phones the page pushes in from
// the right while the one beneath drifts left and dims, and you can drag it
// back from the left edge. Wide screens and reduced motion crossfade.

type Props = {
  /** The page on top of the root, by key, or null for just the root. */
  top: string | null
  root: ReactNode
  render: (key: string) => ReactNode
  onBack: () => void
}

const push = { duration: 0.32, ease: [0.32, 0.72, 0, 1] } as const
const pop = { duration: 0.26, ease: [0.32, 0.72, 0, 1] } as const

export function Stack(props: Props) {
  const wide = useIsWide()
  const reduced = usePrefersReducedMotion()
  return wide || reduced ? <Fade {...props} reduced={reduced} /> : <Push {...props} />
}

function Fade({ top, root, render, reduced }: Props & { reduced: boolean }) {
  const d = reduced ? 0.15 : 0.22
  return (
    <div className="relative h-dvh overflow-hidden">
      <AnimatePresence initial={false}>
        <motion.div
          key={top ?? ''}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: d, ease: [0.16, 1, 0.3, 1] } }}
          exit={{ opacity: 0, transition: { duration: d * 0.8 } }}
        >
          {top ? render(top) : root}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function Push({ top, root, render, onBack }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const width = useRef(typeof window === 'undefined' ? 400 : window.innerWidth)
  // The page on screen, which lags `top` while it slides away.
  const [shown, setShown] = useState(top)
  const x = useMotionValue(top ? 0 : width.current)
  const fling = useRef<number | null>(null)

  const under = useTransform(x, (v) => `${(Math.min(1, v / width.current) - 1) * 25}%`)
  const dim = useTransform(x, (v) => 0.4 * (1 - Math.min(1, v / width.current)))

  useLayoutEffect(() => {
    width.current = box.current?.clientWidth || window.innerWidth
    if (top) {
      if (top !== shown) {
        setShown(top)
        x.set(width.current)
      }
      const a = animate(x, 0, push)
      return () => a.stop()
    }
    if (!shown) return
    const v = fling.current
    fling.current = null
    const a = animate(x, width.current, v == null ? pop : { type: 'spring', duration: 0.3, bounce: 0, velocity: v })
    a.then(() => setShown(null))
    return () => a.stop()
    // `shown` is what we're animating, not a reason to animate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, x])

  // Drag back from the left edge.
  const drag = useRef<{ id: number; start: number; last: number; t: number; v: number } | null>(null)
  const onDown = (e: PointerEvent) => {
    if (!shown || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, start: e.clientX - x.get(), last: e.clientX, t: e.timeStamp, v: 0 }
    x.stop()
  }
  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dt = Math.max(1, e.timeStamp - d.t)
    d.v = (0.8 * (e.clientX - d.last) * 1000) / dt + 0.2 * d.v
    d.last = e.clientX
    d.t = e.timeStamp
    x.set(Math.max(0, e.clientX - d.start))
  }
  const onUp = (e: PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const back = x.get() > width.current * 0.4 || (d.v > 400 && x.get() > 12)
    if (back) {
      fling.current = Math.max(0, d.v)
      onBack()
    } else {
      animate(x, 0, { type: 'spring', duration: 0.3, bounce: 0, velocity: d.v })
    }
  }

  useEffect(() => () => x.stop(), [x])

  return (
    <div ref={box} className="relative h-dvh overflow-hidden">
      <motion.div className="absolute inset-0" style={{ x: under }} inert={!!shown} aria-hidden={!!shown || undefined}>
        {root}
        <motion.div className="pointer-events-none absolute inset-0 z-30 bg-scrim" style={{ opacity: dim }} />
      </motion.div>
      {shown && (
        <motion.div className="absolute inset-0 shadow-[-12px_0_32px_-16px_hsl(var(--shadow-color)/0.3)]" style={{ x }}>
          {render(shown)}
          <div
            // Below the header, so the back button keeps its whole hit area.
            className="absolute bottom-0 left-0 z-20 w-5 touch-none top-[calc(env(safe-area-inset-top)+3rem)]"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </motion.div>
      )}
    </div>
  )
}
