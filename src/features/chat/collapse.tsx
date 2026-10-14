import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import './work.css'

const spring = { type: 'spring', duration: 0.35, bounce: 0 } as const

/**
 * Swaps between two states of a card: the old one fades as the new one fades
 * in, while the height springs from one to the other (measured, so it also
 * follows the card as it grows).
 */
export function Swap({ id, children }: { id: string; children: ReactNode }) {
  const reduce = useReducedMotion()
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={reduce ? { duration: 0 } : spring}
      className="overflow-hidden"
    >
      <div ref={inner} className="relative">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={id}
            // The old state folds away first, so the two never read on top of each other.
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.22, delay: 0.1 } }}
            exit={{ opacity: 0, scale: reduce ? 1 : 0.98, transition: { duration: 0.12 } }}
            style={{ transformOrigin: '50% 0%' }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

/** How a card that needs you arrives: a small spring up from just below. */
export const arrive = {
  initial: { opacity: 0, scale: 0.97, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  transition: { type: 'spring', duration: 0.45, bounce: 0.15 },
  style: { transformOrigin: '50% 100%' },
} as const
