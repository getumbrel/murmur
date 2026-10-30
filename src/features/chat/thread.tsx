import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { ArrowDown, Check, CircleAlert, Clock3, Copy, PencilLine } from 'lucide-react'
import { useStickToBottom } from 'use-stick-to-bottom'
import { Orb } from '@/ui/orb'
import { Button } from '@/ui/button'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import type { ApprovalChoice, ChatItem, Speaker } from './types'
import { Work, type WorkItem } from './work'
import { RichText } from '@/features/media/rich-text'
import { UserAttachments } from '@/features/media/attachments'
import { ToolMedia } from '@/features/media/tool-media-view'
import { MediaProvider, type MediaContext } from '@/features/media/context'
import { mediaPathsOf, proseOf } from '@shared/message.ts'
import { ApprovalCard } from './approval-card'
import { ClarifyCard } from './clarify-card'
import { SecretCard } from './secret-card'
import { MessageActions } from './message-actions'
import { MentionText, MentionsProvider } from './mention'
import { MessageMenu, useLongPress, type MenuAction } from './message-menu'
import { useCopy } from './use-copy'
import { AsideCard, CommandCard } from './side-cards'
import { ERROR_ACTION_LABEL, errorActionOf, type ErrorAction } from './errors'
import { Plan } from './plan'
import { HelperPill, Helpers, HelpersBack, useCardInSight } from './helpers'
import { WakeLine } from './wake-line'
import { ReactionBadge, ReactionPills, Tapback, useHoldToReact } from './reactions'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

type Block =
  | { kind: 'work'; id: string; items: WorkItem[] }
  | { kind: 'text'; id: string; item: Of<'assistant'> }
  | { kind: 'approval'; id: string; item: Of<'approval'> }
  | { kind: 'clarify'; id: string; item: Of<'clarify'> }
  | { kind: 'secret'; id: string; item: Of<'secret'> }
  | { kind: 'error'; id: string; item: Of<'error'> }
  | { kind: 'plan'; id: string; item: Of<'plan'> }
  /** Helpers the agent sent off; `back`, when Hermes woke the agent with them. */
  | { kind: 'helpers'; id: string; items: Of<'helper'>[]; back?: Of<'wake'> }
  | { kind: 'wake'; id: string; item: Of<'wake'> }

type Section = { id: string; speaker?: Speaker; blocks: Block[] }

type Row =
  | { kind: 'user'; id: string; item: Of<'user'> }
  | { kind: 'notice'; id: string; item: Of<'notice'> }
  | { kind: 'command'; id: string; item: Of<'command'> }
  | { kind: 'aside'; id: string; item: Of<'aside'> }
  /** `woken`: Hermes started it, not you (a helper came back, say). */
  | { kind: 'turn'; id: string; sections: Section[]; woken?: boolean }

const DEFAULT_HUE = 278
/** How the buttons over the composer come and go. */
const FLOAT = { type: 'spring', stiffness: 420, damping: 32 } as const
/** The helpers' pill, and the gap under it. */
const PILL_ROOM = 36 + 12
/** How the thread follows a growing reply. */
const SPRING = { damping: 0.75, stiffness: 0.08, mass: 1 }
/** How long a chat that just opened keeps jumping to its end, while late layout (markdown, code, images) settles. */
const SETTLE_MS = 1200
/** Rows a long chat paints at first, and how many more join each time you scroll up to the oldest shown. */
const WINDOW = 60
/** Rows kept above a message the thread was opened at, for what led up to it. */
const LEADUP = 8

/**
 * Folds the flat item list into user messages and assistant turns. Settled
 * permission requests from history fold into the work steps; ones settled
 * while you watched (`live`) stay put as a receipt. Side questions and
 * command cards asked mid-reply wait until that reply is done, so it reads
 * in one piece.
 */
function toRows(items: ChatItem[], busy: boolean, live: Set<string>): Row[] {
  const rows: Row[] = []
  let turn: Extract<Row, { kind: 'turn' }> | null = null
  let prev = 'start'
  let aside: Row[] = []
  // Helpers so far, by who they are: a wake that brings them back shows their faces.
  const sentOff = new Map<string, Of<'helper'>>()

  for (const item of items) {
    if (item.kind === 'helper') sentOff.set(item.subagentId, item)
    if (item.kind === 'aside' || item.kind === 'command') {
      const row = { kind: item.kind, id: item.id, item } as Row
      if (turn) aside.push(row)
      else rows.push(row)
      continue
    }
    if (item.kind === 'user' || item.kind === 'notice') {
      rows.push(...aside)
      aside = []
      rows.push({ kind: item.kind, id: item.id, item } as Row)
      turn = null
      prev = item.id
      continue
    }
    if (item.kind === 'wake') {
      // Hermes woke the agent: a turn of its own, opened by what came back.
      rows.push(...aside)
      aside = []
      const back = item.reason === 'helpers' ? [...sentOff.values()].filter((h) => cameBack(h, item)) : []
      const block: Block =
        item.reason === 'helpers'
          ? { kind: 'helpers', id: item.id, items: back, back: item }
          : { kind: 'wake', id: item.id, item }
      turn = { kind: 'turn', id: `turn-${item.id}`, sections: [{ id: item.id, blocks: [block] }], woken: true }
      rows.push(turn)
      prev = item.id
      continue
    }
    if (!turn) {
      // Keyed by what precedes it, so a placeholder turn becomes the real one in place.
      turn = { kind: 'turn', id: `turn-${prev}`, sections: [] }
      rows.push(turn)
    }
    const speaker = 'speaker' in item ? item.speaker : undefined
    let section = turn.sections.at(-1)
    if (!section || (speaker && section.speaker?.id !== speaker.id)) {
      section = { id: item.id, speaker, blocks: [] }
      turn.sections.push(section)
    }
    const last = section.blocks.at(-1)
    // The same failure reported twice (as an event and as the reply's end) reads once.
    if (item.kind === 'error' && last?.kind === 'error' && last.item.message === item.message) continue
    // Sending helpers off: their card takes the step's place as soon as the call returns (a failed one stays a step).
    if (item.kind === 'tool' && item.name === 'delegate_task' && item.status === 'running') continue
    if (
      item.kind === 'tool' ||
      item.kind === 'thinking' ||
      (item.kind === 'approval' && item.status !== 'pending' && !live.has(item.id))
    ) {
      if (last?.kind === 'work') last.items.push(item)
      else section.blocks.push({ kind: 'work', id: item.id, items: [item] })
    } else if (item.kind === 'helper') {
      // Helpers sent off together stack together.
      if (last?.kind === 'helpers' && !last.back) last.items.push(item)
      else section.blocks.push({ kind: 'helpers', id: item.id, items: [item] })
    } else {
      section.blocks.push({ kind: item.kind === 'assistant' ? 'text' : item.kind, id: item.id, item } as Block)
    }
  }

  if (busy && !turn) rows.push({ kind: 'turn', id: `turn-${prev}`, sections: [] })
  rows.push(...aside)
  return rows
}

