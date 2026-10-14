import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { formatTime, uses12Hour } from './schedule'
import './routines.css'

// An iOS-style time wheel: native momentum scrolling with scroll-snap, so it
// feels right under a thumb, a trackpad and a mouse wheel alike. Items tilt
// away from the centre where the browser supports scroll-driven animations.

const ITEM = 40
const VISIBLE = 5
const PAD = ((VISIBLE - 1) / 2) * ITEM

type Item = { value: number; label: string }

// Long columns loop like a real drum: the items repeat, and once a scroll
// settles the column hops back to the middle copy, invisibly.
const REPS = 7

function Column({
  items,
  value,
  onChange,
  label,
  className,
  align = 'center',
  loop = false,
}: {
  items: Item[]
  value: number
  onChange: (v: number) => void
  label: string
  className?: string
  align?: 'start' | 'center' | 'end'
  loop?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const n = items.length
  const reps = loop ? REPS : 1
  const base = loop ? Math.floor(REPS / 2) * n : 0
  const index = Math.max(
    0,
    items.findIndex((i) => i.value === value),
  )
  // `pos` is the row under the band, counting every copy.
  const [pos, setPos] = useState(base + index)
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const userScrolling = useRef(false)
  const at = (p: number) => items[((p % n) + n) % n]

  // Follow outside changes without fighting the finger.
  useEffect(() => {
    const el = ref.current
    if (!el || userScrolling.current) return
    const current = Math.round(el.scrollTop / ITEM)
    const centred = !loop || (current >= n * 2 && current < n * (REPS - 2))
    if (at(current)?.value === value && centred) return setPos(current)
    el.scrollTop = (base + index) * ITEM
    setPos(base + index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, base])

  const rowAt = (el: HTMLDivElement) => Math.min(n * reps - 1, Math.max(0, Math.round(el.scrollTop / ITEM)))

  const commit = () => {
    const el = ref.current
    if (!el) return
    userScrolling.current = false
    const row = rowAt(el)
    const item = at(row)
    // Drifted toward an end: hop to the same row in the middle copy.
    if (loop && (row < n * 2 || row >= n * (REPS - 2))) {
      const middle = base + (((row % n) + n) % n)
      el.scrollTop = middle * ITEM
      setPos(middle)
    }
    if (item && item.value !== value) onChange(item.value)
  }

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    userScrolling.current = true
    const row = rowAt(el)
    if (row !== pos) setPos(row)
    clearTimeout(settle.current)
    settle.current = setTimeout(commit, 140)
  }

  const go = (row: number, smooth = true) => {
    const el = ref.current
    if (!el) return
    const clamped = Math.min(n * reps - 1, Math.max(0, row))
    el.scrollTo({ top: clamped * ITEM, behavior: smooth ? 'smooth' : 'auto' })
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -3, PageDown: 3 }[e.key]
    if (step) {
      e.preventDefault()
      go(pos + step)
    } else if (e.key === 'Home') go(pos - (((pos % n) + n) % n))
    else if (e.key === 'End') go(pos - (((pos % n) + n) % n) + n - 1)
  }

  const rows = loop ? Array.from({ length: reps }, () => items).flat() : items

  return (
    <div
      ref={ref}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={at(pos)?.value}
      aria-valuetext={at(pos)?.label}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      className={cn(
        'wheel-col no-scrollbar relative h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain outline-none',
        className,
      )}
      style={{ paddingBlock: PAD, scrollPaddingBlock: PAD }}
    >
      {rows.map((item, i) => (
        <button
          key={i}
          type="button"
          tabIndex={-1}
          aria-hidden={i !== pos}
          onClick={() => go(i)}
          className={cn(
            'wheel-item flex w-full snap-center items-center tabular-nums transition-colors duration-150',
            align === 'center' && 'justify-center',
            align === 'end' && 'justify-end pr-2',
            align === 'start' && 'justify-start pl-2',
            i === pos ? 'text-ink' : 'text-ink-3',
          )}
          style={{ height: ITEM }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Hours and minutes (5-minute steps), with AM/PM where the region uses it. */
export function TimeWheel({
  hour,
  minute,
  onChange,
  className,
}: {
  hour: number
  minute: number
  onChange: (hour: number, minute: number) => void
  className?: string
}) {
  const twelve = useMemo(uses12Hour, [])
  const [ampmLabels] = useState(() => {
    const am = new Date(2000, 0, 3, 9).toLocaleTimeString(undefined, { hour: 'numeric', hour12: true })
    const pm = new Date(2000, 0, 3, 21).toLocaleTimeString(undefined, { hour: 'numeric', hour12: true })
    const strip = (s: string) => s.replace(/\d+/g, '').trim() || s
    return [strip(am), strip(pm)]
  })

  const hours: Item[] = twelve
    ? Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))
    : Array.from({ length: 24 }, (_, i) => ({ value: i, label: pad2(i) }))
  const minuteValues = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), minute])].sort((a, b) => a - b)
  const minutes: Item[] = minuteValues.map((m) => ({ value: m, label: pad2(m) }))

  const pm = hour >= 12
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const to24 = (h: number, isPm: boolean) => (h % 12) + (isPm ? 12 : 0)

  return (
    <div
      className={cn('wheel group/wheel relative select-none rounded-xl bg-fill-1', className)}
      style={{ height: ITEM * VISIBLE }}
      aria-label={`Time, ${formatTime(hour, minute)}`}
      role="group"
    >
      {/* The selection band sits under the text. */}
      <div
        className="pointer-events-none absolute inset-x-2 rounded-lg bg-elevated shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_0.5px_var(--line)] group-has-focus-visible/wheel:shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_2px_var(--accent)]"
        style={{ top: PAD, height: ITEM }}
        aria-hidden
      />
      <div className="wheel-mask relative flex h-full justify-center text-title font-medium tracking-[-0.01em]">
        <Column
          label="Hour"
          loop
          className="w-16"
          align="end"
          items={hours}
          value={twelve ? h12 : hour}
          onChange={(h) => onChange(twelve ? to24(h, pm) : h, minute)}
        />
        <span className="flex w-3 items-center justify-center pb-0.5 text-ink-2" aria-hidden>
          :
        </span>
        <Column
          label="Minute"
          loop
          className="w-16"
          align="start"
          items={minutes}
          value={minute}
          onChange={(m) => onChange(hour, m)}
        />
        {twelve && (
          <Column
            label="AM or PM"
            className="ml-2 w-12 text-subhead font-semibold"
            align="start"
            items={[
              { value: 0, label: ampmLabels[0] },
              { value: 1, label: ampmLabels[1] },
            ]}
            value={pm ? 1 : 0}
            onChange={(v) => onChange(to24(h12, v === 1), minute)}
          />
        )}
      </div>
    </div>
  )
}
