import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Text that changes in place: the old line slides up and fades as the new one
 * rises from below (200ms). `id` decides when it's a new line.
 */
export function Swap({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn('relative block overflow-hidden', className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={id}
          className="block truncate"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
