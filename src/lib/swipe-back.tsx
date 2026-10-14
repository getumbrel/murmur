import { animate, motion, useMotionValue, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useMedia } from '@/lib/use-media'
import { backInstantly, previousScroll } from '@/lib/transitions'

// Drag a conversation back from the left edge, the way iOS does: the page
// follows your finger with the list waiting beneath it, then either springs
// home or carries on off screen. iOS Safari tabs have their own edge swipe,
// so there it's only on when Murmur runs as an installed app.

const EDGE = 20
const settle = { type: 'spring', duration: 0.32, bounce: 0 } as const

const ios =
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
const installed = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/** `off` keeps the page where it is without the gesture (wide layouts), so the tree, and the page's state, never changes shape. */
export function SwipeBack({ children, under, off }: { children: ReactNode; under: ReactNode; off?: boolean }) {
  const touch = useMedia('(pointer: coarse)')
  const enabled = !off && touch && (!ios || installed())
  const page = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  // 'ready': a finger is on the edge, the list is mounted beneath but hidden.
  const [phase, setPhase] = useState<'off' | 'ready' | 'drag'>('off')
  const width = () => page.current?.clientWidth || innerWidth
  const progress = useTransform(x, (v) => Math.min(1, v / width()))
  const underX = useTransform(progress, (p) => `${(p - 1) * 25}%`)
  const dim = useTransform(progress, (p) => 0.4 * (1 - p))

  useEffect(() => {
    if (!enabled) return
    let g: { id: number; x0: number; y0: number; last: number; t: number; v: number; on: boolean } | undefined
    let leaving = false
    const start = (e: TouchEvent) => {
      const t = e.touches[0]
      // A page still springing home can be caught by its edge, wherever it is.
      const at = x.get()
      if (e.touches.length !== 1 || t.clientX > EDGE + at || g || leaving) return
      x.stop()
      g = { id: t.identifier, x0: t.clientX - at, y0: t.clientY, last: t.clientX, t: e.timeStamp, v: 0, on: at > 0 }
      setPhase(at > 0 ? 'drag' : 'ready')
    }
    const move = (e: TouchEvent) => {
      const t = [...e.changedTouches].find((t) => t.identifier === g?.id)
      if (!g || !t) return
      const dx = t.clientX - g.x0
      const dy = t.clientY - g.y0
      if (!g.on) {
        // Mostly sideways claims the gesture (and stops the scroll); mostly down lets go.
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) return cancel()
        if (e.cancelable) e.preventDefault()
        if (dx < 6) return
        g.on = true
        g.x0 = t.clientX
        setPhase('drag')
      }
      e.preventDefault()
      const dt = Math.max(1, e.timeStamp - g.t)
      g.v = (0.8 * (t.clientX - g.last) * 1000) / dt + 0.2 * g.v
      g.last = t.clientX
      g.t = e.timeStamp
      x.set(Math.max(0, t.clientX - g.x0))
    }
    const end = (e: TouchEvent) => {
      if (!g || ![...e.changedTouches].some((t) => t.identifier === g!.id)) return
      const { on, v } = g
      g = undefined
      if (!on) return setPhase('off')
      const w = width()
      if (x.get() > w * 0.4 || (v > 400 && x.get() > 12)) {
        leaving = true
        animate(x, w, { ...settle, velocity: Math.max(0, v) }).then(backInstantly)
      } else {
        animate(x, 0, { ...settle, velocity: v }).then(() => g || setPhase('off'))
      }
    }
    const cancel = () => {
      g = undefined
      setPhase('off')
    }
    addEventListener('touchstart', start, { passive: true })
    addEventListener('touchmove', move, { passive: false })
    addEventListener('touchend', end)
    addEventListener('touchcancel', end)
    return () => {
      removeEventListener('touchstart', start)
      removeEventListener('touchmove', move)
      removeEventListener('touchend', end)
      removeEventListener('touchcancel', end)
    }
  }, [enabled, x])

  const dragging = phase === 'drag'
  return (
    <>
      {phase !== 'off' && (
        <Beneath x={underX} dim={dim} hidden={!dragging}>
          {under}
        </Beneath>
      )}
      <motion.div
        ref={page}
        className={dragging ? 'relative z-10 shadow-[-12px_0_32px_-16px_hsl(var(--shadow-color)/0.3)]' : undefined}
        style={{ x }}
      >
        {children}
      </motion.div>
    </>
  )
}

/** The page you'd go back to, as you left it, inert while it waits. */
function Beneath({
  children,
  x,
  dim,
  hidden,
}: {
  children: ReactNode
  x: MotionValue<string>
  dim: MotionValue<number>
  hidden: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = previousScroll()
  }, [])
  return (
    <motion.div
      className="fixed inset-0 overflow-hidden"
      style={{ x, visibility: hidden ? 'hidden' : undefined }}
      inert
      aria-hidden
    >
      <div ref={box} className="no-scrollbar h-full overflow-y-auto">
        {children}
      </div>
      <motion.div className="pointer-events-none absolute inset-0 z-30 bg-scrim" style={{ opacity: dim }} />
    </motion.div>
  )
}
