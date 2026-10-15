import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Copy, Ellipsis, Share } from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@/ui/button'
import { cn } from '@/lib/cn'
import { useLongPress } from '@/features/chat/message-menu'
import { copyText } from '@/features/chat/use-copy'

// Copy or share a whole chat, or look into it. On wide screens a quiet "…" sits in the header;
// anywhere, press and hold (or right-click) the agent's name for the same menu.

const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

type Action = { label: string; icon: typeof Copy; onSelect: () => unknown }

export function useChatMenu(getText: () => { title: string; text: string } | undefined, more: Action[] = []) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const latest = useRef(getText)
  latest.current = getText
  const close = useCallback(() => setAnchor(null), [])

  const copy = async () => {
    const t = latest.current()
    if (!t) return
    if (await copyText(t.text)) toast.success('Copied')
    else toast.error('Couldn’t copy this chat.')
  }
  const share = async () => {
    const t = latest.current()
    if (!t) return
    try {
      await navigator.share({ title: t.title, text: t.text })
    } catch (e) {
      // Closing the sheet isn't a failure; anything else falls back to copying.
      if (!(e instanceof DOMException && e.name === 'AbortError')) void copy()
    }
  }
  const actions = [
    { label: 'Copy chat', icon: Copy, onSelect: copy },
    ...(canShare() ? [{ label: 'Share…', icon: Share, onSelect: share }] : []),
    ...more,
  ]

  // Hold the name: a press that opened the menu isn't also a tap.
  const held = useRef(false)
  const press = useLongPress((el) => {
    held.current = true
    setAnchor(el)
  })
  const hold = {
    ...press,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      held.current = false
      press.onPointerDown(e)
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (!held.current) return
      held.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  }

  return { anchor, open: setAnchor, close, actions, hold }
}

type Menu = ReturnType<typeof useChatMenu>

/** The "…" for wide screens. */
export function ChatMenuButton({ menu, disabled }: { menu: Menu; disabled?: boolean }) {
  return (
    <IconButton
      size="lg"
      label="More for this chat"
      aria-haspopup="menu"
      aria-expanded={!!menu.anchor}
      disabled={disabled}
      onClick={(e) => menu.open(menu.anchor ? null : e.currentTarget)}
    >
      <Ellipsis size={20} strokeWidth={1.85} aria-hidden />
    </IconButton>
  )
}

const spring = { type: 'spring', duration: 0.3, bounce: 0.12 } as const

/** A small menu hung under whatever opened it, kept on screen. */
export function ChatMenu({ menu }: { menu: Menu }) {
  const { anchor, close, actions } = menu
  const [rect, setRect] = useState<DOMRect | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (anchor) setRect(anchor.getBoundingClientRect())
  }, [anchor])
  useLayoutEffect(() => {
    if (rect) box.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true })
  }, [rect])
  useEffect(() => {
    if (!anchor) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
      anchor.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [anchor, close])

  const width = 224
  const vw = typeof window === 'undefined' ? 400 : window.innerWidth
  // Under the anchor: right-aligned to it on the right half of the screen (the "…"), else left-aligned.
  const fromRight = rect ? rect.right > vw / 2 : false
  const left = rect ? Math.min(Math.max(12, fromRight ? rect.right - width : rect.left), vw - width - 12) : 0
  const style = rect ? { top: rect.bottom + 6, left, width } : undefined

  return createPortal(
    <AnimatePresence onExitComplete={() => setRect(null)}>
      {anchor && rect && (
        <div key="menu" className="fixed inset-0 z-50" onPointerDown={(e) => e.target === e.currentTarget && close()}>
          <motion.div
            ref={box}
            role="menu"
            aria-label="Chat"
            onKeyDown={menuKeys}
            className={cn(
              'absolute overflow-hidden rounded-[14px] bg-elevated shadow-float ring-1 ring-line',
              fromRight ? 'origin-top-right' : 'origin-top-left',
            )}
            style={style}
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: spring }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] } }}
          >
            {actions.map((a, i) => (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  close()
                  void a.onSelect()
                }}
                className={cn(
                  'flex h-11 w-full items-center justify-between gap-6 px-4 text-left text-body text-ink outline-none select-none',
                  'transition-colors hover:bg-fill-1 focus-visible:bg-fill-1 active:bg-fill-2',
                  i > 0 && 'hairline-t',
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

/** Arrow keys, Home and End move between the items. */
function menuKeys(e: KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]')]
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key]
  if (next === undefined || !items.length) return
  e.preventDefault()
  items[(next + items.length) % items.length].focus()
}
