import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import * as Popover from '@radix-ui/react-popover'
import {
  AnimatePresence,
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type MotionValue,
  type PanInfo,
} from 'motion/react'
import { Link } from 'wouter'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  MoreHorizontal,
  PencilLine,
  Pin,
  PinOff,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Sheet } from '@/ui/sheet'
import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import { useMedia } from '@/lib/use-media'
import { sourceLabel, type Agent } from '@/state/agents'
import { SearchField } from '@/features/search/search-field'
import { shortTime } from '@/features/home/time'
import { RowMenu, useLongPress, type MenuPlace } from '@/features/home/row-menu'
import { useArchivedChats, useChatActions, useUnread, type AgentChat, type ChatActions } from './chats'
import { RenameChatSheet } from './rename-chat'

// Every chat with this agent: the main chat first, then the ones you've
// pinned, then the most recently active, each with when it last moved, as the
// roster says it. A routine's line is labelled and says what it found.
// Swipe right to pin a chat, left to archive it; touch and hold (or
// right-click, or its "…") for Rename and Delete too. Archived chats wait in a
// row of their own at the end. With more than a handful, a search narrows them.

const SEARCH_FROM = 8
/** A swiped-open action's width. */
const REVEAL = 80
/** How far across its row a swipe goes to do its action outright. */
const FULL = 0.5
const spring = { type: 'spring', stiffness: 500, damping: 42 } as const

type Props = {
  agent: Agent
  chats?: AgentChat[]
  pending: boolean
  failed: boolean
  onRetry: () => void
  /** Whether this Hermes keeps pins and archives. */
  filing?: boolean
  /** Off where the page itself is the list of chats. */
  heading?: boolean
  /** Home's look: open one-line rows, edge to edge, with no card around them. */
  plain?: boolean
  /** The Archived sheet's list: no pins, and each can go back. */
  archived?: boolean
  /** Opening a chat from here (the Archived sheet closes). */
  onOpen?: () => void
}

