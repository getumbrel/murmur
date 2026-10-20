import * as Dialog from '@radix-ui/react-dialog'
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type PanInfo,
  type Transition,
} from 'motion/react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { ChevronLeft, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useIsWide } from '@/lib/use-media'

// One surface, two shapes: a bottom sheet you can flick away on phones, a
// centred card on wide screens that grows out of whatever opened it. Both close
// on Escape, scrim tap, or the ✕. The scrim moves with the sheet: same spring,
// and it lifts as you drag the sheet down.

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Visually hide the title (it is still announced). */
  hideTitle?: boolean
  /** A way back to the sheet's first view, in the title's place: the label is where it goes. */
  back?: { label: string; onBack: () => void }
  description?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
  /** Styles for the sheet itself, e.g. an agent's --hue under `hue-scope`. */
  style?: CSSProperties
  /** Wide-screen card width. */
  width?: number
}

const enter = { type: 'spring', visualDuration: 0.32, bounce: 0 } as const
const leave = { type: 'spring', visualDuration: 0.26, bounce: 0 } as const
const fade = { duration: 0.15, ease: 'easeOut' } as const

export function Sheet({
  open,
  onOpenChange,
  title,
  hideTitle,
  back,
  description,
  children,
  footer,
  className,
  style,
  width = 440,
}: Props) {
  const wide = useIsWide()
  const reduce = useReducedMotion()
  const drag = useDragControls()
  const id = useId()
  const covered = useCovered(id)
  const sheet = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  // Scrim = its own level × how far the sheet has been dragged away.
  const level = useMotionValue(0)
  const pull = useMotionValue(1)
  const scrim = useTransform(() => level.get() * pull.get())
  useScrim(id, open, level, reduce ? fade : open ? enter : leave)

  const onDrag = (_: unknown, info: PanInfo) => {
    const h = sheet.current?.offsetHeight || 600
    pull.set(1 - Math.min(1, Math.max(0, info.offset.y) / h))
  }
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const h = sheet.current?.offsetHeight || 600
    if (info.offset.y > Math.min(140, h * 0.3) || (info.velocity.y > 500 && info.offset.y > 8)) onOpenChange(false)
    else animate(pull, 1, enter)
  }

  // Wide: scale out of the button that opened it (or the focused element).
  const placeFromSource = (el: HTMLDivElement | null) => {
    if (!el || !open) return
    const from = sourcePoint()
    if (!from) return
    const left = (innerWidth - el.offsetWidth) / 2
    const top = (innerHeight - el.offsetHeight) / 2
    el.style.transformOrigin = `${from.x - left}px ${from.y - top}px`
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence onExitComplete={() => pull.set(1)}>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-40 bg-scrim" style={{ opacity: scrim }} />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              // Land focus on the sheet itself, not its close button.
              onOpenAutoFocus={(e) => {
                e.preventDefault()
                opener.current = document.activeElement as HTMLElement | null
                ;(e.currentTarget as HTMLElement | null)?.focus()
              }}
              // Radix returns focus to a Dialog.Trigger, which sheets don't use: hand it back to the opener.
              onCloseAutoFocus={(e) => {
                e.preventDefault()
                if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
              }}
              tabIndex={-1}
              // styles.css keys toast placement off an open sheet.
              data-sheet=""
              // No description: say so, rather than have the title announced twice.
              {...(!description && { 'aria-describedby': undefined })}
            >
              {wide ? (
                <motion.div
                  ref={placeFromSource}
                  className={cn(
                    'fixed top-1/2 left-1/2 z-50 flex max-h-[min(720px,calc(100dvh-48px))] flex-col overflow-hidden',
                    'rounded-2xl bg-elevated shadow-float outline-none ring-1 ring-line',
                    className,
                  )}
                  style={{ ...style, width, x: '-50%', y: '-50%' }}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: covered && !reduce ? 0.96 : 1, transition: reduce ? fade : enter }}
                  exit={reduce ? { opacity: 0, transition: fade } : { opacity: 0, scale: 0.97, transition: leave }}
                >
                  <SheetHeader title={title} hideTitle={hideTitle} back={back} description={description} />
                  <SheetBody className="[--sheet-x:--spacing(6)] pb-6">{children}</SheetBody>
                  {footer && <div className="hairline-t px-6 py-4">{footer}</div>}
                </motion.div>
              ) : (
                <motion.div
                  ref={sheet}
                  className={cn(
                    'fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-env(safe-area-inset-top)-12px)] flex-col',
                    'origin-bottom rounded-t-2xl bg-elevated shadow-sheet outline-none',
                    className,
                  )}
                  style={style}
                  initial={reduce ? { opacity: 0 } : { y: '100%' }}
                  animate={{
                    y: 0,
                    opacity: 1,
                    scale: covered && !reduce ? 0.95 : 1,
                    transition: reduce ? fade : enter,
                  }}
                  // Leaving inherits the flick's velocity: the spring picks up the drag.
                  exit={reduce ? { opacity: 0, transition: fade } : { y: '100%', transition: leave }}
                  drag="y"
                  dragControls={drag}
                  dragListener={false}
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0.04, bottom: 0.9 }}
                  dragTransition={{ bounceStiffness: 500, bounceDamping: 40 }}
                  onDrag={onDrag}
                  onDragEnd={onDragEnd}
                >
                  <div
                    className="group flex h-6 flex-none cursor-grab touch-none items-center justify-center active:cursor-grabbing"
                    onPointerDown={(e) => drag.start(e)}
                  >
                    <span className="h-[5px] w-9 rounded-full bg-fill-3 transition-[scale,background-color] duration-200 ease-out group-active:scale-x-110 group-active:bg-line-strong" />
                  </div>
                  <div onPointerDown={(e) => drag.start(e)} className="touch-none">
                    <SheetHeader title={title} hideTitle={hideTitle} back={back} description={description} compact />
                  </div>
                  <SheetBody className="overscroll-contain [--sheet-x:--spacing(5)] pb-5">{children}</SheetBody>
                  {footer && (
                    <div className="hairline-t px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>
                  )}
                  {!footer && <div className="h-[env(safe-area-inset-bottom)] flex-none" />}
                </motion.div>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

