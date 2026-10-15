import { useEffect, useLayoutEffect, useState, type CSSProperties, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import type { Reaction } from './types'
import { useLongPress } from './message-menu'

// Tapbacks, the way Messages does them: hold a reply (or tap the smiley under
// it) and pick one of six. Yours sit under the agent's reply; the agent's sit
// on the corner of your bubble.

export const TAPBACKS = ['❤️', '👍', '👎', '😂', '‼️', '❓']

const spring = { type: 'spring', duration: 0.32, bounce: 0.22 } as const
const pop = { type: 'spring', duration: 0.4, bounce: 0.5 } as const
const out = { duration: 0.14, ease: [0.16, 1, 0.3, 1] } as const

/** Press and hold (touch only: a mouse keeps its own right-click and selection). */
export function useHoldToReact(onOpen: (target: HTMLElement) => void) {
  const { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave } = useLongPress((target) => {
    window.getSelection()?.removeAllRanges()
    onOpen(target)
  })
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => e.pointerType === 'touch' && onPointerDown(e),
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
  }
}

/** The six choices, in a capsule that springs out of the reply it's about. */
export function Tapback({
  anchor,
  current,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null
  /** Your reaction there already: it's lit, and picking it again takes it back. */
  current?: string
  onPick: (emoji: string) => void
  onClose: () => void
}) {
  const reduce = useReducedMotion()
  const [rect, setRect] = useState<DOMRect | null>(null)
  // The portal leaves the chat's colour behind; carry the agent's hue along.
  const [hue, setHue] = useState('')
  useLayoutEffect(() => {
    if (!anchor) return
    setRect(anchor.getBoundingClientRect())
    setHue(getComputedStyle(anchor).getPropertyValue('--hue').trim())
  }, [anchor])
  useEffect(() => {
    if (!anchor) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  // Above what was held when there's room, else below, else over the middle of
  // it (a reply taller than the screen); always on screen.
  const W = 6 * 44 + 12
  const H = 56
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  const fitsAbove = !!rect && rect.top - H - 8 >= 12
  const fitsBelow = !!rect && rect.bottom + 8 + H <= vh - 12
  const above = fitsAbove || !fitsBelow
  const top = !rect
    ? 0
    : fitsAbove
      ? rect.top - H - 8
      : fitsBelow
        ? rect.bottom + 8
        : Math.min(vh - H - 12, Math.max(12, (Math.max(rect.top, 0) + Math.min(rect.bottom, vh)) / 2 - H / 2))
  const left = rect ? Math.min(Math.max(12, rect.left - 6), window.innerWidth - W - 12) : 0

  return createPortal(
    <AnimatePresence onExitComplete={() => setRect(null)}>
      {anchor && rect && (
        <div
          key="tapback"
          className="hue-scope fixed inset-0 z-50"
          style={hue ? ({ '--hue': hue } as CSSProperties) : undefined}
        >
          <div className="absolute inset-0" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
          <motion.div
            role="menu"
            aria-label="React"
            className="absolute flex items-center rounded-full bg-elevated/95 p-1.5 shadow-float ring-[0.5px] ring-line-strong backdrop-blur-xl"
            style={{ top, left, transformOrigin: above ? '24px 100%' : '24px 0%' }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: above ? 8 : -8 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: reduce ? { duration: 0.15 } : spring }}
            exit={{ opacity: 0, scale: reduce ? 1 : 0.92, transition: out }}
          >
            {TAPBACKS.map((emoji, i) => (
              <motion.button
                key={emoji}
                type="button"
                role="menuitemradio"
                aria-checked={current === emoji}
                aria-label={emoji}
                onClick={() => {
                  haptic()
                  onClose()
                  onPick(emoji)
                }}
                initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ ...pop, delay: 0.03 + i * 0.025 }}
                whileHover={reduce ? undefined : { scale: 1.18, y: -2 }}
                whileTap={{ scale: 0.9 }}
                className={cn(
                  'flex size-11 items-center justify-center rounded-full text-[24px] leading-none outline-none focus-visible:bg-fill-2',
                  current === emoji && 'bg-accent-soft',
                )}
              >
                {emoji}
              </motion.button>
            ))}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Reactions on the agent's reply: yours lit (tap to take it back), the agent's plain. */
export function ReactionPills({ reactions, onToggle }: { reactions?: Reaction[]; onToggle?: (emoji: string) => void }) {
  return (
    <AnimatePresence initial={false}>
      {!!reactions?.length && (
        <motion.div
          key="pills"
          className="flex gap-1.5"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0, transition: out }}
          transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {reactions.map((r) => {
              const mine = r.author === 'user'
              return (
                <motion.button
                  key={`${r.author}${r.emoji}`}
                  type="button"
                  disabled={!mine || !onToggle}
                  onClick={() => onToggle?.(r.emoji)}
                  aria-label={mine ? `Your reaction ${r.emoji}. Remove` : `Reacted ${r.emoji}`}
                  initial={{ scale: 0.3, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0, transition: out }}
                  transition={pop}
                  className={cn(
                    'my-0.5 flex h-7 min-w-10 items-center justify-center rounded-full px-2.5 text-[15px] leading-none',
                    mine ? 'pressable bg-accent-soft ring-1 ring-accent/25 ring-inset' : 'bg-fill-1',
                  )}
                >
                  {r.emoji}
                </motion.button>
              )
            })}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The agent's tapback on your bubble, perched on its top corner. */
export function ReactionBadge({ reactions }: { reactions?: Reaction[] }) {
  return (
    <span className="pointer-events-none absolute -top-3 -left-3 z-10 flex -space-x-1.5">
      <AnimatePresence initial={false}>
        {reactions?.map((r) => (
          <motion.span
            key={`${r.author}${r.emoji}`}
            role="img"
            aria-label={`${r.author === 'agent' ? 'Reacted' : 'You reacted'} ${r.emoji}`}
            initial={{ scale: 0.2, opacity: 0, rotate: -20 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.4, opacity: 0, transition: out }}
            transition={pop}
            className="flex size-7 items-center justify-center rounded-full bg-elevated text-[14px] leading-none shadow-float ring-[0.5px] ring-line-strong"
          >
            {r.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  )
}