export function ChatList({
  agent,
  chats,
  pending,
  failed,
  onRetry,
  filing = false,
  heading = true,
  plain = false,
  archived = false,
  onOpen,
}: Props) {
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<{ id: string; side: Side } | null>(null)
  const [renaming, setRenaming] = useState<AgentChat | null>(null)
  const [archive, setArchive] = useState(false)
  const touch = useMedia('(pointer: coarse)')
  const act = useChatActions(agent.id)
  const stored = useArchivedChats(filing && !archived ? agent.id : undefined).data

  const ordered = useMemo(() => {
    if (!chats || archived) return chats
    const main = chats.find((c) => c.main)
    const pins = chats.filter((c) => c.pinned && c !== main)
    return [...(main ? [main] : []), ...pins, ...chats.filter((c) => !c.pinned && c !== main)]
  }, [chats, archived])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !ordered) return ordered
    return ordered.filter((c) => `${c.title} ${c.preview}`.toLowerCase().includes(q))
  }, [ordered, query])

  // A swiped-open row closes when the list scrolls, as it would anywhere.
  useEffect(() => {
    if (!revealed) return
    const close = () => setRevealed(null)
    document.addEventListener('scroll', close, { capture: true, passive: true, once: true })
    return () => document.removeEventListener('scroll', close, { capture: true })
  }, [revealed])

  const swipeHint = archived
    ? ''
    : filing
      ? 'Swipe left to archive a chat, or right to pin it.'
      : 'Swipe left on a chat to delete it.'

  return (
    <section
      aria-labelledby={heading ? 'agent-chats' : undefined}
      aria-label={heading ? undefined : archived ? 'Archived chats' : 'Chats'}
    >
      {heading && (
        <h2 id="agent-chats" className="mb-2 flex items-baseline justify-between px-4 text-footnote font-medium text-ink-2">
          Chats
          {!!ordered?.length && <span className="tabular-nums text-ink-3">{ordered.length}</span>}
        </h2>
      )}
      {(ordered?.length ?? 0) > SEARCH_FROM && (
        <SearchField
          value={query}
          onValueChange={setQuery}
          placeholder={archived ? 'Search archived chats' : `Search ${agent.name}’s chats`}
          className={plain ? 'mb-2' : 'mb-3'}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
      )}
      {pending ? (
        <div role="status" className="list-group overflow-hidden rounded-xl bg-fill-1">
          <span className="sr-only">Loading chats</span>
          {[58, 74, 46].map((w, i) => (
            <div key={i} className="py-2.5 pl-4">
              <span className="flex h-6 items-center">
                <Skeleton className="h-3.5 rounded-full" style={{ width: `${w}%` }} />
              </span>
              <span className="flex h-4.5 items-center">
                <Skeleton className="h-2.5 w-20 rounded-full" />
              </span>
            </div>
          ))}
        </div>
      ) : failed && !ordered ? (
        <div className="rounded-xl bg-fill-1 px-4 py-6 text-center">
          <p className="text-subhead text-ink-2">Can’t load chats right now.</p>
          <button type="button" onClick={onRetry} className="pressable mt-1 text-subhead font-medium text-accent">
            Try again
          </button>
        </div>
      ) : !ordered?.length ? (
        <p className="rounded-xl bg-fill-1 px-4 py-6 text-center text-subhead text-ink-3">
          {archived ? 'No archived chats.' : 'No chats yet. Say hello to start one.'}
        </p>
      ) : !shown?.length ? (
        <p className="rounded-xl bg-fill-1 px-4 py-6 text-center text-subhead text-ink-3">
          No chats match “{query.trim()}”.
        </p>
      ) : (
        <ul
          className={cn('animate-fade overflow-hidden', plain ? '-mx-5' : 'rounded-xl bg-fill-1')}
          // With a row swiped open, a tap anywhere else in the list just closes it.
          onClickCapture={(e) => {
            if (!revealed || (e.target as Element).closest('[data-swipe-action]')) return
            e.preventDefault()
            e.stopPropagation()
            setRevealed(null)
          }}
        >
          <AnimatePresence initial={false}>
            {shown.map((chat) => (
              <ChatRow
                key={chat.id}
                agent={agent}
                chat={chat}
                plain={plain}
                options={chatOptions(chat, act, { filing, rename: setRenaming })}
                revealed={revealed?.id === chat.id ? revealed.side : null}
                onReveal={(side) => setRevealed(side ? { id: chat.id, side } : null)}
                onOpen={onOpen}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
      {touch && swipeHint && (ordered?.length ?? 0) > 1 && !query && (
        <p className={cn('mt-2 text-footnote text-ink-3', plain ? 'hidden' : 'px-4')}>{swipeHint}</p>
      )}
      {!!stored?.length && !query && (
        <ArchivedRow count={stored.length} plain={plain} onOpen={() => setArchive(true)} />
      )}

      {!archived && filing && <ArchivedSheet agent={agent} open={archive} onOpenChange={setArchive} />}
      <RenameChatSheet
        agent={agent}
        chat={renaming}
        onClose={() => setRenaming(null)}
        onRename={(title) => act.rename(renaming!, title)}
      />
    </section>
  )
}

// ── What you can do to a chat ────────────────────────────────────────────────

export type ChatOption = { label: string; icon: LucideIcon; run: () => void; danger?: boolean }
type Swipe = ChatOption & {
  tone: 'accent' | 'warning' | 'danger'
  /** It takes the row out of the list. */
  removes: boolean
}
type Options = { menu: ChatOption[]; leading?: Swipe; trailing?: Swipe }

/**
 * A chat's menu, in order, and its swipes: right to pin, left to archive (or
 * back out of Archived). The main chat is shared with Hermes Desktop and stays
 * put; a routine's line is the routine's, and a run you've replied in can only
 * go. Without pins and archives (an older Hermes), left deletes, as it did.
 * `leave` goes elsewhere first, from the chat that's archived or deleted.
 */
export function chatOptions(
  chat: AgentChat,
  act: ChatActions,
  { filing, rename, leave }: { filing: boolean; rename: (chat: AgentChat) => void; leave?: () => void },
): Options {
  if (chat.main || chat.result) return { menu: [] }
  const remove: ChatOption = {
    label: 'Delete',
    icon: Trash2,
    run: () => {
      leave?.()
      act.remove(chat)
    },
    danger: true,
  }
  const deletes: Swipe = { ...remove, tone: 'danger', removes: true }
  if (chat.routine) return { menu: [remove], trailing: deletes }
  const name: ChatOption = { label: 'Rename', icon: PencilLine, run: () => rename(chat) }
  if (chat.archived) {
    const back: ChatOption = { label: 'Unarchive', icon: ArchiveRestore, run: () => void act.unarchive(chat) }
    return { menu: [back, name, remove], trailing: { ...back, tone: 'accent', removes: true } }
  }
  if (!filing) return { menu: [name, remove], trailing: deletes }
  const pin: ChatOption = chat.pinned
    ? { label: 'Unpin', icon: PinOff, run: () => void act.pin(chat, false) }
    : { label: 'Pin', icon: Pin, run: () => void act.pin(chat, true) }
  const archive: ChatOption = {
    label: 'Archive',
    icon: Archive,
    run: () => {
      leave?.()
      void act.archive(chat)
    },
  }
  return {
    menu: [pin, name, archive, remove],
    leading: { ...pin, tone: 'warning', removes: false },
    trailing: { ...archive, tone: 'accent', removes: true },
  }
}

type Side = 'leading' | 'trailing'

function ChatRow({
  agent,
  chat,
  plain,
  options,
  revealed,
  onReveal,
  onOpen,
}: {
  agent: Agent
  chat: AgentChat
  plain?: boolean
  options: Options
  revealed: Side | null
  onReveal: (side: Side | null) => void
  onOpen?: () => void
}) {
  const { menu, leading, trailing } = options
  const [open, setOpen] = useState(false)
  // Hung under the row from a hold, under the "…" from it, at the pointer from a right-click.
  const [place, setPlace] = useState<MenuPlace>('row')
  const anchor = useRef<{ getBoundingClientRect: () => DOMRect }>(undefined)
  const openMenu = (at: 'row' | HTMLElement | { x: number; y: number }) => {
    const rect =
      at === 'row'
        ? () => row.current!.getBoundingClientRect()
        : at instanceof HTMLElement
          ? () => at.getBoundingClientRect()
          : () => new DOMRect(at.x, at.y, 0, 0)
    anchor.current = { getBoundingClientRect: rect }
    setPlace(at === 'row' ? 'row' : at instanceof HTMLElement ? 'button' : 'point')
    setOpen(true)
  }
  const press = useLongPress((at) => openMenu(at ?? 'row'))
  const via = !chat.routine && sourceLabel(chat.source)
  const unread = useUnread(agent, chat)
  const row = useRef<HTMLLIElement>(null)
  const width = useRef(0)
  const dragging = useRef(false)
  const dragged = useRef(false)
  // Swiped all the way: the row has gone with its action, and stays gone.
  const leaving = useRef(false)
  const present = useIsPresent()

  const x = useMotionValue(0)
  // Far enough to do it outright: the action says so, with a tick under your thumb.
  const [armed, setArmed] = useState<Side | null>(null)
  useMotionValueEvent(x, 'change', (v) => {
    const far = width.current * FULL
    const next = !far ? null : trailing && v <= -far ? 'trailing' : leading && v >= far ? 'leading' : null
    if (next === armed) return
    setArmed(next)
    if (next && dragging.current) navigator.vibrate?.(10)
  })

  useEffect(() => {
    if (leaving.current) return
    const controls = animate(x, revealed === 'trailing' ? -REVEAL : revealed === 'leading' ? REVEAL : 0, spring)
    return () => controls.stop()
  }, [revealed, x])
  // Put back (Undo, or Hermes said no) before it had quite gone.
  useEffect(() => {
    if (!present || !leaving.current) return
    leaving.current = false
    animate(x, 0, spring)
  }, [present, x])

  const run = (side: Side) => {
    const action = side === 'trailing' ? trailing : leading
    if (!action) return
    if (action.removes) {
      leaving.current = true
      const w = width.current || row.current?.offsetWidth || 400
      onReveal(null)
      // Out the side it was pushed, then the list closes over it.
      void animate(x, side === 'trailing' ? -w : w, { type: 'spring', stiffness: 420, damping: 44, restDelta: 2 }).then(
        action.run,
      )
    } else {
      onReveal(null)
      animate(x, 0, spring)
      action.run()
    }
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    dragging.current = false
    const v = x.get()
    const far = width.current * FULL
    if (trailing && v <= -far) return run('trailing')
    if (leading && v >= far) return run('leading')
    const side: Side | null =
      trailing && (v < -REVEAL / 2 || (info.velocity.x < -400 && v < 0))
        ? 'trailing'
        : leading && (v > REVEAL / 2 || (info.velocity.x > 400 && v > 0))
          ? 'leading'
          : null
    // Settle even when the state doesn't change (a short drag that snaps back).
    animate(x, side === 'trailing' ? -REVEAL : side === 'leading' ? REVEAL : 0, spring)
    onReveal(side)
  }

  const items = menu.map((o) => ({
    label: o.label,
    icon: <o.icon size={18} strokeWidth={1.85} />,
    onSelect: o.run,
    danger: o.danger,
  }))

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal>
      <Popover.Anchor virtualRef={anchor as React.RefObject<{ getBoundingClientRect: () => DOMRect }>} />
      <motion.li
        ref={row}
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 40 }}
        className="group relative overflow-hidden"
      >
        {/* Above the sliding row, inset to the text like every grouped list. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-0 right-0 z-10 h-[0.5px] group-first:hidden',
            plain ? 'left-5 bg-line' : 'left-4 bg-line-strong',
          )}
        />
        {leading && (
          <SwipeAction
            side="leading"
            action={leading}
            x={x}
            armed={armed === 'leading'}
            shown={revealed === 'leading'}
            onPress={() => run('leading')}
          />
        )}
        {trailing && (
          <SwipeAction
            side="trailing"
            action={trailing}
            x={x}
            armed={armed === 'trailing'}
            shown={revealed === 'trailing'}
            onPress={() => run('trailing')}
          />
        )}

        <motion.div
          style={{ x }}
          drag={leading || trailing ? 'x' : false}
          dragDirectionLock
          dragConstraints={{ left: trailing ? -4000 : 0, right: leading ? 4000 : 0 }}
          dragElastic={0}
          dragMomentum={false}
          onDragStart={() => {
            dragging.current = true
            dragged.current = true
            width.current = row.current?.offsetWidth ?? 0
          }}
          onDragEnd={onDragEnd}
          className={cn(
            'relative flex items-center',
            plain ? 'bg-bg' : 'bg-elevated [background-image:linear-gradient(var(--fill-1),var(--fill-1))]',
            // One fill for the whole row, its "…" included, under its contents.
            'before:pointer-events-none before:absolute before:inset-0 before:transition-colors before:duration-150',
            'hover:before:bg-fill-1 has-[a:active]:before:bg-fill-2',
            open && 'before:bg-fill-2 hover:before:bg-fill-2',
          )}
        >
          <Link
            href={`/chat/${agent.id}/${chat.id}`}
            draggable={false}
            {...(menu.length ? press : {})}
            onPointerDown={(e) => {
              dragged.current = false
              if (menu.length) press.onPointerDown(e)
            }}
            onClick={(e) => {
              if (menu.length) press.onClick(e)
              // A swipe, or a tap on a row showing its action, never opens the chat.
              if (dragged.current || revealed) {
                e.preventDefault()
                if (revealed && !dragged.current) onReveal(null)
              }
              dragged.current = false
              if (!e.defaultPrevented) onOpen?.()
            }}
            className={cn(
              'relative flex min-w-0 flex-1 items-center gap-3 text-left select-none [-webkit-touch-callout:none] focus-visible:-outline-offset-2',
              plain ? 'min-h-14 py-3 pr-5 pl-5' : 'min-h-15 py-2.5 pr-4 pl-4',
              !plain && menu.length > 0 && '[@media(hover:hover)]:pr-2',
            )}
          >
            {plain ? (
              <PlainLine chat={chat} unread={unread} via={via} more={menu.length > 0} />
            ) : (
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span
                    title={chat.title}
                    className={cn('min-w-0 flex-1 truncate text-body', unread && 'font-semibold')}
                  >
                    {chat.title}
                  </span>
                  {unread && (
                    <span aria-label="New messages" className="size-2 flex-none self-center rounded-full bg-accent" />
                  )}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-footnote text-ink-3">
                  {chat.pinned && <PinMark />}
                  {chat.routine && <span className="flex-none font-medium text-accent">Routine ·</span>}
                  <span className="flex-none">{shortTime(chat.at)}</span>
                  {via && <span className="flex-none">· via {via}</span>}
                  {/* The main chat's title says what it is, and a routine's who it is; what was said tells them apart. */}
                  {(chat.main || chat.result) && chat.preview && (
                    <span className="min-w-0 truncate">· {chat.preview}</span>
                  )}
                </span>
              </span>
            )}
          </Link>
          {menu.length > 0 && (
            <button
              type="button"
              onClick={(e) => openMenu(e.currentTarget)}
              aria-label={`More for “${chat.title}”`}
              aria-haspopup="menu"
              data-open={open || undefined}
              className={cn(
                'pressable relative hidden flex-none items-center justify-center rounded-full text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-fill-2 hover:text-ink focus-visible:opacity-100 data-open:opacity-100 [@media(hover:hover)]:flex',
                plain ? 'absolute top-1/2 right-3 size-8 -translate-y-1/2' : 'mr-2 size-9',
                revealed && 'invisible',
              )}
            >
              <MoreHorizontal size={18} strokeWidth={2} aria-hidden />
            </button>
          )}
        </motion.div>
      </motion.li>
      {menu.length > 0 && (
        <RowMenu open={open} name={chat.title} roomy place={place} close={() => setOpen(false)} items={items} />
      )}
    </Popover.Root>
  )
}

