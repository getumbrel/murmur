import { Phone } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Bars, Clock } from './call'
import { setMinimized, useTalk } from './talk'

/** A voice in five strokes: the sign for it, wherever it appears. */
export function Waveform({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden className={className}>
      <path d="M4 10v4M8 6.5v11M12 3.5v17M16 6.5v11M20 10v4" />
    </svg>
  )
}

/**
 * Calling the agent, in the chat's header, in the agent's colour. While this chat's call is on it's
 * the way back to it: a live pill with the time, like a phone's. The call grows from it and folds
 * back into it.
 */
export function CallButton({
  name,
  live,
  disabled,
  onCall,
}: {
  name: string
  live?: boolean
  disabled?: boolean
  /** Gets where the button is, so the call can grow from it. */
  onCall: (from: { x: number; y: number }) => void
}) {
  const phase = useTalk((s) => s.phase)
  const label = live ? `Back to the call with ${name}` : `Call ${name}`
  return (
    <button
      type="button"
      disabled={disabled && !live}
      aria-label={label}
      title={label}
      className={cn('call-button pressable touch-target', live && 'live')}
      onClick={(e) => {
        if (live) return setMinimized(false)
        const r = e.currentTarget.getBoundingClientRect()
        onCall({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      }}
    >
      <span className="call-button-mark">{live ? <Bars phase={phase} /> : <Phone size={18} strokeWidth={2} aria-hidden />}</span>
      <span className="call-button-words">
        <span>{live ? <Clock className="tabular-nums" /> : <span>Call</span>}</span>
      </span>
    </button>
  )
}
