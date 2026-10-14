import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

const spring = { type: 'spring', duration: 0.35, bounce: 0 } as const

/**
 * A block whose height springs to fit what's inside it (measured, so it
 * follows loading → loaded, one view → the next, a card forgotten). Put it
 * around a sheet's body and the sheet grows and shrinks instead of jumping.
 * It only clips while it moves, so halos and focus rings aren't cut off.
 */
export function Grow({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const reduce = useReducedMotion()
  const inner = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ height: number | 'auto'; follow: boolean }>({ height: 'auto', follow: true })

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    let last = 0
    // Changes arriving frame after frame mean something inside is already
    // animating its own height: follow it exactly rather than chase it.
    const ro = new ResizeObserver(() => {
      const now = performance.now()
      setSize({ height: el.offsetHeight, follow: now - last < 80 })
      last = now
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <motion.div
      initial={false}
      animate={{ height: size.height }}
      transition={reduce || size.follow ? { duration: 0 } : spring}
      onAnimationStart={() => inner.current?.parentElement?.style.setProperty('overflow', 'hidden')}
      onAnimationComplete={() => inner.current?.parentElement?.style.removeProperty('overflow')}
      className={className}
      style={style}
    >
      <div ref={inner} className="flow-root">
        {children}
      </div>
    </motion.div>
  )
}