function SheetHeader({
  title,
  hideTitle,
  back,
  description,
  compact,
}: {
  title: string
  hideTitle?: boolean
  back?: Props['back']
  description?: string
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-none items-start gap-3', compact ? 'px-5 pt-1 pb-3' : 'px-6 pt-5 pb-4')}>
      <div className="min-w-0 flex-1">
        {back && (
          <button
            type="button"
            onClick={back.onBack}
            className="pressable -my-px -ml-2 flex h-7 items-center gap-0.5 rounded-full pr-2.5 pl-0.5 text-body text-accent hover:bg-fill-1"
          >
            <ChevronLeft size={22} strokeWidth={2.2} aria-hidden />
            {back.label}
          </button>
        )}
        <Dialog.Title
          className={cn(
            'text-title font-semibold tracking-[-0.02em] text-balance break-words',
            (hideTitle || back) && 'sr-only',
          )}
        >
          {title}
        </Dialog.Title>
        {description && (
          <Dialog.Description className="mt-1 text-subhead text-pretty text-ink-2">{description}</Dialog.Description>
        )}
      </div>
      {/* 32px button on a 26px title line: lift it 3px so it centres on the
          title's first line, not the line box's top. */}
      <Dialog.Close
        className="pressable touch-target relative -mt-[3px] -mr-1.5 inline-flex size-8 flex-none items-center justify-center rounded-full bg-fill-2 text-ink-2 hover:bg-fill-3 hover:text-ink"
        aria-label="Close"
      >
        <X size={16} strokeWidth={2.25} />
      </Dialog.Close>
    </div>
  )
}

// The scrolling part. `--sheet-x` is its side padding, which a pinned bar
// reaches past to meet the sheet's edges; `--sheet-hold` is the height a
// search holds it at while results come and go.
function SheetBody({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div data-sheet-body="" className={cn('min-h-0 flex-1 overflow-y-auto px-(--sheet-x)', className)}>
      <div className="min-h-(--sheet-hold)">{children}</div>
    </div>
  )
}

// ── Pinned search ───────────────────────────────────────────────────────────
// A long list's search field stays in reach: it rides up with the list and
// pins under the title, with a hairline once rows pass beneath it. While
// there's a query, the sheet keeps its size and the field its place, so
// nothing shifts under your fingers as results come and go, and the first
// match always lands right under the field.

