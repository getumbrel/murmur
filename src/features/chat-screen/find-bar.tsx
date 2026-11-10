import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import type { ChatItem } from '@/features/chat/types'
import { popWords } from '@/features/chat/thread'
import { IconButton } from '@/ui/button'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import { hitsIn, nearest, needle, rangesIn, standing, step, type Place } from './find'

// Find in chat (⌘F, or the chat's menu): the bar takes the header's place,
// every place the words are is washed in Find's yellow, and the one you're at
// pops the way it does on a Mac. It starts from where you're reading and goes
// back through the chat, since that's the way a chat is read.

/** Where a place is in its message as drawn, for the thread to bring into sight. */
export type Spot = (message: HTMLElement) => DOMRect | undefined

type Options = {
  /** The chat on screen: another one starts afresh. */
  chat: string
  items: ChatItem[]
  /** The chat's screen, which holds its thread. */
  root: RefObject<HTMLElement | null>
  /** Reads in the rest of a long chat; undefined once it's all here. */
  whole?: () => Promise<void>
  /** Brings a place into sight. */
  show: (id: string, spot: Spot) => void
}

/** The CSS highlights the places are painted with (styles.css). */
const ALL = 'find'
const NOW = 'find-now'
const paints = () => (typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : undefined)
/** More than this in one message and they're not all worth drawing (a single letter, say). */
const MOST = 400

const forShow = (node: Node) => node instanceof Element && node.getAttribute('aria-hidden') === 'true'

const nthIn = (place: Place, ranges: Range[]) =>
  place.nth === 'last' ? ranges.length - 1 : Math.min(place.nth, ranges.length - 1)

export function useFind({ chat, items, root, whole, show }: Options) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [place, setPlace] = useState<Place>()
  /** How many places each message drawn so far really has. */
  const [seen, setSeen] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [reading, setReading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  /** The message Find reads back from: where you were when it opened, then wherever you've stepped to. */
  const origin = useRef<string>(undefined)

  const q = open ? needle(query) : ''
  const hits = useMemo(() => hitsIn(items, q, seen), [items, q, seen])
  const total = useMemo(() => hits.reduce((n, h) => n + h.count, 0), [hits])

  const latest = useRef({ place, show, whole })
  latest.current = { place, show, whole }

  const start = useCallback(() => {
    const log = root.current?.querySelector('[role=log]')
    if (log && !open) {
      // The last message in sight is where you are.
      const frame = log.getBoundingClientRect()
      const inSight = [...log.querySelectorAll<HTMLElement>('[data-message]')].findLast((el) => {
        const at = el.getBoundingClientRect()
        return at.height > 0 && at.top < frame.bottom
      })
      origin.current = inSight?.dataset.message
    }
    // Drawn at once, so the field takes focus inside the tap that asked: a phone only raises its keyboard then.
    flushSync(() => setOpen(true))
    input.current?.focus()
    input.current?.select()
  }, [open, root])

  const done = useCallback(() => {
    setOpen(false)
    setPlace(undefined)
    setSeen(new Map())
  }, [])

  // Another chat: Find is put away.
  const [was, setWas] = useState(chat)
  if (was !== chat) {
    setWas(chat)
    setOpen(false)
    setQuery('')
    setPlace(undefined)
    setSeen(new Map())
  }

  const type = (value: string) => {
    setQuery(value)
    const next = needle(value)
    if (next === q) return
    setSeen(new Map())
    setPlace(nearest(hitsIn(items, next), items, origin.current))
  }

  const go = (older: boolean) => {
    const next = step(hits, place, older)
    if (!next) return
    origin.current = next.id
    setPlace(next)
  }

  // A long chat is read to its start, so Find covers all of it.
  const more = !!whole
  useEffect(() => {
    if (!open || !more) return
    let live = true
    setReading(true)
    void latest.current
      .whole?.()
      .catch(() => {})
      .finally(() => live && setReading(false))
    return () => {
      live = false
      setReading(false)
    }
  }, [open, more])

  // Nowhere yet, or the place is gone (its message was, or more of the chat came in): the nearest one.
  useEffect(() => {
    if (!q || (place && hits.some((h) => h.id === place.id))) return
    const next = nearest(hits, items, place?.id ?? origin.current)
    if (next || place) setPlace(next)
  }, [q, hits, items, place])

  // The place you're at comes into sight.
  const id = place?.id
  const nth = place?.nth
  useEffect(() => {
    if (!q || !id || nth === undefined) return
    const at: Place = { id, nth }
    latest.current.show(id, (message) => {
      const ranges = rangesIn(message, q, MOST)
      return ranges[nthIn(at, ranges)]?.getBoundingClientRect()
    })
  }, [q, id, nth])

  // Every place on screen is painted, again whenever what's drawn changes.
  const popped = useRef('')
  const unpop = useRef<() => void>(undefined)
  useEffect(() => {
    const log = root.current?.querySelector<HTMLElement>('[role=log]')
    const paint = paints()
    if (!q || !log) return
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const draw = () => {
      frame = 0
      const at = latest.current.place
      const all: Range[] = []
      let now: Range | undefined
      let nowIn: HTMLElement | undefined
      const counts = new Map<string, number>()
      for (const message of log.querySelectorAll<HTMLElement>('[data-message]')) {
        const ranges = rangesIn(message, q, MOST)
        // (A message still being drawn has none yet: only what's found is the truth.)
        if (ranges.length && ranges.length < MOST) counts.set(message.dataset.message!, ranges.length)
        const mine = at && message.dataset.message === at.id ? ranges[nthIn(at, ranges)] : undefined
        if (mine) {
          now = mine
          nowIn = message
        }
        for (const range of ranges) if (range !== mine) all.push(range)
      }
      paint?.set(ALL, new Highlight(...all))
      if (now) paint?.set(NOW, new Highlight(now))
      else paint?.delete(NOW)
      setSeen((before) => {
        let same = true
        for (const [key, count] of counts) if (before.get(key) !== count) same = false
        return same ? before : new Map([...before, ...counts])
      })
      // Arriving at a place, it pops once.
      const key = at ? `${q}\n${at.id}\n${at.nth}` : ''
      if (now && nowIn && popped.current !== key) {
        popped.current = key
        unpop.current?.()
        unpop.current = popWords(nowIn, [now])
      }
    }
    const soon = () => {
      if (frame || timer) return
      timer = setTimeout(() => {
        timer = undefined
        frame = requestAnimationFrame(draw)
      }, 60)
    }
    draw()
    const watch = new MutationObserver((changes) => {
      // (Its own lozenge coming and going isn't a change to the words.)
      if (changes.every((c) => c.type === 'childList' && [...c.addedNodes, ...c.removedNodes].every(forShow))) return
      soon()
    })
    watch.observe(log, { childList: true, subtree: true, characterData: true })
    return () => {
      watch.disconnect()
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      paint?.delete(ALL)
      paint?.delete(NOW)
      unpop.current?.()
    }
  }, [q, id, nth, root])

  return {
    open,
    query,
    type,
    /** Anything typed that's worth looking for. */
    asked: !!q,
    total,
    /** Which place you're at, counted from the newest. */
    at: standing(hits, place),
    /** Still reading the chat's older messages in. */
    reading,
    older: () => go(true),
    newer: () => go(false),
    start,
    done,
    input,
  }
}

