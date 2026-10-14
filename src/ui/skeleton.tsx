import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

/**
 * A loading placeholder in the shape of what's coming. Size and round it with
 * classes (`h-3 w-2/3 rounded-full`, `size-10 rounded-full`). The sweep is
 * shared CSS (`.skeleton` in styles.css) and stops under reduced motion.
 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cn('skeleton', className)} style={style} />
}

/** Lines of text-shaped skeletons; the last one runs short, like a paragraph. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden className={cn('block space-y-2.5', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-3 rounded-full"
          style={{ width: i === lines - 1 && lines > 1 ? '62%' : '100%' }}
        />
      ))}
    </span>
  )
}