const tones = {
  accent: 'bg-accent text-accent-ink',
  warning: 'bg-warning text-accent-ink',
  danger: 'bg-danger text-white',
}

/** What a swipe shows: as wide as the row has moved, its label kept against the row's edge. */
function SwipeAction({
  side,
  action,
  x,
  armed,
  shown,
  onPress,
}: {
  side: Side
  action: Swipe
  x: MotionValue<number>
  armed: boolean
  shown: boolean
  onPress: () => void
}) {
  const width = useTransform(x, (v) => Math.max(0, side === 'trailing' ? -v : v))
  // What it said as you let go, until the row is closed: a pin lands while the row
  // slides back, and the strip going with it still says Pin, not Unpin.
  const [face, setFace] = useState(action)
  if (face.label !== action.label && x.get() === 0) setFace(action)
  useMotionValueEvent(x, 'change', (v) => v === 0 && face.label !== action.label && setFace(action))
  return (
    <motion.button
      type="button"
      data-swipe-action=""
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
      onClick={onPress}
      className={cn(
        'absolute inset-y-0 flex items-center overflow-hidden',
        side === 'trailing' ? 'right-0 justify-start' : 'left-0 justify-end',
        tones[face.tone],
      )}
      style={{ width }}
    >
      <motion.span
        className="flex flex-none flex-col items-center justify-center gap-1 text-caption font-medium"
        style={{ width: REVEAL }}
        animate={{ scale: armed ? 1.1 : 1 }}
        transition={{ type: 'spring', duration: 0.3, bounce: 0.4 }}
      >
        <face.icon size={20} strokeWidth={1.85} aria-hidden />
        {face.label}
      </motion.span>
    </motion.button>
  )
}