/** The row a message is in: its own, or the reply it's part of. */
const holds = (row: Row, itemId: string) =>
  row.id === itemId || (row.kind === 'turn' && row.sections.some((s) => s.blocks.some((b) => b.id === itemId)))

/** How long a word found by search stays marked: the length of its animation in styles.css. */
const FIND_MS = 2800

/**
 * Marks the words a message was found by, as Find does on a Mac: a yellow
 * lozenge over each, a copy of the word drawn over the message rather than
 * into it, so what React rendered is left alone. False when none shows.
 */
function markWords(message: HTMLElement, words: string[]) {
  if (!words.length) return false
  const either = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const find = new RegExp(`(?<![\\p{L}\\p{N}])(?:${either})(?![\\p{L}\\p{N}])`, 'giu')
  const ranges: Range[] = []
  const walk = document.createTreeWalker(message, NodeFilter.SHOW_TEXT)
  for (let node = walk.nextNode(); node && ranges.length < 24; node = walk.nextNode()) {
    for (const m of (node.nodeValue ?? '').matchAll(find)) {
      const range = document.createRange()
      range.setStart(node, m.index)
      range.setEnd(node, m.index + m[0].length)
      if (range.getClientRects().length) ranges.push(range)
    }
  }
  if (!ranges.length) return false
  // Where it falls is where it's measured from: it moves nothing.
  const layer = document.createElement('span')
  layer.setAttribute('aria-hidden', 'true')
  layer.style.position = 'absolute'
  const marks = ranges.map((range) => {
    const mark = document.createElement('span')
    mark.className = 'find'
    mark.textContent = range.toString()
    const type = getComputedStyle(range.startContainer.parentElement ?? message)
    for (const p of TYPE) mark.style[p] = type[p]
    layer.append(mark)
    return mark
  })
  message.append(layer)
  const lay = () => {
    const at = layer.getBoundingClientRect()
    ranges.forEach((range, i) => {
      const word = range.getClientRects()[0]
      if (!word) return
      Object.assign(marks[i].style, {
        left: `${word.left - at.left - 3}px`,
        top: `${word.top - at.top - 1}px`,
        lineHeight: `${word.height}px`,
      })
    })
  }
  lay()
  const ro = new ResizeObserver(lay)
  ro.observe(message)
  setTimeout(() => {
    ro.disconnect()
    layer.remove()
  }, FIND_MS)
  return true
}

/** What a word's copy takes from the word, so it lies exactly over it. */
const TYPE = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontStretch',
  'letterSpacing',
  'fontFeatureSettings',
  'fontVariationSettings',
  'textTransform',
] as const

/** One of the helpers a wake brings back: named by it, or (when it names no one) of its errand. */
const cameBack = (h: Of<'helper'>, wake: Of<'wake'>) =>
  wake.subagentIds
    ? wake.subagentIds.includes(h.subagentId)
    : !!wake.delegationId && h.delegationId === wake.delegationId

type Handlers = {
  onApprove: (requestId: string, choice: ApprovalChoice) => void
  onAnswer: (requestId: string, answers: Record<string, string>) => void
  /** A masked answer (a login, a code, a key); empty for "not now". */
  onSecret?: (requestId: string, value: string) => void
  onRetry?: () => void
  /** The way out an error offers: Models, or a fresh chat. */
  onErrorAction?: (action: ErrorAction) => void
  /** Tapback on a message, or take yours back (the same emoji again). */
  onReact?: (itemId: string, emoji: string) => void
  /** Call back a helper the agent sent off. */
  onStopHelper?: (subagentId: string) => void
}

type Extras = {
  /** Your message that can be edited and sent again (the last one, when idle). */
  editableId?: string
  /** The message being rewritten in the composer: it's marked, and what follows it dims. */
  editingId?: string
  onEdit?: (item: Of<'user'>) => void
  /** Puts away a side answer or command card. */
  onDismiss?: (itemId: string) => void
}

