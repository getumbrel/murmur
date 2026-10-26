import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { menuItem, menuKeys } from './new-menu'

// A row's context menu, hung from the row itself: touch and hold, right-click,
// or the row's "…". The roster's agents and groups use it, and every list of
// chats. Put the row in a Popover.Root and its Popover.Anchor, then this. A
// wide row can hang it where it was asked for instead: under its "…", or at
// the pointer that right-clicked it.

export type MenuItem = { label: string; icon: ReactNode; onSelect: () => void; danger?: boolean }

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
  const select = (it: MenuItem) => {
    close()
    // After the menu lets go of focus.
    setTimeout(() => {
      restore()
      it.onSelect()
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
              role="menu"
              onKeyDown={menuKeys}
              className="z-50 min-w-56 origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-xl bg-elevated shadow-float ring-1 ring-line"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            >
              {items.map((it, i) => (
                <button
                  key={it.label}
                  role="menuitem"
                  className={cn(menuItem, i > 0 && 'hairline-t', it.danger && 'text-danger')}
                  onClick={() => select(it)}
                >
                  {it.label}
                  <span className={cn(!it.danger && 'text-ink-2')}>{it.icon}</span>
                </button>
              ))}
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