/** Pinned: a small tilted pin, as the chat's first word of detail. */
function PinMark({ className }: { className?: string }) {
  return (
    <Pin
      size={11}
      strokeWidth={2.5}
      role="img"
      aria-label="Pinned"
      className={cn('flex-none rotate-45 fill-current', className)}
    />
  )
}

/**
 * A plain row: one line, the title and when. Hermes keeps only a chat's opening
 * words, which its title usually is already, so there's no second line to add.
 * A routine's result has one: what it found. With a pointer, its time steps
 * aside for the "…".
 */
function PlainLine({
  chat,
  unread,
  via,
  more,
}: {
  chat: AgentChat
  unread: boolean
  via: string | false | undefined
  more: boolean
}) {
  const tag = chat.routine ? 'Routine' : via ? `via ${via}` : ''
  const found = chat.result && chat.preview
  return (
    <span className="min-w-0 flex-1">
      <span className="flex min-w-0 items-baseline gap-2">
        <span title={chat.title} className={cn('min-w-0 truncate text-body', unread && 'font-semibold')}>
          {chat.title}
        </span>
        {unread && <span aria-label="New messages" className="size-2 flex-none self-center rounded-full bg-accent" />}
        <span
          className={cn(
            'ml-auto flex flex-none items-center gap-1 pl-1 text-footnote tabular-nums transition-opacity',
            more &&
              '[@media(hover:hover)]:group-hover:opacity-0 [@media(hover:hover)]:group-has-[[data-open]]:opacity-0',
          )}
        >
          {chat.pinned && <PinMark className="text-ink-3" />}
          {tag && <span className={cn(chat.routine ? 'font-medium text-accent' : 'text-ink-3')}>{tag} ·</span>}
          <span className={cn(unread ? 'font-medium text-accent' : 'text-ink-3')}>{shortTime(chat.at)}</span>
        </span>
      </span>
      {found && (
        <span title={found} className="mt-0.5 block truncate text-subhead text-ink-2">
          {found}
        </span>
      )}
    </span>
  )
}