type Props = Handlers &
  Extras & {
    items: ChatItem[]
    busy: boolean
    /** The agent this chat is with; colours the working orb in one-to-one chats. */
    agent?: Speaker
    emptyState?: ReactNode
    /** Above the first message, scrolling with them: what a routine's run was for. */
    lead?: ReactNode
    /** Hermes has older messages than these: reads them in, as you near the top. */
    onOlder?: () => Promise<void>
    /** The connection is down: a message Hermes hasn't taken yet shows it's waiting. */
    waiting?: boolean
    /** A message to open at (a search result's), the words to mark in it, and when that was asked: asked again, it opens there again. */
    focus?: { id: string; at: number; words?: string[] }
    /** Pinned under the messages, e.g. the composer. Messages scroll beneath it. */
    footer?: ReactNode
    className?: string
    /** Which chat the files in it belong to, and how widgets talk back. */
    media?: MediaContext
  }

const NO_MEDIA: MediaContext = {}

/**
 * The top of what's been read, when Hermes has older messages: the page
 * before is read a screen ahead of you reaching it, and its rows join above
 * without moving what you're reading. A spinner if you get there first;
 * Try again if the read failed.
 */
function Earlier({ load, root }: { load: () => Promise<void>; root: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef(load)
  latest.current = load
  const [failed, setFailed] = useState(false)
  // Bumped after each read, so a top still in reach reads the next page.
  const [reads, setReads] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || failed) return
    let live = true
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        latest.current().then(
          () => live && setReads((n) => n + 1),
          () => live && setFailed(true),
        )
      },
      { root: root.current, rootMargin: '100% 0px 0px 0px' },
    )
    io.observe(el)
    return () => {
      live = false
      io.disconnect()
    }
  }, [failed, reads, root])
  if (failed)
    return (
      <p className="mb-6 text-center text-footnote text-balance text-ink-3">
        Can’t load earlier messages right now.{' '}
        <button type="button" onClick={() => setFailed(false)} className="pressable font-medium text-accent">
          Try again
        </button>
      </p>
    )
  // Out of the flow, so nothing shifts when it goes.
  return (
    <div ref={ref} className="relative h-0">
      <Spinner className="absolute bottom-2 left-1/2 -translate-x-1/2 text-ink-3" />
    </div>
  )
}

