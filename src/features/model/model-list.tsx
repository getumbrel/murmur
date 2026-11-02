import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Pin, PinOff } from 'lucide-react'
import { Skeleton } from '@/ui/skeleton'
import { Spinner } from '@/ui/spinner'
import { SwipeAction, useSwipe, type SwipeOption } from '@/ui/swipe'
import { cn } from '@/lib/cn'
import { useMedia } from '@/lib/use-media'
import { prettyModel } from './names'
import { Resting, ServiceHeading } from './plan'
import { arrange, pinKey, usePins, useSetPinned } from './pins'
import type { ModelPick, useModelOptions } from './use-models'

// The models an agent can use, by the service each comes from, under the ones
// you've pinned (which stay in their service's list too, to compare). Both
// model sheets list them: a chat's, and the one for what an agent's new chats
// start with. Tap one to pick it. The pin at its end pins it (or unpins it):
// always there on touch, where a swipe right does it too, and there as a
// pointer passes over.

type Props = {
  options: ReturnType<typeof useModelOptions>
  query: string
  /** The one with the tick. */
  selected?: ModelPick
  /** Marked Default: what the agent's new chats use. */
  usual?: ModelPick
  /** A pick on its way: a spinner for its tick, and the others wait. */
  busy?: ModelPick
  onPick: (pick: ModelPick) => void
}

const same = (a: ModelPick | undefined, b: ModelPick) => a?.model === b.model && a.provider === b.provider
const grow = { type: 'spring', stiffness: 420, damping: 40 } as const

