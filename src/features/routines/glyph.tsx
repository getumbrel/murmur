import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

/** A routine's face: a soft tile in the agent's colour with a line glyph. */
export function Glyph({ icon: Icon, size = 36, className }: { icon: LucideIcon; size?: number; className?: string }) {
  return (
    <span
      className={cn('flex flex-none items-center justify-center bg-accent-soft text-accent', className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.85} />
    </span>
  )
}