export function SheetPin({ query, className, children }: { query: string; className?: string; children: ReactNode }) {
  const pin = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const el = pin.current
    const body = el?.closest<HTMLElement>('[data-sheet-body]')
    if (!el || !body) return
    const update = () =>
      setStuck(body.scrollTop > 0 && el.getBoundingClientRect().top - body.getBoundingClientRect().top < 1)
    update()
    body.addEventListener('scroll', update, { passive: true })
    return () => {
      body.removeEventListener('scroll', update)
      body.style.removeProperty('--sheet-hold')
    }
  }, [])

  // The first keystroke, before the list narrows: hold the sheet at its
  // current height, measured from where the field will rest.
  const hold = () => {
    const el = pin.current
    const body = el?.closest<HTMLElement>('[data-sheet-body]')
    if (!el || !body || body.style.getPropertyValue('--sheet-hold')) return
    const top = Math.min(body.scrollTop, restingTop(el, body))
    const padding = parseFloat(getComputedStyle(body).paddingBottom) || 0
    body.style.setProperty('--sheet-hold', `${top + body.clientHeight - padding}px`)
  }

  // Each change brings the results' top up under the field; clearing lets go.
  useLayoutEffect(() => {
    const el = pin.current
    const body = el?.closest<HTMLElement>('[data-sheet-body]')
    if (!el || !body) return
    if (!query) return void body.style.removeProperty('--sheet-hold')
    const top = restingTop(el, body)
    if (body.scrollTop > top) body.scrollTop = top
  }, [query])

  return (
    <div
      ref={pin}
      onInputCapture={hold}
      data-stuck={stuck || undefined}
      className={cn('sheet-pin sticky top-0 z-10', className)}
    >
      {children}
    </div>
  )
}

/** Where a pinned element sits in its sheet's scroll when it isn't pinned. */
function restingTop(el: HTMLElement, body: HTMLElement) {
  el.style.position = 'static'
  const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
  el.style.position = ''
  return top
}

// ── Stacking and hand-offs ──────────────────────────────────────────────────
// Sheets either stack (a confirm over a settings sheet: the one underneath
// recedes) or hand off (one closes as the next opens). On a hand-off the new
// scrim takes over from the old one's current level, so the dim never doubles
// up or flickers.

const stack: string[] = []
const scrims = new Map<string, MotionValue<number>>()
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn))

function useCovered(id: string) {
  return useSyncExternalStore(
    subscribe,
    () => stack.includes(id) && stack[stack.length - 1] !== id,
    () => false,
  )
}

function useScrim(id: string, open: boolean, level: MotionValue<number>, transition: Transition) {
  // Layout effects update the stack before any sheet's effect reads it.
  useLayoutEffect(() => {
    const i = stack.indexOf(id)
    if (open && i < 0) stack.push(id)
    if (!open && i >= 0) stack.splice(i, 1)
    listeners.forEach((fn) => fn())
  }, [id, open])

  useLayoutEffect(() => {
    scrims.set(id, level)
    return () => {
      scrims.delete(id)
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      listeners.forEach((fn) => fn())
    }
  }, [id, level])

  useEffect(() => {
    if (!open) {
      const controls = animate(level, 0, transition)
      return () => controls.stop()
    }
    // Take over from any sheet still on its way out.
    let from = level.get()
    for (const [other, scrim] of scrims) {
      if (other === id || stack.includes(other) || scrim.get() === 0) continue
      from = Math.max(from, scrim.get())
      scrim.jump(0)
    }
    level.jump(from)
    const controls = animate(level, 1, transition)
    return () => controls.stop()
  }, [open]) // only on open/close; the transition is read at that moment
}

// Where the last press happened, so a dialog can grow from it.
let press: { x: number; y: number; at: number } | undefined
if (typeof window !== 'undefined') {
  addEventListener('pointerdown', (e) => (press = { x: e.clientX, y: e.clientY, at: performance.now() }), {
    capture: true,
    passive: true,
  })
}

function sourcePoint() {
  if (press && performance.now() - press.at < 1500) return press
  const el = document.activeElement
  if (!el || el === document.body) return undefined
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}