export function ModelList({ options, query, selected, usual, busy, onPick }: Props) {
  const pins = usePins()
  const setPinned = useSetPinned()
  const hover = useMedia('(hover: hover)')
  const { pinned, groups, mixed } = useMemo(
    () => arrange(options.data?.groups ?? [], pins, query),
    [options.data, pins, query],
  )
  const [revealed, setRevealed] = useState<string | null>(null)

  // A swiped-open row closes when the list scrolls, as it would anywhere.
  useEffect(() => {
    if (!revealed) return
    const close = () => setRevealed(null)
    document.addEventListener('scroll', close, { capture: true, passive: true, once: true })
    return () => document.removeEventListener('scroll', close, { capture: true })
  }, [revealed])

  // Pinned and unpinned far down a long list, the pins grow and shrink above
  // what's in view: hold it still meanwhile (where the browser doesn't already).
  const rest = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ top: number; until: number } | null>(null)
  const pin = (pick: ModelPick, on: boolean) => {
    const top = rest.current?.getBoundingClientRect().top
    const view = rest.current?.closest('[data-sheet-body]')?.getBoundingClientRect().top
    anchor.current = top !== undefined && view !== undefined && top < view ? { top, until: Date.now() + 1500 } : null
    void setPinned(pick, on)
  }
  // Each frame the pins change size, before it's drawn.
  const holdStill = useCallback((pins: HTMLDivElement) => {
    const hold = new ResizeObserver(() => {
      const body = pins.closest('[data-sheet-body]')
      const held = anchor.current
      if (!held || Date.now() > held.until || !rest.current || !body) return
      body.scrollTop += rest.current.getBoundingClientRect().top - held.top
    })
    hold.observe(pins)
    return () => hold.disconnect()
  }, [])

  if (options.isPending) {
    // The list's own shape while it loads: a group label over a few rows.
    return (
      <section role="status">
        <span className="sr-only">Loading models</span>
        <span className="mb-2 flex h-4.5 items-center px-4">
          <Skeleton className="h-2.5 w-16 rounded-full" />
        </span>
        <div className="list-group overflow-hidden rounded-xl bg-fill-1">
          {[44, 58, 36, 50].map((w, i) => (
            <div key={i} className="flex min-h-12 items-center px-4">
              <Skeleton className="h-3.5 rounded-full" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      </section>
    )
  }
  if (options.isError) {
    return (
      <p className="py-8 text-center text-subhead text-ink-2">
        Can’t load models right now. Check that Hermes is running.
      </p>
    )
  }
  if (!pinned.length && !groups.length) {
    return (
      <p className="py-8 text-center text-subhead text-ink-3">
        {query.trim() ? `No models match “${query.trim()}”.` : 'No models are set up yet.'}
      </p>
    )
  }

  const row = (
    pick: ModelPick,
    model: { resting?: Date },
    { inPins = false, service, quiet = false }: { inPins?: boolean; service?: string; quiet?: boolean } = {},
  ) => {
    const key = pinKey(pick)
    // Pinned ones are listed twice: each row opens on its own.
    const place = `${inPins ? 'pins' : 'service'}/${key}`
    return (
      <ModelRow
        key={key}
        name={prettyModel(pick.model)}
        service={service}
        // (A whole service resting says so once, over its models.)
        note={model.resting && !quiet ? <Resting until={model.resting} /> : same(usual, pick) && 'Default'}
        dim={!!model.resting}
        selected={same(selected, pick)}
        busy={same(busy, pick)}
        disabled={!!busy}
        pinned={pins.includes(key)}
        inPins={inPins}
        hover={hover}
        revealed={revealed === place}
        onReveal={(on) => setRevealed(on ? place : null)}
        onPick={() => onPick(pick)}
        onPin={(on) => pin(pick, on)}
      />
    )
  }

  return (
    <div
      // With a row swiped open, a tap anywhere else in the list just closes it.
      onClickCapture={(e) => {
        if (!revealed || (e.target as Element).closest('[data-swipe-action]')) return
        e.preventDefault()
        e.stopPropagation()
        setRevealed(null)
      }}
    >
      {/* A search is a new list: it shows at once, and only pins move. */}
      <div key={query}>
        <div ref={holdStill}>
          <AnimatePresence initial={false}>
            {pinned.length > 0 && (
              <motion.section
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={grow}
                className="overflow-hidden"
              >
                <h3 className="mb-2 px-4 text-footnote font-medium text-ink-2">Pinned</h3>
                <div role="radiogroup" aria-label="Pinned" className="overflow-hidden rounded-xl bg-fill-1">
                  <AnimatePresence initial={false}>
                    {pinned.map((m) =>
                      row({ model: m.id, provider: m.provider }, m, {
                        inPins: true,
                        service: mixed ? m.service : undefined,
                      }),
                    )}
                  </AnimatePresence>
                </div>
                <div className="h-6" />
              </motion.section>
            )}
          </AnimatePresence>
        </div>
        <div ref={rest} className="space-y-6">
          {groups.map((group) => (
            <section key={group.provider}>
              <ServiceHeading name={group.name} plan={group.plan} resting={group.resting} />
              <div role="radiogroup" aria-label={group.name} className="overflow-hidden rounded-xl bg-fill-1">
                <AnimatePresence initial={false}>
                  {group.models.map((m) =>
                    row({ model: m.id, provider: group.provider }, m, { quiet: !!group.resting }),
                  )}
                </AnimatePresence>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function ModelRow({
  name,
  service,
  note,
  dim,
  selected,
  busy,
  disabled,
  pinned,
  inPins,
  hover,
  revealed,
  onReveal,
  onPick,
  onPin,
}: {
  name: string
  service?: string
  note: ReactNode
  dim: boolean
  selected: boolean
  busy: boolean
  disabled: boolean
  pinned: boolean
  /** The row among the pins, rather than in its service's list. */
  inPins: boolean
  /** A pointer that hovers: the pin shows where it's going, in the tick's place. */
  hover: boolean
  revealed: boolean
  onReveal: (on: boolean) => void
  onPick: () => void
  onPin: (on: boolean) => void
}) {
  // Unpinned among the pins, it goes the way it was pushed. In its service's list it stays.
  const action: SwipeOption = pinned
    ? { label: 'Unpin', icon: PinOff, tone: 'warning', removes: inPins, run: () => onPin(false) }
    : { label: 'Pin', icon: Pin, tone: 'warning', removes: false, run: () => onPin(true) }
  const { row, x, armed, dragged, run, drag } = useSwipe<HTMLDivElement>({
    leading: action,
    revealed: revealed ? 'leading' : null,
    onReveal: (side) => onReveal(side === 'leading'),
  })

  const pin = (
    <button
      type="button"
      data-pin=""
      onClick={() => onPin(!pinned)}
      aria-label={`${pinned ? 'Unpin' : 'Pin'} ${name}${service ? ` from ${service}` : ''}`}
      title={pinned ? 'Unpin' : 'Pin to the top'}
      className={cn(
        'pressable relative z-10 flex flex-none items-center justify-center rounded-full text-ink-3',
        hover
          ? 'size-8 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-fill-2 hover:text-ink focus-visible:opacity-100'
          : // Thumb-sized, its icon still in line with the ticks.
            '-my-1 -mr-3.5 size-11',
      )}
    >
      <Pin size={16} strokeWidth={2} aria-hidden className={cn('rotate-45', pinned && 'fill-current')} />
    </button>
  )
  const tick = busy ? (
    <Spinner size={16} className="mx-px flex-none text-ink-3" />
  ) : (
    <Check
      size={18}
      strokeWidth={2.5}
      aria-hidden
      className={cn(
        'flex-none text-accent transition-opacity duration-200',
        !selected && 'opacity-0',
        hover && 'group-hover:opacity-0 group-has-[[data-pin]:focus-visible]:opacity-0',
      )}
    />
  )
  return (
    <motion.div
      ref={row}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={grow}
      // (Its layers stay its own: the search pinned over the list stays on top.)
      className="group relative isolate overflow-hidden"
    >
      {/* Above the sliding row, inset to the text like every grouped list. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 left-4 z-10 h-[0.5px] bg-line-strong group-first:hidden"
      />
      <SwipeAction
        side="leading"
        action={action}
        x={x}
        armed={armed === 'leading'}
        shown={revealed}
        onPress={() => run('leading')}
      />
      <motion.div
        {...drag}
        className={cn(
          'relative flex min-h-12 items-center gap-3 px-4',
          'bg-elevated [background-image:linear-gradient(var(--fill-1),var(--fill-1))]',
          'before:pointer-events-none before:absolute before:inset-0 before:transition-colors before:duration-150',
          'hover:before:bg-fill-1 has-[[role=radio]:active]:before:bg-fill-2',
        )}
      >
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          disabled={disabled}
          onPointerDown={() => (dragged.current = false)}
          onClick={(e) => {
            // A swipe, or a tap on a row showing its action, never picks it.
            if (dragged.current) e.preventDefault()
            else if (!selected) onPick()
            dragged.current = false
          }}
          className={cn(
            // The whole row picks it: all but its pin.
            'flex min-w-0 flex-1 items-baseline gap-2 text-left select-none [-webkit-touch-callout:none]',
            'after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent',
          )}
        >
          <span
            className={cn('min-w-0 truncate text-body', selected && 'font-medium', dim && !selected && 'text-ink-2')}
          >
            {name}
          </span>
          {service && <span className="flex-none text-footnote text-ink-3">{service}</span>}
        </button>
        {note && <span className="flex-none text-footnote text-ink-3">{note}</span>}
        {hover ? (
          // The tick steps aside for the pin, at the row's end.
          <span className="-mr-2 grid size-8 flex-none place-items-center *:[grid-area:1/1]">
            {tick}
            {!busy && pin}
          </span>
        ) : (
          <>
            {tick}
            {pin}
          </>
        )}
      </motion.div>
    </motion.div>
  )
}
