import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/ui/skeleton'

// What + adds: photos and files, then whatever else the screen offers (an
// agent's apps, passwords and cards). It grows out of the + above the composer, and the + turns to
// a × while it's open. A tap leaves focus where it was, so the keyboard stays
// up and typing carries on (and closes it). From the keyboard, Return on the
// + or an arrow in the message box moves focus in, the arrows move through
// it, and Esc goes back.

export type PlusItem = {
  key: string
  label: string
  /** A quiet second line: what it holds. */
  detail?: ReactNode
  icon: ReactNode
  /** Small, at the end: what it holds, shown (an agent's apps, its cards). */
  aside?: ReactNode
  onSelect: () => void
}

const enter = { type: 'spring', duration: 0.3, bounce: 0.1 } as const
const leave = { duration: 0.14, ease: [0.16, 1, 0.3, 1] } as const
/** Between the menu and the capsule. */
const GAP = 8

export function usePlusMenu() {
  const [open, setOpen] = useState(false)
  // Opened from the keyboard: focus goes to the first item.
  const [keyed, setKeyed] = useState(false)
  const show = useCallback((fromKeyboard: boolean) => {
    setKeyed(fromKeyboard)
    setOpen(true)
  }, [])
  const close = useCallback(() => setOpen(false), [])
  return { open, keyed, show, close }
}

export type PlusMenuState = ReturnType<typeof usePlusMenu>

/**
 * Hangs just above the composer's capsule, from its left edge, and grows out
 * of the + (`trigger`). Its parent is the capsule's positioned parent, with
 * the same bottom edge. Esc or a press anywhere else closes it.
 */
export function PlusMenu({
  state,
  id,
  items,
  capsule,
  trigger,
}: {
  state: PlusMenuState
  id: string
  items: PlusItem[]
  capsule: RefObject<HTMLElement | null>
  trigger: RefObject<HTMLElement | null>
}) {
  const { open, keyed, close } = state
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ bottom: 0, origin: '18px 100%' })

  // Where the capsule's top is, and where in it the + sits, as it opens.
  useLayoutEffect(() => {
    const c = capsule.current
    const t = trigger.current?.getBoundingClientRect()
    if (!open || !c || !t) return
    const r = c.getBoundingClientRect()
    setPlace({
      bottom: r.height + GAP,
      origin: `${t.left + t.width / 2 - r.left}px calc(100% + ${GAP + t.top + t.height / 2 - r.top}px)`,
    })
  }, [open, capsule, trigger])

  // Where focus goes back to on Esc: the message box it was in, or the +.
  const back = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const at = document.activeElement
    back.current = at instanceof HTMLTextAreaElement ? at : trigger.current
    if (keyed) box.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true })
  }, [open, keyed, trigger])

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      const at = e.target as Node
      if (!box.current?.contains(at) && !trigger.current?.contains(at)) close()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // (Before the chat sees it: Esc here closes the menu, not the reply.)
      e.preventDefault()
      const inside = box.current?.contains(document.activeElement)
      close()
      if (inside) back.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, close, trigger])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={box}
          id={id}
          role="menu"
          aria-label="Add"
          onKeyDown={menuKeys}
          // Keep focus (and the keyboard) where it was until something's picked.
          onPointerDown={(e) => e.preventDefault()}
          initial={{ opacity: 0, scale: 0.94, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0, transition: enter }}
          exit={{ opacity: 0, scale: 0.97, y: 4, transition: leave }}
          style={{ bottom: place.bottom, transformOrigin: place.origin }}
          className="absolute left-0 z-20 w-76 max-w-full rounded-[22px] bg-elevated/90 p-1.5 shadow-float ring-[0.5px] ring-line-strong backdrop-blur-2xl backdrop-saturate-150"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close()
                item.onSelect()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Tab') close()
              }}
              className={cn(
                'group/item flex min-h-13 w-full items-center gap-3 rounded-[16px] py-2 pr-3 pl-2 text-left outline-none select-none',
                'transition-colors duration-150 hover:bg-fill-2 focus-visible:bg-fill-2 active:bg-fill-2',
              )}
            >
              <span className="flex flex-none">{item.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-subhead leading-5 font-medium text-ink">{item.label}</span>
                {item.detail && <span className="block truncate text-footnote text-ink-2">{item.detail}</span>}
              </span>
              {item.aside}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** An item's second line, rolling in over its placeholder once it's known. */
export function PlusLine({ text }: { text: string | undefined }) {
  return (
    <span className="relative flex h-[18px] items-center">
      <AnimatePresence mode="popLayout" initial={false}>
        {text ? (
          <motion.span
            key={text}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="block truncate"
          >
            {text}
          </motion.span>
        ) : (
          <motion.span key="loading" exit={{ opacity: 0, transition: { duration: 0.12 } }} className="flex">
            <Skeleton className="h-2 w-28 rounded-full" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

/** An item's aside, settling in once there's something to show (and out when there isn't). */
export function PlusAside({ children }: { children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {children && (
        <motion.span
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={enter}
          className="flex flex-none origin-right"
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

/** Arrow keys, Home and End move between the items. */
function menuKeys(e: KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]')]
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key]
  if (next === undefined || !items.length) return
  e.preventDefault()
  items[(next + items.length) % items.length].focus()
}
