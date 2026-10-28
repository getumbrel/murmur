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
} from 'react'
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { ArrowDown, Check, CircleAlert, Copy, PencilLine } from 'lucide-react'
import { useStickToBottom } from 'use-stick-to-bottom'
import { Orb } from '@/ui/orb'
import { Button } from '@/ui/button'
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
import { Helpers } from './helpers'
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
/** How the thread follows a growing reply. */
const SPRING = { damping: 0.75, stiffness: 0.08, mass: 1 }
/** How long a chat that just opened keeps jumping to its end, while late layout (markdown, code, images) settles. */
const SETTLE_MS = 1200

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

  for (const item of items) {
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
      const block: Block =
        item.reason === 'helpers'
          ? { kind: 'helpers', id: item.id, items: [], back: item }
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
    if (
      item.kind === 'tool' ||
      item.kind === 'thinking' ||
      (item.kind === 'approval' && item.status !== 'pending' && !live.has(item.id))
    ) {
      if (last?.kind === 'work') last.items.push(item)
      else section.blocks.push({ kind: 'work', id: item.id, items: [item] })
    } else if (item.kind === 'helper') {
      // Helpers sent off together stack together.
      if (last?.kind === 'helpers') last.items.push(item)
      else section.blocks.push({ kind: 'helpers', id: item.id, items: [item] })
    } else {
      section.blocks.push({ kind: item.kind === 'assistant' ? 'text' : item.kind, id: item.id, item } as Block)
    }
  }

  if (busy && !turn) rows.push({ kind: 'turn', id: `turn-${prev}`, sections: [] })
  rows.push(...aside)
  return rows
}

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
    /** Pinned under the messages, e.g. the composer. Messages scroll beneath it. */
    footer?: ReactNode
    className?: string
    /** Which chat the files in it belong to, and how widgets talk back. */
    media?: MediaContext
  }

const NO_MEDIA: MediaContext = {}

export function Thread({
  items,
  busy,
  agent,
  emptyState,
  lead,
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
  const { scrollRef, contentRef, isAtBottom, scrollToBottom, state: stick } = useStickToBottom({
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
  useEffect(() => {
    if (prevUser.current === lastUser) return
    prevUser.current = lastUser
    if (lastUserIsNew) void scrollToBottom(still() ? 'instant' : 'smooth')
  }, [lastUser, lastUserIsNew, scrollToBottom])

  const lastTurn = rows.findLast((r) => r.kind === 'turn')?.id
  // Who reads replies aloud: the agent in a one-to-one chat.
  const voice = media.profile ?? agent?.id
  const editingAt = editingId ? rows.findIndex((r) => r.id === editingId) : -1

  // The composer floats over the end of the thread, outside the message log;
  // the log keeps room for it underneath.
  // (Sized straight from the measure, so the room is there before the first paint.)
  const footerRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = footerRef.current
    if (!el) return
    const measure = () => {
      if (spacerRef.current) spacerRef.current.style.height = `${el.offsetHeight}px`
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  return (
    <MotionConfig reducedMotion="user">
      <MediaProvider value={media}>
        <MentionsProvider>
          <div className={cn('hue-scope relative h-full min-h-0', className)}>
            <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain" role="log" aria-label="Messages">
              <div ref={contentRef} className="flex min-h-full flex-col">
                {/* One reading column (~688px of text), shared with the composer below. */}
                <div className="relative mx-auto flex w-full max-w-[736px] flex-1 flex-col px-4 pt-6 pb-12 sm:px-6">
                  {lead}
                  {rows.length === 0 && emptyState ? (
                    <div className="flex flex-1 flex-col items-center justify-center">{emptyState}</div>
                  ) : (
                    // Rows that leave (an edited message's old reply, an undo) fold away
                    // in place while the rest carries on.
                    <AnimatePresence initial={false} mode="popLayout">
                      {rows.map((row, i) => {
                        // 24px between exchanges; a reply sits closer (16px) to what it answers.
                        const gap = i === 0 ? '' : row.kind === 'turn' && rows[i - 1].kind === 'user' ? 'mt-4' : 'mt-6'
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
                </div>

                <div ref={spacerRef} aria-hidden className="flex-none" />
              </div>
            </div>
            <div ref={footerRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
              <div aria-hidden className="absolute inset-x-0 top-6 bottom-0 bg-linear-to-t from-bg from-30% to-transparent" />
              <div className="pointer-events-auto relative mx-auto w-full max-w-[736px]">
                <AnimatePresence>
                  {!isAtBottom && (
                    <motion.button
                      type="button"
                      onClick={() => void scrollToBottom(reduced ? 'instant' : 'smooth')}
                      initial={{ opacity: 0, y: 8, scale: 0.94 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.94 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="glass absolute bottom-full left-1/2 mb-3 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full pr-3.5 pl-3 text-footnote font-medium text-ink shadow-float ring-[0.5px] ring-line-strong after:absolute after:-inset-1"
                    >
                      <ArrowDown size={15} strokeWidth={2} aria-hidden />
                      Latest
                    </motion.button>
                  )}
                </AnimatePresence>
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

const quiet =
  'pressable relative inline-flex size-8 items-center justify-center rounded-full text-ink-3 hover:bg-fill-1 hover:text-ink-2 after:absolute after:-inset-1.5'

const UserMessage = memo(function UserMessage({
  item,
  isNew,
  onEdit,
  editing,
  className,
}: {
  item: Of<'user'>
  isNew: boolean
  /** Only for the message that can be edited. */
  onEdit?: (item: Of<'user'>) => void
  /** Being rewritten in the composer right now. */
  editing?: boolean
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
      className={cn(
        'group/user flex flex-col items-end gap-1.5',
        isNew && 'animate-pop origin-bottom-right',
        className,
      )}
    >
      {!!item.attachments?.length && <UserAttachments items={item.attachments} />}
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
                held && 'opacity-0',
              )}
            >
              {/* An edit swaps the words in place. */}
              <span key={item.text} className={cn(item.was && 'animate-fade')}>
                <MentionText text={item.text} />
              </span>
            </div>
            {/* On hover-capable screens, quiet actions appear beside it. */}
            <div className="absolute right-full bottom-0 hidden items-center gap-0.5 pr-1 opacity-0 transition-opacity duration-150 group-hover/user:opacity-100 focus-within:opacity-100 [@media(hover:hover)]:flex">
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
                    <div key={block.id} {...hold} className="[@media(pointer:coarse)]:[-webkit-touch-callout:none]">
                      <RichText text={block.item.text} streaming={block.item.streaming} />
                    </div>
                  ) : (
                    <RichText key={block.id} text={block.item.text} streaming={block.item.streaming} />
                  )
                case 'plan':
                  return <Plan key={block.id} item={block.item} live={live} />
                case 'helpers':
                  return (
                    <Helpers
                      key={block.id}
                      items={block.items}
                      back={block.back}
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
