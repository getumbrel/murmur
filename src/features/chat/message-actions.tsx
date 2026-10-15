import { Check, Copy, RotateCcw, SmilePlus, Square, Volume2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { Spinner } from '@/ui/spinner'
import { toggleSpeaking, useSpeech } from '@/features/voice/speech'
import { useCopy } from './use-copy'

// 32px to look at, 44px to hit.
const base =
  'pressable relative inline-flex size-8 items-center justify-center rounded-full transition-colors duration-200 after:absolute after:-inset-1.5'
const action = `${base} text-ink-3 hover:bg-fill-1 hover:text-ink-2`
/** While it reads aloud, the button glows in the agent's colour. */
const active = `${base} bg-accent-soft text-accent`

const swap = {
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
  transition: { type: 'spring', duration: 0.25, bounce: 0 },
} as const

/**
 * Quiet actions under a finished reply. Always visible on touch screens; on
 * hover-capable screens they appear with the pointer or keyboard focus (and
 * stay while it's being read aloud).
 */
export function MessageActions({
  text,
  onRetry,
  onReact,
  speak,
  className,
}: {
  text: string
  onRetry?: () => void
  /** Opens the tapbacks, springing out of this button. */
  onReact?: (anchor: HTMLElement) => void
  /** Read aloud in this agent's voice; `key` tells this reply apart. */
  speak?: { key: string; profile?: string }
  className?: string
}) {
  const { copied, copy } = useCopy()
  const phase = useSpeech((s) => (speak && s.key === speak.key ? s.phase : undefined))
  const profile = speak?.profile
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 transition-opacity duration-200',
        !phase &&
          '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/turn:opacity-100 [@media(hover:hover)]:focus-within:opacity-100',
        className,
      )}
    >
      <button
        type="button"
        className={action}
        onClick={() => copy(text)}
        aria-label={copied ? 'Copied' : 'Copy'}
        title="Copy"
      >
        {copied ? (
          <Check size={16} strokeWidth={2} className="animate-fade text-ink-2" />
        ) : (
          <Copy size={16} strokeWidth={1.75} />
        )}
      </button>
      {onReact && (
        <button
          type="button"
          className={action}
          onClick={(e) => onReact(e.currentTarget)}
          aria-label="React"
          title="React"
          aria-haspopup="menu"
        >
          <SmilePlus size={17} strokeWidth={1.75} />
        </button>
      )}
      {speak && profile && (
        <button
          type="button"
          className={phase ? active : action}
          onClick={() => toggleSpeaking(speak.key, text, profile)}
          aria-label={phase ? 'Stop reading' : 'Read aloud'}
          title={phase ? 'Stop' : 'Read aloud'}
          aria-pressed={!!phase}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={phase ?? 'idle'} className="flex" {...swap}>
              {phase === 'loading' ? (
                <Spinner size={15} />
              ) : phase === 'playing' ? (
                <Square size={12} fill="currentColor" strokeWidth={0} />
              ) : (
                <Volume2 size={17} strokeWidth={1.75} />
              )}
            </motion.span>
          </AnimatePresence>
        </button>
      )}
      {onRetry && (
        <button type="button" className={action} onClick={onRetry} aria-label="Try again" title="Try again">
          <RotateCcw size={16} strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}
