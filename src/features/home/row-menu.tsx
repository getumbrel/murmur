import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { menuItem, menuKeys } from './new-menu'

// A row's context menu, hung from the row itself: touch and hold, right-click,
// or the row's "…". The roster's agents and groups use it, and every list of
// chats. Put the row in a Popover.Root and its Popover.Anchor, then this. A
// wide row can hang it where it was asked for instead: under its "…", or at
// the pointer that right-clicked it.

export type MenuItem = {
  /** Its own key, where labels can repeat (two sections can share a name). */
  key?: string
  label: string
  icon: ReactNode
  onSelect?: () => void
  danger?: boolean
  /**
   * One of a set of places (the sections in "Move to"), true for where it is
   * now: that one is drawn in the accent, and choosing it does nothing.
   */
  current?: boolean
  /** A step deeper, in the same menu: its items slide in, with a way back. */
  submenu?: { title: string; items: MenuItem[] }
  /** Starts a new group of items. */
  divider?: boolean
}

/** Where the menu hangs: from the row's leading edge, under the "…" it came from, or at the pointer. */
export type MenuPlace = 'row' | 'button' | 'point'

const offsets = {
  button: { align: 'end', sideOffset: 4, alignOffset: 0 },
  point: { align: 'start', sideOffset: 2, alignOffset: 0 },
} as const

export function RowMenu({
  open,
  name,
  roomy,
  items,
  close,
  place = 'row',
}: {
  open: boolean
  name: string
  roomy: boolean
  items: MenuItem[]
  close: () => void
  place?: MenuPlace
}) {
  // Where focus was before the menu (the More button, for keyboards): it goes back there,
  // and a sheet opened from the menu returns it there too.
  const before = useRef<HTMLElement | null>(null)
  const restore = () => before.current?.isConnected && before.current.focus()
  // The submenu showing, if any; a fresh menu always starts at the top.
  const [sub, setSub] = useState<MenuItem['submenu']>()
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSub(undefined)
  }
  const shown = sub?.items ?? items
  const showing = sub ? sub.title : 'top'
  // Keys keep their place in the panel that slides in (the outgoing one is still there,
  // on its way out): a step deeper lands on its first choice, a step back on where it came from.
  const menu = useRef<HTMLDivElement>(null)
  const stepped = useRef(false)
  const cameFrom = useRef<string>(undefined)
  useEffect(() => {
    if (!open) stepped.current = false
    else if (sub || stepped.current) {
      stepped.current = true
      const panel = menu.current?.querySelector(`[data-panel="${CSS.escape(showing)}"]`)
      const target =
        (!sub &&
          cameFrom.current &&
          panel?.querySelector<HTMLElement>(`[data-item="${CSS.escape(cameFrom.current)}"]`)) ||
        panel?.querySelector<HTMLElement>('[role^=menuitem]:not([data-back])')
      target?.focus({ preventScroll: true })
    }
  }, [sub, open, showing])
  const enter = (it: MenuItem) => {
    cameFrom.current = it.key ?? it.label
    setSub(it.submenu)
  }
  const select = (it: MenuItem) => {
    if (it.submenu) return enter(it)
    if (it.current) return
    close()
    // After the menu lets go of focus.
    setTimeout(() => {
      restore()
      it.onSelect?.()
    })
  }
  return (
    <AnimatePresence>
      {open && (
        <Popover.Portal forceMount>
          <Popover.Content
            forceMount
            asChild
            side="bottom"
            {...(place === 'row'
              ? { align: 'start', sideOffset: roomy ? -6 : 4, alignOffset: roomy ? 20 : 8 }
              : offsets[place])}
            collisionPadding={12}
            aria-label={`${name} options`}
            onOpenAutoFocus={() => (before.current = document.activeElement as HTMLElement | null)}
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              // Unless what was chosen has taken focus since (the field of the sheet it opened).
              const at = document.activeElement
              if (!at || at === document.body) restore()
            }}
          >
            <motion.div
              ref={menu}
              role="menu"
              onKeyDown={(e) => {
                // Left steps back out, as in any menu.
                if (sub && e.key === 'ArrowLeft') {
                  e.preventDefault()
                  return setSub(undefined)
                }
                menuKeys(e)
              }}
              layout
              // Long lists (a dozen sections, on a phone) scroll within the screen.
              className="relative z-50 max-h-(--radix-popover-content-available-height) max-w-72 min-w-56 origin-(--radix-popover-content-transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl bg-elevated shadow-float ring-1 ring-line"
              // Set here so the corners keep their shape as the menu grows into a submenu.
              style={{ borderRadius: 12 }}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={showing}
                  data-panel={showing}
                  // Its text stays its own size while the menu grows or shrinks around it.
                  layout="position"
                  // A step deeper slides in from the right, and back from the left.
                  initial={{ opacity: 0, x: sub ? 24 : -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: sub ? -24 : 24, transition: { duration: 0.12 } }}
                  transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                >
                  {sub && (
                    <button
                      role="menuitem"
                      data-back=""
                      aria-label={`Back, ${sub.title}`}
                      className={cn(menuItem, 'h-10 justify-start gap-1 pl-2.5 text-footnote font-medium text-ink-2')}
                      onClick={() => setSub(undefined)}
                    >
                      <ChevronLeft size={18} strokeWidth={2} aria-hidden />
                      {sub.title}
                    </button>
                  )}
                  {shown.map((it, i) => (
                    <button
                      key={it.key ?? it.label}
                      data-item={it.key ?? it.label}
                      role={it.current !== undefined ? 'menuitemradio' : 'menuitem'}
                      aria-checked={it.current}
                      aria-haspopup={it.submenu ? 'menu' : undefined}
                      onKeyDown={(e) => {
                        if (it.submenu && e.key === 'ArrowRight') {
                          e.preventDefault()
                          enter(it)
                        }
                      }}
                      className={cn(
                        menuItem,
                        (i > 0 || sub) && (it.divider ? 'border-t-[6px] border-fill-1' : 'hairline-t'),
                        it.danger && 'text-danger',
                        it.current && 'font-medium text-accent',
                      )}
                      onClick={() => select(it)}
                    >
                      <span className="min-w-0 truncate">{it.label}</span>
                      {/* Its name is the label: a section's faces (and their "+2") are for the eye. */}
                      <span
                        aria-hidden
                        className={cn('flex flex-none items-center', !it.danger && !it.current && 'text-ink-2')}
                      >
                        {it.icon}
                      </span>
                    </button>
                  ))}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </Popover.Content>
        </Popover.Portal>
      )}
    </AnimatePresence>
  )
}

/**
 * Touch-and-hold (or right-click) opens the menu; the tap that ends a hold
 * doesn't navigate. A mouse's right-click says where it was.
 */
export function useLongPress(onLongPress: (at?: { x: number; y: number }) => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const origin = useRef<{ x: number; y: number }>(undefined)
  const fired = useRef(false)
  const mouse = useRef(false)
  const cancel = () => clearTimeout(timer.current)
  useEffect(() => cancel, [])
  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false
      mouse.current = e.pointerType === 'mouse'
      if (mouse.current) return
      origin.current = { x: e.clientX, y: e.clientY }
      timer.current = setTimeout(() => {
        fired.current = true
        navigator.vibrate?.(8)
        onLongPress()
      }, ms)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 8) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClick: (e: React.MouseEvent) => {
      if (fired.current) e.preventDefault()
      fired.current = false
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      cancel()
      // (A menu key's has no pointer to go by.)
      onLongPress(mouse.current && (e.clientX || e.clientY) ? { x: e.clientX, y: e.clientY } : undefined)
    },
  }
}
