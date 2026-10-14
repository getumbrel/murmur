import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

// Press and hold a message (or right-click it) for what you can do with it.
// The bubble lifts above a soft scrim and a small menu settles beside it, the
// way iOS does it.

export type MenuAction = { label: string; icon: LucideIcon; onSelect: () => void }

const HOLD_MS = 420
const SLOP = 8

/** Long-press (touch or pen) and right-click open the menu; a scroll or a drag cancels. */
export function useLongPress(onOpen: (target: HTMLElement) => void) {
  const timer = useRef<number | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const cancel = () => {
    window.clearTimeout(timer.current)
    start.current = null
  }
  useEffect(() => cancel, [])
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') return
      const target = e.currentTarget
      start.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(() => {
        start.current = null
        navigator.vibrate?.(10)
        onOpen(target)
      }, HOLD_MS)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = start.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault()
      cancel()
      onOpen(e.currentTarget)
    },
  }
}

const spring = { type: 'spring', duration: 0.34, bounce: 0.18 } as const
const out = { duration: 0.16, ease: [0.16, 1, 0.3, 1] } as const

/**
 * The lifted bubble and its menu. `anchor` is the bubble that was pressed;
 * `bubble` re-draws it above the scrim.
 */
export function MessageMenu({
  anchor,
  bubble,
  actions,
  onClose,
}: {
  anchor: HTMLElement | null
  bubble: ReactNode
  actions: MenuAction[]
  onClose: () => void
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  // The portal leaves the chat's colour behind; carry the agent's hue along.
  const [hue, setHue] = useState('')
  const menu = useRef<HTMLDivElement>(null)
  const [menuHeight, setMenuHeight] = useState(actions.length * 48 + 12)

  useLayoutEffect(() => {
    if (!anchor) return
    setRect(anchor.getBoundingClientRect())
    setHue(getComputedStyle(anchor).getPropertyValue('--hue').trim())
  }, [anchor])
  useLayoutEffect(() => {
    if (menu.current) setMenuHeight(menu.current.offsetHeight)
  }, [rect])

  useEffect(() => {
    if (!anchor) return
    const close = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', close)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  // Below the bubble if it fits, else above it; nudged on screen either way.
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  const below = rect ? rect.bottom + 8 + menuHeight < vh - 16 : true
  const top = rect ? (below ? rect.bottom + 8 : Math.max(16, rect.top - 8 - menuHeight)) : 0
  const right = rect ? Math.max(12, window.innerWidth - rect.right) : 0
  const open = !!anchor

  return createPortal(
    <AnimatePresence onExitComplete={() => setRect(null)}>
      {open && rect && (
        <div key="menu" className="hue-scope fixed inset-0 z-50" style={hue ? ({ '--hue': hue } as CSSProperties) : undefined}>
          <motion.div
            className="absolute inset-0 bg-scrim backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.24 } }}
            exit={{ opacity: 0, transition: out }}
            onClick={onClose}
          />
          {/* The bubble, lifted. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute flex justify-end"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              transformOrigin: below ? '100% 100%' : '100% 0%',
            }}
            initial={{ scale: 1 }}
            animate={{ scale: 1.03, transition: spring }}
            exit={{ scale: 1, transition: out }}
          >
            {bubble}
          </motion.div>
          <motion.div
            ref={menu}
            role="menu"
            className="absolute min-w-48 overflow-hidden rounded-[18px] bg-elevated/95 p-1.5 shadow-float ring-[0.5px] ring-line-strong backdrop-blur-xl"
            style={{ top, right, transformOrigin: below ? '100% 0%' : '100% 100%' }}
            initial={{ opacity: 0, scale: 0.92, y: below ? -6 : 6 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: spring }}
            exit={{ opacity: 0, scale: 0.96, transition: out }}
          >
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose()
                  a.onSelect()
                }}
                className={cn(
                  'flex h-11 w-full items-center justify-between gap-6 rounded-[12px] px-3 text-left text-body text-ink outline-none',
                  'hover:bg-fill-2 focus-visible:bg-fill-2 active:bg-fill-3',
                )}
              >
                {a.label}
                <a.icon size={18} strokeWidth={1.85} className="text-ink-2" aria-hidden />
              </button>
            ))}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