export function Thread({
  items,
  busy,
  agent,
  emptyState,
  lead,
  onOlder,
  waiting,
  focus,
  footer,
  className,
  media = NO_MEDIA,
  editableId,
  editingId,
  onEdit,
  onDismiss,
  ...handlers
}: Props) {
  // The thread follows a reply as it grows with a soft spring, but a chat
  // opens already at the bottom: while its history is still arriving (and
  // laying out) it jumps, and under reduced motion it always does.
  const reduced = useReducedMotion()
  const settleUntil = useRef(0)
  const still = () => reduced || performance.now() < settleUntil.current
  const { scrollRef, contentRef, isAtBottom, scrollToBottom, stopScroll, state: stick } = useStickToBottom({
    initial: 'instant',
    // (Read when the content resizes, so the window above is current.)
    get resize() {
      return still() ? 'instant' : SPRING
    },
  })
  // Steady callbacks, so settled turns don't re-render while a reply streams.
  const latest = useRef(handlers)
  latest.current = handlers
  const stable = useMemo<Handlers>(
    () => ({
      onApprove: (id, choice) => latest.current.onApprove(id, choice),
      onAnswer: (id, answers) => latest.current.onAnswer(id, answers),
      onSecret: (id, value) => latest.current.onSecret?.(id, value),
      onRetry: () => latest.current.onRetry?.(),
      onErrorAction: (action) => latest.current.onErrorAction?.(action),
      onReact: (itemId, emoji) => latest.current.onReact?.(itemId, emoji),
      onStopHelper: (subagentId) => latest.current.onStopHelper?.(subagentId),
    }),
    [],
  )

  const watched = useRef(new Set<string>())
  for (const i of items) if (i.kind === 'approval' && i.status === 'pending') watched.current.add(i.id)
  const rows = useMemo(() => toRows(items, busy, watched.current), [items, busy])
  // A long chat paints its newest rows, and older ones join as you scroll up
  // to them: rendering every saved message up front made opening one slow.
  // Held by the oldest row shown, so another conversation starts afresh.
  const [oldest, setOldest] = useState<string>()
  // Opened at a message further back, it's held by the newest row shown too,
  // and newer ones join as you scroll down to them.
  const [newest, setNewest] = useState<string>()
  const [opened, setOpened] = useState<number>()
  let first = oldest
  let last = newest
  const target = focus && focus.at !== opened ? rows.findIndex((r) => holds(r, focus.id)) : -1
  if (focus && target >= 0) {
    first = rows[Math.max(0, target - LEADUP)].id
    last = target + WINDOW < rows.length - 1 ? rows[target + WINDOW].id : undefined
    setOpened(focus.at)
    setOldest(first)
    setNewest(last)
  }
  const end = last ? rows.findIndex((r) => r.id === last) : -1
  if (newest && end < 0) setNewest(undefined)
  const to = end < 0 ? rows.length : end + 1
  const at = first ? rows.findIndex((r) => r.id === first) : -1
  const from = Math.min(at < 0 ? to : at, Math.max(0, to - WINDOW))
  if (rows.length && rows[from].id !== first) setOldest(rows[from].id)
  const shown = from || to < rows.length ? rows.slice(from, to) : rows
  // Somewhere back in the chat, with newer rows below what's shown.
  const back = to < rows.length

  // History appears without animation: whatever is there on first paint, and
  // any batch of several items landing at once (a transcript loading late).
  // `known` is everything shown so far; `seen` what arrived as history.
  const seen = useRef<Set<string> | null>(null)
  const known = useRef<Set<string> | null>(null)
  seen.current ??= new Set()
  known.current ??= new Set()
  const fresh = new Set([...items, ...rows].map((x) => x.id).filter((id) => !known.current!.has(id)))
  // (Except the first message of a new chat: that one you just sent.)
  const justSent = items.length === 1 && items[0].kind === 'user'
  // (A ref, not a local: the render that took them in may not be the one committed.)
  const landed = useRef(false)
  if (fresh.size && ((!known.current.size && !justSent) || fresh.size > 4)) {
    landed.current = true
    fresh.forEach((id) => seen.current!.add(id))
  }
  fresh.forEach((id) => known.current!.add(id))
  const isNew = (id: string) => !seen.current!.has(id)

  // Sending always brings you back to the bottom; a message that arrived with
  // the history is already there.
  const lastUser = items.findLast((i) => i.kind === 'user')?.id
  const lastUserIsNew = !!lastUser && isNew(lastUser)
  const prevUser = useRef(lastUser)
  // Back to the end from further back: its rows are shown, then it's scrolled to.
  // (A message it was opened at no longer holds it in place.)
  const toEnd = useRef(false)
  const settling = useRef<() => void>(undefined)
  const toLatest = () => {
    settling.current?.()
    if (!back) return void scrollToBottom(reduced ? 'instant' : 'smooth')
    toEnd.current = true
    setNewest(undefined)
    setOldest(undefined)
  }
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!toEnd.current || !el || back) return
    toEnd.current = false
    el.scrollTop = el.scrollHeight
    void scrollToBottom('instant')
  })
  useEffect(() => {
    if (prevUser.current === lastUser) return
    prevUser.current = lastUser
    if (!lastUserIsNew) return
    settling.current?.()
    if (back) toLatest()
    else void scrollToBottom(still() ? 'instant' : 'smooth')
  })

  const lastTurn = rows.findLast((r) => r.kind === 'turn')?.id
  // Who reads replies aloud: the agent in a one-to-one chat.
  const voice = media.profile ?? agent?.id
  const editingAt = editingId ? shown.findIndex((r) => r.id === editingId) : -1

  // The composer floats over the end of the thread, outside the message log;
  // the log keeps room for it underneath.
  // (Sized straight from the measure, so the room is there before the first paint.)
  const footerRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  // Room kept for what floats above the composer while you're at the end (the helpers' pill).
  const floatRoom = useRef(0)
  const [under, setUnder] = useState(0)
  useLayoutEffect(() => {
    const el = footerRef.current
    if (!el) return
    const measure = () => {
      if (spacerRef.current) spacerRef.current.style.height = `${el.offsetHeight + floatRoom.current}px`
      setUnder(Math.round(el.offsetHeight / 8) * 8)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Helpers still out (the newest ones sent), with the ones sent alongside them and whose they are.
  const errand = useMemo(() => {
    for (const row of [...rows].reverse()) {
      if (row.kind !== 'turn') continue
      for (const section of [...row.sections].reverse())
        for (const block of section.blocks)
          if (block.kind === 'helpers' && !block.back && block.items.some((h) => h.status === 'running'))
            return { items: block.items, speaker: section.speaker ?? agent }
    }
  }, [rows, agent])
  const outIds = errand?.items.flatMap((h) => (h.status === 'running' ? [h.id] : [])) ?? []
  const cardInSight = useCardInSight(scrollRef, outIds, under)
  const pill = !!errand && outIds.length > 0 && !cardInSight

  // The pill floats over the end of the thread too, so the log makes room for it
  // there: it never sits on the last reply. (The room eases in and out.) Once the
  // last helper is back, the room waits for the turn that wakes the agent, whose
  // line takes the pill's place, so the thread doesn't dip first and then jump.
  const lastRow = rows.at(-1)?.id ?? ''
  const heldAt = useRef<string | null>(null)
  useLayoutEffect(() => {
    const spacer = spacerRef.current
    const footer = footerRef.current
    if (!spacer || !footer) return
    const fit = (room: number) => {
      if (floatRoom.current === room) return
      floatRoom.current = room
      const height = `${footer.offsetHeight + room}px`
      spacer.animate([{ height: spacer.style.height }, { height }], {
        duration: reduced ? 0 : 320,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      })
      spacer.style.height = height
    }
    if (pill) {
      heldAt.current = null
      return fit(PILL_ROOM)
    }
    if (!floatRoom.current) return
    // Gone because its card came into sight, or the woken turn is here.
    if (outIds.length || (heldAt.current !== null && heldAt.current !== lastRow)) return fit(0)
    heldAt.current ??= lastRow
    const wait = setTimeout(() => fit(0), 2500)
    return () => clearTimeout(wait)
  }, [pill, outIds.length, lastRow, reduced])

  // History that lands is already scrolled to its end when it first paints.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!landed.current || !el) return
    landed.current = false
    // (Unless you've scrolled up to read: that stays where it is.)
    if (!stick.isAtBottom) return
    settleUntil.current = performance.now() + SETTLE_MS
    el.scrollTop = el.scrollHeight
  })

  // Older rows join a screen before you reach them, and you stay on the lines
  // you were reading. Watched afresh after each, so one that still leaves you
  // near the top brings the next.
  const olderRef = useRef<HTMLDivElement>(null)
  // The row that was oldest, and where it sat: it moves down by just what joined above it.
  const kept = useRef<{ row: HTMLElement; top: number } | null>(null)
  const above = from ? rows[Math.max(0, from - WINDOW)].id : undefined
  useEffect(() => {
    const el = scrollRef.current
    const sentinel = olderRef.current
    if (!el || !sentinel || !above) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        const row = sentinel.nextElementSibling
        if (row instanceof HTMLElement) {
          kept.current = { row, top: row.offsetTop }
          // Just this once the move is ours alone: the browser's own scroll anchoring, where it has one, would add it again.
          el.style.overflowAnchor = 'none'
        }
        setOldest(above)
      },
      { root: el, rootMargin: '100% 0px 0px 0px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [above, scrollRef])
  useLayoutEffect(() => {
    const el = scrollRef.current
    const was = kept.current
    if (!el || !was) return
    kept.current = null
    // Added to wherever you've scrolled since, so a flick in between isn't undone.
    el.scrollTop += was.row.offsetTop - was.top
    el.style.overflowAnchor = ''
  }, [from, scrollRef])

  // Further back, newer rows join a screen before you reach the last one
  // shown. They're not the end of the chat, so the thread doesn't follow
  // them down; the last of them is, and from there it's the live chat again.
  const newerRef = useRef<HTMLDivElement>(null)
  const below = back ? (to + WINDOW < rows.length ? rows[to - 1 + WINDOW].id : '') : undefined
  useEffect(() => {
    const el = scrollRef.current
    const sentinel = newerRef.current
    if (!el || !sentinel || below === undefined) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        stopScroll()
        setNewest(below || undefined)
      },
      { root: el, rootMargin: '0px 0px 100% 0px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [below, scrollRef, stopScroll])

  // Opened at a message: it sits a little way down the screen with the words
  // it was found by marked, and stays put while what's above it lays out.
  const placed = useRef<number>(undefined)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content || !focus || opened !== focus.at || placed.current === focus.at) return
    const message = el.querySelector<HTMLElement>(`[data-message="${CSS.escape(focus.id)}"]`)
    if (!message) return
    placed.current = focus.at
    settling.current?.()
    stopScroll()
    const place = () => {
      if (!message.isConnected) return done()
      const top = parseFloat(getComputedStyle(el).paddingTop) || 0
      const room = el.clientHeight - top - under
      const offset = top + Math.max(16, (room - message.offsetHeight) * 0.4)
      el.scrollTop += message.getBoundingClientRect().top - el.getBoundingClientRect().top - offset
    }
    place()
    if (!markWords(message, focus.words ?? [])) {
      message.classList.remove('found')
      void message.offsetWidth
      message.classList.add('found')
    }
    // Until you scroll, or it's settled.
    const ro = new ResizeObserver(() => place())
    ro.observe(content)
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown']
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = () => {
      clearTimeout(timer)
      ro.disconnect()
      for (const e of events) el.removeEventListener(e, done)
      if (settling.current === done) settling.current = undefined
    }
    for (const e of events) el.addEventListener(e, done, { passive: true })
    timer = setTimeout(done, SETTLE_MS)
    settling.current = done
  })
  useEffect(() => () => settling.current?.(), [])

  return (
    <MotionConfig reducedMotion="user">
      <MediaProvider value={media}>
        <MentionsProvider>
          <div className={cn('hue-scope relative h-full min-h-0', className)}>
            <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain" role="log" aria-label="Messages">
              <div ref={contentRef} className="flex min-h-full flex-col">
                {/* One reading column (~688px of text), shared with the composer below. */}
                <div className="relative mx-auto flex w-full max-w-[736px] flex-1 flex-col px-4 pt-6 pb-12 sm:px-6">
                  {/* The chat's opening (a routine run's header) waits above its first message. */}
                  {from ? (
                    <div ref={olderRef} aria-hidden />
                  ) : onOlder && rows.length ? (
                    <Earlier load={onOlder} root={scrollRef} />
                  ) : (
                    lead
                  )}
                  {rows.length === 0 && emptyState ? (
                    <div className="flex flex-1 flex-col items-center justify-center">{emptyState}</div>
                  ) : (
                    // Rows that leave (an edited message's old reply, an undo) fold away
                    // in place while the rest carries on.
                    <AnimatePresence initial={false} mode="popLayout">
                      {shown.map((row, i) => {
                        // 24px between exchanges; a reply sits closer (16px) to what it answers.
                        const gap = i === 0 ? '' : row.kind === 'turn' && shown[i - 1].kind === 'user' ? 'mt-4' : 'mt-6'
                        // An edited message keeps its place (and its bubble).
                        const key = row.kind === 'user' ? (row.item.was ?? row.id) : row.id
                        let content: ReactNode
                        if (row.kind === 'user')
                          content = (
                            <UserMessage
                              item={row.item}
                              isNew={isNew(key)}
                              onEdit={row.id === editableId ? onEdit : undefined}
                              editing={i === editingAt}
                              waiting={waiting && row.item.pending}
                            />
                          )
                        else if (row.kind === 'notice')
                          content = (
                            <p className="mx-auto max-w-sm text-center text-footnote text-balance text-ink-3">
                              {row.item.text}
                            </p>
                          )
                        else if (row.kind === 'command')
                          content = <CommandCard item={row.item} isNew={isNew(row.id)} onDismiss={onDismiss} />
                        else if (row.kind === 'aside')
                          content = <AsideCard item={row.item} isNew={isNew(row.id)} onDismiss={onDismiss} />
                        else {
                          const last = row.id === lastTurn
                          content = (
                            <Turn
                              speakKey={`${media.sessionId ?? ''}:${row.id}`}
                              sections={row.sections}
                              live={busy && last}
                              last={last}
                              agent={agent}
                              voice={voice}
                              isNew={isNew(row.id)}
                              onApprove={stable.onApprove}
                              onAnswer={stable.onAnswer}
                              onSecret={handlers.onSecret ? stable.onSecret : undefined}
                              // Trying again asks your last message again: a turn Hermes started isn't one of those.
                              onRetry={last && !row.woken && handlers.onRetry ? stable.onRetry : undefined}
                              onErrorAction={last && handlers.onErrorAction ? stable.onErrorAction : undefined}
                              onReact={handlers.onReact ? stable.onReact : undefined}
                              onStopHelper={handlers.onStopHelper ? stable.onStopHelper : undefined}
                            />
                          )
                        }
                        return (
                          <motion.div
                            key={key}
                            className={cn(
                              gap,
                              'transition-opacity duration-300 ease-(--ease-out)',
                              editingAt >= 0 && i > editingAt && 'opacity-40',
                            )}
                            exit={{
                              opacity: 0,
                              scale: 0.98,
                              y: -4,
                              transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
                            }}
                            style={{ transformOrigin: '50% 0%' }}
                          >
                            {content}
                          </motion.div>
                        )
                      })}
                    </AnimatePresence>
                  )}
                  {back && <div ref={newerRef} aria-hidden />}
                </div>

                <div ref={spacerRef} aria-hidden className="flex-none" />
              </div>
            </div>
            <div ref={footerRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
              <div aria-hidden className="absolute inset-x-0 top-6 bottom-0 bg-linear-to-t from-bg from-30% to-transparent" />
              <div className="pointer-events-auto relative mx-auto w-full max-w-[736px]">
                {/* Floating just above the composer: helpers still out, and the way back down. */}
                <div className="pointer-events-none absolute inset-x-0 bottom-full mb-3 flex justify-center gap-2 px-4">
                  <AnimatePresence mode="popLayout">
                    {errand && pill && (
                      <motion.div
                        key="helpers"
                        layout="position"
                        initial={{ opacity: 0, y: 8, scale: 0.94 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.94 }}
                        transition={FLOAT}
                        className="pointer-events-auto min-w-0"
                      >
                        <HelperPill
                          items={errand.items}
                          agent={errand.speaker}
                          hue={errand.speaker?.hue ?? DEFAULT_HUE}
                          scrollRef={scrollRef}
                        />
                      </motion.div>
                    )}
                    {(!isAtBottom || back) && (
                      <motion.button
                        key="latest"
                        type="button"
                        layout="position"
                        onClick={toLatest}
                        initial={{ opacity: 0, y: 8, scale: 0.94 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.94 }}
                        transition={FLOAT}
                        className="glass pointer-events-auto relative flex h-9 flex-none items-center gap-1.5 rounded-full pr-3.5 pl-3 text-footnote font-medium text-ink shadow-float ring-[0.5px] ring-line-strong after:absolute after:-inset-1"
                      >
                        <ArrowDown size={15} strokeWidth={2} aria-hidden />
                        Latest
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
                {footer}
              </div>
            </div>
          </div>
        </MentionsProvider>
      </MediaProvider>
    </MotionConfig>
  )
}

const BUBBLE = 'rounded-[20px] rounded-br-md bg-user-bubble px-4 py-2.5 text-body break-words whitespace-pre-wrap'

/** Beside a message the connection is holding: it goes once Hermes is back. */
function Waiting() {
  return (
    <span
      role="img"
      aria-label="Waiting to send"
      title="Waiting to send"
      className="absolute right-full bottom-0 flex size-8 animate-fade items-center justify-center pr-1 text-ink-3"
    >
      <Clock3 size={15} strokeWidth={1.75} />
    </span>
  )
}

const quiet =
  'pressable relative inline-flex size-8 items-center justify-center rounded-full text-ink-3 hover:bg-fill-1 hover:text-ink-2 after:absolute after:-inset-1.5'

const UserMessage = memo(function UserMessage({
  item,
  isNew,
  onEdit,
  editing,
  waiting,
  className,
}: {
  item: Of<'user'>
  isNew: boolean
  /** Only for the message that can be edited. */
  onEdit?: (item: Of<'user'>) => void
  /** Being rewritten in the composer right now. */
  editing?: boolean
  /** Not with Hermes yet, and the connection is down: it goes once it's back. */
  waiting?: boolean
  className?: string
}) {
  const { copied, copy } = useCopy()
  const [held, setHeld] = useState<HTMLElement | null>(null)
  const close = useCallback(() => setHeld(null), [])
  const press = useLongPress(setHeld)
  const actions: MenuAction[] = [
    ...(onEdit ? [{ label: 'Edit', icon: PencilLine, onSelect: () => onEdit(item) }] : []),
    { label: 'Copy', icon: Copy, onSelect: () => void copy(item.text) },
  ]

  return (
    <div
      data-message={item.id}
      className={cn(
        'group/user flex flex-col items-end gap-1.5',
        isNew && 'animate-pop origin-bottom-right',
        className,
      )}
    >
      {!!item.attachments?.length && (
        <UserAttachments
          items={item.attachments}
          className={cn('relative [&>*]:transition-opacity [&>*]:duration-300', waiting && '[&>:not([role=img])]:opacity-50')}
        >
          {!item.text && waiting && <Waiting />}
        </UserAttachments>
      )}
      {!!item.images?.length && !item.attachments?.length && (
        <div className="flex max-w-[80%] flex-wrap justify-end gap-1.5">
          {item.images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              className="size-28 rounded-lg object-cover ring-[0.5px] ring-line-strong sm:size-36"
              draggable={false}
            />
          ))}
        </div>
      )}
      {item.text && (
        <>
          <div className="relative max-w-[80%]">
            <ReactionBadge reactions={item.reactions} />
            <div
              {...press}
              className={cn(
                BUBBLE,
                'ring-offset-bg transition-[opacity,box-shadow] duration-300 ease-(--ease-out) [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none',
                editing && 'ring-2 ring-accent ring-offset-2',
                waiting && 'opacity-50',
                held && 'opacity-0',
              )}
            >
              {/* An edit swaps the words in place. */}
              <span key={item.text} className={cn(item.was && 'animate-fade')}>
                <MentionText text={item.text} />
              </span>
            </div>
            {waiting && <Waiting />}
            {/* On hover-capable screens, quiet actions appear beside it. */}
            <div
              className={cn(
                'absolute right-full bottom-0 hidden items-center gap-0.5 pr-1 opacity-0 transition-opacity duration-150 group-hover/user:opacity-100 focus-within:opacity-100 [@media(hover:hover)]:flex',
                waiting && '[@media(hover:hover)]:hidden',
              )}
            >
              {onEdit && (
                <button type="button" className={quiet} onClick={() => onEdit(item)} aria-label="Edit" title="Edit">
                  <PencilLine size={16} strokeWidth={1.75} />
                </button>
              )}
              <button
                type="button"
                className={quiet}
                onClick={() => copy(item.text)}
                aria-label={copied ? 'Copied' : 'Copy'}
                title="Copy"
              >
                {copied ? (
                  <Check size={16} strokeWidth={2} className="animate-fade text-ink-2" />
                ) : (
                  <Copy size={16} strokeWidth={1.75} />
                )}
              </button>
            </div>
          </div>
          <MessageMenu
            anchor={held}
            actions={actions}
            onClose={close}
            bubble={
              <div className={cn(BUBBLE, 'w-full shadow-float')}>
                <MentionText text={item.text} still />
              </div>
            }
          />
        </>
      )}
    </div>
  )
})

type TurnProps = Handlers & {
  /** Identifies this reply while it's read aloud. */
  speakKey: string
  sections: Section[]
  live: boolean
  last: boolean
  agent?: Speaker
  /** Which agent's voice reads it aloud (falls back to whoever spoke last). */
  voice?: string
  isNew: boolean
  className?: string
}

/** A settled turn only re-renders when one of its own items changes. */
const sameTurn = (a: TurnProps, b: TurnProps) =>
  (Object.keys(a) as (keyof TurnProps)[]).every((k) => k === 'sections' || a[k] === b[k]) &&
  a.sections.length === b.sections.length &&
  a.sections.every((sa, i) => {
    const sb = b.sections[i]
    return (
      sa.id === sb.id &&
      sa.speaker === sb.speaker &&
      sa.blocks.length === sb.blocks.length &&
      sa.blocks.every((x, j) => {
        const y = sb.blocks[j]
        if (x.kind === 'work' || x.kind === 'helpers')
          return (
            y.kind === x.kind &&
            x.items.length === y.items.length &&
            x.items.every((it, k) => it === y.items[k]) &&
            (x.kind !== 'helpers' || (y.kind === 'helpers' && x.back === y.back))
          )
        return x.kind === y.kind && 'item' in y && x.item === y.item
      })
    )
  })

const Turn = memo(function Turn({
  speakKey,
  sections,
  live,
  last,
  agent,
  voice,
  isNew,
  className,
  onApprove,
  onAnswer,
  onSecret,
  onRetry,
  onErrorAction,
  onReact,
  onStopHelper,
}: TurnProps) {
  const texts = sections
    .flatMap((s) => s.blocks)
    .flatMap((b) => (b.kind === 'text' && b.item.text ? [b.item.text] : []))
  const text = texts.map(proseOf).filter(Boolean).join('\n\n')
  // Files the reply itself delivers aren't shown twice under the tool that made them.
  const delivered = new Set(texts.flatMap(mediaPathsOf))
  const tail = sections.at(-1)?.blocks.at(-1)
  // Between steps (or before the first one) there's still something to say.
  const needsLine =
    live &&
    !(tail?.kind === 'work') &&
    !(tail?.kind === 'helpers' && tail.items.some((h) => h.status === 'running')) &&
    !(tail?.kind === 'text' && tail.item.streaming) &&
    !((tail?.kind === 'approval' || tail?.kind === 'clarify' || tail?.kind === 'secret') && tail.item.status === 'pending')
  const fallback = sections.at(-1)?.speaker ?? agent

  // What a tapback lands on: the reply's last words, once it's finished (and,
  // until Hermes has saved it, only while it's the newest).
  const reply = live
    ? undefined
    : sections.flatMap((s) => s.blocks).findLast((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')?.item
  const reactTo = onReact && reply?.text && (reply.rowId != null || last) ? reply : undefined
  const [tapAt, setTapAt] = useState<HTMLElement | null>(null)
  const closeTap = useCallback(() => setTapAt(null), [])
  const hold = useHoldToReact(setTapAt)
  const mine = reactTo?.reactions?.find((r) => r.author === 'user')?.emoji

  return (
    <article
      className={cn(
        'group/turn relative',
        // A reply that's only just begun waits a beat behind the message it answers.
        isNew && (sections.length ? 'animate-rise' : 'animate-rise [animation-delay:140ms]'),
        className,
      )}
      aria-busy={live || undefined}
    >
      {sections.map((section, si) => {
        const lastSection = si === sections.length - 1
        const hue = section.speaker?.hue ?? agent?.hue ?? DEFAULT_HUE
        const seed = section.speaker?.id ?? agent?.id
        return (
          <div
            key={section.id}
            className={cn('flex flex-col gap-3', si > 0 && 'mt-6', section.speaker && 'hue-scope')}
            style={section.speaker ? ({ '--hue': section.speaker.hue } as CSSProperties) : undefined}
          >
            {section.speaker && <SpeakerName speaker={section.speaker} />}
            {section.blocks.map((block, bi) => {
              const liveBlock = live && lastSection && bi === section.blocks.length - 1
              switch (block.kind) {
                case 'work': {
                  const made = block.items
                    .flatMap((i) => (i.kind === 'tool' && i.media ? i.media : []))
                    .filter((m) => !delivered.has(m))
                  return (
                    <Fragment key={block.id}>
                      <Work items={block.items} live={liveBlock} hue={hue} seed={seed} />
                      {made.length > 0 && <ToolMedia items={made} />}
                    </Fragment>
                  )
                }
                case 'text':
                  if (!block.item.text) return null
                  return block.item === reactTo ? (
                    // Touch: hold the reply to react, as you would a message in Messages.
                    <div
                      key={block.id}
                      data-message={block.id}
                      {...hold}
                      className="[@media(pointer:coarse)]:[-webkit-touch-callout:none]"
                    >
                      <RichText text={block.item.text} streaming={block.item.streaming} />
                    </div>
                  ) : (
                    <div key={block.id} data-message={block.id}>
                      <RichText text={block.item.text} streaming={block.item.streaming} />
                    </div>
                  )
                case 'plan':
                  return <Plan key={block.id} item={block.item} live={live} />
                case 'helpers':
                  return block.back ? (
                    <HelpersBack key={block.id} items={block.items} back={block.back} hue={hue} />
                  ) : (
                    <Helpers
                      key={block.id}
                      items={block.items}
                      agent={section.speaker ?? agent}
                      hue={hue}
                      live={live}
                      onStop={onStopHelper}
                    />
                  )
                case 'wake':
                  return <WakeLine key={block.id} item={block.item} hue={hue} seed={seed} />
                case 'approval':
                  return <ApprovalCard key={block.id} item={block.item} hue={hue} seed={seed} onApprove={onApprove} />
                case 'clarify':
                  return <ClarifyCard key={block.id} item={block.item} hue={hue} seed={seed} onAnswer={onAnswer} />
                case 'secret':
                  return (
                    <SecretCard
                      key={block.id}
                      item={block.item}
                      name={(section.speaker ?? agent)?.name}
                      hue={hue}
                      seed={seed}
                      onSecret={onSecret}
                    />
                  )
                case 'error':
                  return (
                    <ErrorNote
                      key={block.id}
                      item={block.item}
                      onRetry={block.item.retryable && last ? onRetry : undefined}
                      onAction={onErrorAction}
                    />
                  )
              }
            })}
          </div>
        )
      })}

      {needsLine && (
        <div className={cn(sections.length > 0 && 'mt-3')}>
          <Work items={[]} live hue={fallback?.hue ?? DEFAULT_HUE} seed={fallback?.id} />
        </div>
      )}

      {reply?.reactions && (
        <div className="mt-2">
          <ReactionPills reactions={reply.reactions} onToggle={reactTo && ((emoji) => onReact?.(reactTo.id, emoji))} />
        </div>
      )}
      {reactTo && (
        <Tapback anchor={tapAt} current={mine} onPick={(emoji) => onReact?.(reactTo.id, emoji)} onClose={closeTap} />
      )}

      {!live && text && (
        <MessageActions
          text={text}
          onRetry={onRetry}
          onReact={reactTo ? setTapAt : undefined}
          speak={{ key: speakKey, profile: sections.at(-1)?.speaker?.id ?? voice }}
          // Touch: always there, under the reply. Pointer: they appear on hover in
          // the space below it, so they never push the conversation apart.
          className="mt-1 -mb-3 -ml-2 [@media(hover:hover)]:absolute [@media(hover:hover)]:top-full [@media(hover:hover)]:left-0 [@media(hover:hover)]:mb-0"
        />
      )}
    </article>
  )
}, sameTurn)

function SpeakerName({ speaker }: { speaker: Speaker }) {
  return (
    <div className="-mb-1 flex items-center gap-2">
      <Orb hue={speaker.hue} size={24} seed={speaker.id} />
      <span className="text-subhead font-semibold tracking-[-0.01em] text-accent">{speaker.name}</span>
    </div>
  )
}

export function ErrorNote({
  item,
  onRetry,
  onAction,
}: {
  item: Of<'error'>
  onRetry?: () => void
  onAction?: (action: ErrorAction) => void
}) {
  const action = onAction ? errorActionOf(item.message) : undefined
  return (
    <div role="alert" className="rounded-lg bg-danger/8 px-4 py-3">
      <div className="flex items-start gap-3">
        <CircleAlert size={18} strokeWidth={2} aria-hidden className="mt-[3px] flex-none text-danger" />
        <p className="min-w-0 flex-1 pt-px text-subhead leading-6 text-pretty text-ink">{item.message}</p>
        {onRetry && !action && (
          <Button size="sm" variant="secondary" onClick={onRetry} className="-my-0.5 -mr-1.5 flex-none">
            Try again
          </Button>
        )}
      </div>
      {/* Something to do about it: that first, then trying again once it's done. */}
      {action && (
        <div className="mt-2.5 flex flex-wrap gap-2 pl-[30px]">
          <Button size="sm" variant="primary" onClick={() => onAction?.(action)}>
            {ERROR_ACTION_LABEL[action]}
          </Button>
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
