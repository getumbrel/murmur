import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type PanInfo } from 'motion/react'
import { Link } from 'wouter'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Skeleton } from '@/ui/skeleton'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import { useMedia } from '@/lib/use-media'
import { sourceLabel, type Agent } from '@/state/agents'
import { useChatUnread } from '@/state/status'
import { SearchField } from '@/features/search/search-field'
import { shortTime } from '@/features/home/time'
import type { AgentChat } from './chats'

// Every chat with this agent: the main chat first, then the most recently
// active, each with when it last moved, as the roster says it. Routine
// results are labelled. Swipe left (or hold, or hover with a mouse) to delete
// any but the main chat; with more than a handful, a search narrows them.

const SEARCH_FROM = 8
const REVEAL = 88

export function ChatList({
  agent,
  chats,
  pending,
  failed,
  onRetry,
  onDelete,
}: {
  agent: Agent
  chats?: AgentChat[]
  pending: boolean
  failed: boolean
  onRetry: () => void
  onDelete: (chat: AgentChat) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<string | null>(null)
  const touch = useMedia('(pointer: coarse)')

  const ordered = useMemo(() => {
    if (!chats) return undefined
    const main = chats.find((c) => c.main)
    return main ? [main, ...chats.filter((c) => c !== main)] : chats
  }, [chats])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !ordered) return ordered
    return ordered.filter((c) => `${c.title} ${c.preview}`.toLowerCase().includes(q))
  }, [ordered, query])

  return (
    <section aria-labelledby="agent-chats">
      <h2 id="agent-chats" className="mb-2 flex items-baseline justify-between px-4 text-footnote font-medium text-ink-2">
        Chats
        {!!ordered?.length && <span className="tabular-nums text-ink-3">{ordered.length}</span>}
      </h2>
      {(ordered?.length ?? 0) > SEARCH_FROM && (
        <SearchField
          value={query}
          onValueChange={setQuery}
          placeholder={`Search ${agent.name}’s chats`}
          className="mb-3"
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
          No chats yet. Say hello to start one.
        </p>
      ) : !shown?.length ? (
        <p className="rounded-xl bg-fill-1 px-4 py-6 text-center text-subhead text-ink-3">
          No chats match “{query.trim()}”.
        </p>
      ) : (
        <ul className="animate-fade overflow-hidden rounded-xl bg-fill-1">
          <AnimatePresence initial={false}>
            {shown.map((chat) => (
              <ChatRow
                key={chat.id}
                agent={agent}
                chat={chat}
                revealed={revealed === chat.id}
                onReveal={(on) => setRevealed(on ? chat.id : null)}
                onDelete={() =>
                  onDelete(chat).catch(() => {
                    setRevealed(null)
                    toast.error('Couldn’t delete that chat. Try again.')
                  })
                }
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
      {touch && (ordered?.length ?? 0) > 1 && !query && (
        <p className="mt-2 px-4 text-footnote text-ink-3">Swipe left on a chat to delete it.</p>
      )}
    </section>
  )
}

function ChatRow({
  agent,
  chat,
  revealed,
  onReveal,
  onDelete,
}: {
  agent: Agent
  chat: AgentChat
  revealed: boolean
  onReveal: (on: boolean) => void
  onDelete: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  // The main chat is shared with Hermes Desktop; deleting it would break that link.
  const deletable = !chat.main
  const via = !chat.routine && sourceLabel(chat.source)
  // Hermes only says when the newest chat last moved, so that's the one that can be unread.
  const latest = agent.lastChat?.id === chat.id
  const unread = useChatUnread(latest ? chat.id : undefined, agent.lastChat?.at)
  const press = useRef<ReturnType<typeof setTimeout>>(undefined)
  const held = useRef(false)
  const dragged = useRef(false)

  const x = useMotionValue(0)
  // Hidden at rest so its red can't bleed through the rounded corners.
  const actionOpacity = useTransform(x, [-REVEAL, -1, 0], [1, 1, 0])

  useEffect(() => {
    const controls = animate(x, revealed ? -REVEAL : 0, { type: 'spring', stiffness: 500, damping: 42 })
    return () => controls.stop()
  }, [revealed, x])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const open = info.offset.x < -REVEAL / 2 || info.velocity.x < -400
    // Settle even when the state doesn't change (a short drag that snaps back).
    animate(x, open ? -REVEAL : 0, { type: 'spring', stiffness: 500, damping: 42 })
    onReveal(open)
  }
  const release = () => clearTimeout(press.current)

  return (
    <motion.li
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
        className="pointer-events-none absolute top-0 right-0 left-4 z-10 h-[0.5px] bg-line-strong group-first:hidden"
      />
      {deletable && (
        <motion.button
          type="button"
          tabIndex={revealed ? 0 : -1}
          aria-hidden={!revealed}
          onClick={() => {
            setDeleting(true)
            onDelete()
          }}
          className="absolute inset-y-0 right-0 flex items-center justify-center bg-danger text-subhead font-medium text-white"
          style={{ width: REVEAL, opacity: actionOpacity }}
        >
          {deleting ? <Spinner className="text-white" /> : 'Delete'}
        </motion.button>
      )}

      <motion.div
        style={{ x }}
        drag={deletable ? 'x' : false}
        dragDirectionLock
        dragConstraints={{ left: -REVEAL, right: 0 }}
        dragElastic={{ left: 0.15, right: 0 }}
        onDragStart={() => {
          dragged.current = true
          release()
        }}
        onDragEnd={onDragEnd}
        className={cn(
          'relative flex items-center bg-elevated [background-image:linear-gradient(var(--fill-1),var(--fill-1))]',
          // One fill for the whole row, trash slot included, under its contents.
          'before:pointer-events-none before:absolute before:inset-0 before:transition-colors before:duration-150',
          'hover:before:bg-fill-1 has-[a:active]:before:bg-fill-2',
        )}
      >
        <Link
          href={`/chat/${agent.id}/${chat.id}`}
          draggable={false}
          onPointerDown={() => {
            held.current = false
            dragged.current = false
            if (!deletable) return
            press.current = setTimeout(() => {
              held.current = true
              navigator.vibrate?.(8)
              onReveal(true)
            }, 500)
          }}
          onPointerUp={release}
          onPointerLeave={release}
          onPointerCancel={release}
          onContextMenu={(e) => {
            if (!deletable) return
            e.preventDefault()
            onReveal(true)
          }}
          onClick={(e) => {
            // A hold, a swipe, or a tap on a row showing Delete never opens the chat.
            if (held.current || dragged.current || revealed) {
              e.preventDefault()
              if (revealed && !held.current && !dragged.current) onReveal(false)
            }
            held.current = false
            dragged.current = false
          }}
          className="relative flex min-h-15 min-w-0 flex-1 items-center gap-3 py-2.5 pr-4 pl-4 text-left select-none [-webkit-touch-callout:none] focus-visible:-outline-offset-2 [@media(hover:hover)]:pr-2"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span title={chat.title} className={cn('min-w-0 flex-1 truncate text-body', unread && 'font-semibold')}>
                {chat.title}
              </span>
              {unread && <span aria-label="New messages" className="size-2 flex-none self-center rounded-full bg-accent" />}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-footnote text-ink-3">
              {chat.routine && <span className="flex-none font-medium text-accent">Routine ·</span>}
              <span className="flex-none">{shortTime(chat.at)}</span>
              {via && <span className="flex-none">· via {via}</span>}
              {/* The main chat's title says what it is; what was said there tells them apart. */}
              {chat.main && chat.preview && <span className="min-w-0 truncate">· {chat.preview}</span>}
            </span>
          </span>
        </Link>
        {deletable && (
          <button
            type="button"
            onClick={() => onReveal(!revealed)}
            tabIndex={revealed ? -1 : 0}
            aria-label={`Delete “${chat.title}”`}
            className={cn(
              'pressable relative mr-2 hidden size-9 flex-none items-center justify-center rounded-full text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-fill-2 hover:text-danger focus-visible:opacity-100 [@media(hover:hover)]:flex',
              revealed && 'invisible',
            )}
          >
            <Trash2 size={16} strokeWidth={1.85} />
          </button>
        )}
      </motion.div>
    </motion.li>
  )
}