export type Find = ReturnType<typeof useFind>

/** The bar itself, in the chat header's row. */
export function FindBar({ find, onDone }: { find: Find; onDone: () => void }) {
  const { asked, total, at, reading } = find
  const count = !asked ? '' : total ? `${at || 1} of ${total}` : reading ? '' : 'No matches'
  return (
    <div role="search" className="flex min-w-0 flex-1 animate-fade items-center gap-0.5 pr-1 pl-3 sm:pr-2 sm:pl-4">
      <label className="relative flex min-w-0 flex-1 items-center">
        <Search size={17} strokeWidth={2} aria-hidden className="pointer-events-none absolute left-3 text-ink-3" />
        <input
          ref={find.input}
          type="search"
          value={find.query}
          onChange={(e) => find.type(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) find.newer()
              else find.older()
            }
          }}
          placeholder="Find in chat"
          aria-label="Find in chat"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          className={cn(
            'h-10 w-full rounded-xl bg-fill-2 pl-9.5 text-body text-ink outline-none placeholder:text-ink-3',
            'ring-1 ring-transparent ring-inset transition-[background-color,box-shadow] duration-200 focus:ring-line-strong',
            '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
            asked ? 'pr-24' : 'pr-3',
          )}
        />
        <span
          role="status"
          className="pointer-events-none absolute right-3 flex items-center text-footnote whitespace-nowrap text-ink-3 tabular-nums"
        >
          {asked && reading && !total ? <Spinner size={14} /> : count}
        </span>
      </label>
      {/* (The field keeps focus, and a phone its keyboard, while you step.) */}
      <IconButton
        size="lg"
        label="Earlier match"
        disabled={!total}
        onPointerDown={(e) => e.preventDefault()}
        onClick={find.older}
        className="ml-0.5 -mr-1.5"
      >
        <ChevronUp size={22} strokeWidth={2} aria-hidden />
      </IconButton>
      <IconButton
        size="lg"
        label="Later match"
        disabled={!total}
        onPointerDown={(e) => e.preventDefault()}
        onClick={find.newer}
      >
        <ChevronDown size={22} strokeWidth={2} aria-hidden />
      </IconButton>
      <button
        type="button"
        onClick={onDone}
        className="pressable touch-target relative h-11 flex-none rounded-full px-2.5 text-body font-medium text-accent select-none sm:px-3"
      >
        Done
      </button>
    </div>
  )
}