/** The way into Archived, after the chats. */
function ArchivedRow({ count, plain, onOpen }: { count: number; plain: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={cn(
        'relative flex items-center gap-3 text-left transition-colors select-none focus-visible:-outline-offset-2',
        plain
          ? '-mx-5 flex min-h-13 px-5 text-ink-2 hover:bg-fill-1 active:bg-fill-2'
          : 'mt-3 min-h-12 w-full rounded-xl bg-fill-1 px-4 hover:bg-fill-2 active:bg-fill-3',
      )}
      style={plain ? { width: 'calc(100% + 2.5rem)' } : undefined}
    >
      {/* Under the last chat, inset to the text like the rows'. */}
      {plain && <span aria-hidden className="pointer-events-none absolute top-0 right-0 left-5 h-[0.5px] bg-line" />}
      <Archive size={18} strokeWidth={1.85} aria-hidden className="flex-none text-ink-3" />
      <span className="min-w-0 flex-1 truncate text-body">Archived</span>
      <span className="flex-none text-subhead text-ink-3 tabular-nums">{count}</span>
      <ChevronRight size={18} aria-hidden className="-mr-1.5 flex-none text-ink-3" />
    </button>
  )
}

/** The agent's archived chats: open one, or swipe it back among the rest. */
function ArchivedSheet({
  agent,
  open,
  onOpenChange,
}: {
  agent: Agent
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const list = useArchivedChats(agent.id)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Archived" width={480}>
      <div className="hue-scope pb-2" style={{ '--hue': agent.hue } as CSSProperties}>
        <ChatList
          agent={agent}
          chats={list.data}
          pending={list.isPending}
          failed={list.isError}
          onRetry={() => void list.refetch()}
          heading={false}
          archived
          onOpen={() => onOpenChange(false)}
        />
        <p className="mt-2 px-4 text-footnote text-pretty text-ink-3">
          Archived chats stay out of your list. Search still finds them, and {agent.name} still remembers them.
        </p>
      </div>
    </Sheet>
  )
}
