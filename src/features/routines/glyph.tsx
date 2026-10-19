import { IconChip } from '@/ui/icons'
import type { RoutineIcon } from './templates'

/** A routine's face: one of Murmur's own icons on a lit chip of the agent's colour, like the agent page's tiles. */
export function Glyph({ icon, size = 36, className }: { icon: RoutineIcon; size?: number; className?: string }) {
  return <IconChip icon={icon} size={size} className={className} />
}
