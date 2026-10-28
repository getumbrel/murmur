import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { Link, useLocation } from 'wouter'
import { ArrowRight, MoreHorizontal, Pin, Repeat, SquarePen } from 'lucide-react'
import { create } from 'zustand'
import type { Agent } from '@/state/agents'
import { Grow } from '@/ui/grow'
import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import { useAgentChatList, useChatActions, useUnread, type AgentChat } from '@/features/agent-page/chats'
import { chatOptions } from '@/features/agent-page/chat-list'
import { RenameChatSheet } from '@/features/agent-page/rename-chat'
import { RowMenu, useLongPress } from './row-menu'

// An agent's pinned and latest chats, tucked under its row in the sidebar,
// with a way through to all of them on its page. Text only, on the row's name
// column, so the list stays calm: a chat the agent is working in keeps its
// place, its title aglow, and moves up when the reply lands. Right-click a
// chat, or its "…", to pin, rename, archive or delete it. An agent alone in the
// sidebar fills it: as many chats as there's room for, down to the foot.

const SHOWN = 4

/**
 * Pinned chats always, then the latest of the rest: four, or as many as there's
 * `room` for. A pin never costs a recent one its place.
 */
const sidebarChats = (chats: AgentChat[], room = 0) => {
  const pinned = chats.filter((c) => c.pinned)
  return [...pinned, ...chats.filter((c) => !c.pinned).slice(0, Math.max(SHOWN, room - pinned.length))]
}
const spring = { type: 'spring', duration: 0.34, bounce: 0 } as const

/** How many chats fit under each agent that has the sidebar to itself. */
const useRoom = create<Record<string, number | undefined>>(() => ({}))

export function NestedChats({
  id,
  agent,
  open,
  openChatId,
  fill,
}: {
  id: string
  agent: Agent
  open: boolean
  openChatId?: string
  /** Alone in the sidebar: list as many chats as fit. */
  fill?: boolean
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="chats"
          id={id}
          data-nested-chats=""
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: { ...spring, duration: 0.26 } }}
          transition={spring}
          className="overflow-hidden"
        >
          <List agent={agent} openChatId={openChatId} fill={fill} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Does the sidebar show this chat under its agent (so the agent's own row needn't be highlighted)? */
export function useShowsChat(agentId: string, open: boolean, chatId: string | undefined) {
  const { data } = useAgentChatList(open && chatId ? agentId : undefined)
  const room = useRoom((s) => s[agentId])
  return !!chatId && !!data && sidebarChats(data, room).some((c) => c.id === chatId)
}

/**
 * Keeps `useRoom` up to date for an agent whose chats fill the sidebar: the
 * rows `list` has, plus as many more as the sidebar has room left for (fewer
 * when it's over), less one for "All chats". Sizes come from layout, not what's
 * on screen, so the count is the same while the chats unfold as once they're
 * open, and it follows the window, a card arriving above or below, or one put away.
 */
function useFill(agentId: string, fill: boolean, list: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const ul = list.current
    const fold = ul?.closest<HTMLElement>('[data-nested-chats]')
    const scroller = fold?.closest<HTMLElement>('[data-sidebar-list]')
    const content = scroller?.firstElementChild as HTMLElement | null | undefined
    if (!fill || !ul || !fold || !scroller || !content) return
    const measure = () => {
      const [first, second] = ul.children as HTMLCollectionOf<HTMLElement>
      if (!second) return
      const pitch = second.offsetTop - first.offsetTop
      const pad = getComputedStyle(scroller)
      const height = scroller.clientHeight - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom)
      // The list's height, less everything else in it, is the chats' to take.
      const free = height - (content.offsetHeight - fold.offsetHeight)
      const fits = ul.children.length + Math.floor((free - ul.offsetHeight) / pitch)
      useRoom.setState({ [agentId]: fits - 1 })
    }
    // Before the first paint, so the list opens full rather than growing into it.
    measure()
    const observer = new ResizeObserver(measure)
    for (const el of [scroller, content, ul]) observer.observe(el)
    return () => {
      observer.disconnect()
      useRoom.setState({ [agentId]: undefined })
    }
  }, [agentId, fill, list])
}

function List({ agent, openChatId, fill = false }: { agent: Agent; openChatId?: string; fill?: boolean }) {
  const { data, isPending, filing } = useAgentChatList(agent.id)
  const room = useRoom((s) => s[agent.id])
  const chats = data ? sidebarChats(data, room) : []
  const act = useChatActions(agent.id)
  const [renaming, setRenaming] = useState<AgentChat | null>(null)
  const [, navigate] = useLocation()
  const list = useRef<HTMLUListElement>(null)
  useFill(agent.id, fill, list)
  // Folding away: out of reach (and out of ⌥↑/⌥↓'s walk) while it goes.
  const leaving = !useIsPresent()
  return (
    // Content (and the row highlights) on the name column: 8px + 10px + a 40px Buddy + 12px.
    <Grow>
      <ul
        ref={list}
        className="space-y-px pt-0.5 pb-2 pl-13"
        aria-label={`${agent.name}’s recent chats`}
        data-leaving={leaving || undefined}
        inert={leaving}
      >
        {isPending ? (
          [64, 48, 56].map((w, i) => (
            <li key={i} className="flex h-8 items-center px-2.5">
              <Skeleton className="h-2.5 rounded-full" style={{ width: `${w}%` }} />
            </li>
          ))
        ) : chats.length === 0 ? (
          <li>
            <Item href={`/chat/${agent.id}/new`} muted>
              <SquarePen size={14} strokeWidth={2} aria-hidden className="flex-none" />
              <span className="truncate">Start a chat</span>
            </Item>
          </li>
        ) : (
          chats.map((chat) => (
            <li key={chat.id}>
              <ChatItem
                agent={agent}
                chat={chat}
                selected={chat.id === openChatId}
                menu={
                  chatOptions(chat, act, {
                    filing,
                    rename: setRenaming,
                    // Out of the chat that's open, to its agent's main one.
                    leave: chat.id === openChatId ? () => navigate(act.away(chat), { replace: true }) : undefined,
                  }).menu
                }
              />
            </li>
          ))
        )}
        {!isPending && chats.length > 0 && (
          <li>
            <Item href={`/agent/${agent.id}`} muted>
              <span className="truncate">All chats</span>
              <ArrowRight size={13} strokeWidth={2} aria-hidden className="flex-none" />
            </Item>
          </li>
        )}
      </ul>
      <RenameChatSheet
        agent={agent}
        chat={renaming}
        onClose={() => setRenaming(null)}
        onRename={(title) => act.rename(renaming!, title)}
      />
    </Grow>
  )
}

// While the "…" shows, the trailing marks step aside for it and the title ends short of it.
const makesWay =
  'transition-opacity [@media(hover:hover)]:group-hover/chat:opacity-0 [@media(hover:hover)]:group-has-[:focus-visible]/chat:opacity-0 [@media(hover:hover)]:group-has-[[data-open]]/chat:opacity-0'
const clearsMore =
  '[@media(hover:hover)]:group-hover/chat:pr-8 [@media(hover:hover)]:group-has-[:focus-visible]/chat:pr-8 [@media(hover:hover)]:group-has-[[data-open]]/chat:pr-8'

function ChatItem({
  agent,
  chat,
  selected,
  menu,
}: {
  agent: Agent
  chat: AgentChat
  selected: boolean
  menu: ReturnType<typeof chatOptions>['menu']
}) {
  const unread = useUnread(chat)
  const [open, setOpen] = useState(false)
  const press = useLongPress(() => setOpen(true))
  const has = menu.length > 0
  const item = (
    <Item
      href={`/chat/${agent.id}/${chat.id}`}
      selected={selected}
      open={open}
      title={chat.result && chat.preview ? `${chat.title} · ${chat.preview}` : chat.title}
      press={has ? press : undefined}
      className={has ? clearsMore : undefined}
      nav
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          unread && 'font-medium text-ink',
          chat.busy === 'working' && 'text-shimmer',
          chat.busy === 'waiting' && 'font-medium text-accent',
        )}
      >
        {chat.title}
        {chat.busy && <span className="sr-only">{chat.busy === 'waiting' ? ', needs you' : ', working'}</span>}
      </span>
      {/* Trailing, so every title keeps the list's left edge. */}
      <span className={cn('flex flex-none items-center gap-1.5', has && makesWay)}>
        {chat.pinned && (
          <Pin
            size={11}
            strokeWidth={2.5}
            role="img"
            aria-label="Pinned"
            className="flex-none rotate-45 fill-current text-ink-3"
          />
        )}
        {chat.routine && (
          <Repeat size={12} strokeWidth={2.25} role="img" aria-label="Routine" className="flex-none text-ink-3" />
        )}
        {unread && <span aria-label="New messages" className="size-1.5 flex-none rounded-full bg-accent" />}
      </span>
    </Item>
  )
  if (!has) return item
  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal>
      <Popover.Anchor asChild>
        <div className="group/chat relative">
          {item}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`More for “${chat.title}”`}
            aria-haspopup="menu"
            data-open={open || undefined}
            className={cn(
              'pressable absolute top-1/2 right-1 hidden size-6 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-fill-2 hover:text-ink',
              'opacity-0 transition-opacity duration-150 ease-out group-hover/chat:opacity-100 focus-visible:opacity-100 data-open:opacity-100 [@media(hover:hover)]:grid',
            )}
          >
            <MoreHorizontal size={14} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </Popover.Anchor>
      <RowMenu
        open={open}
        name={chat.title}
        roomy={false}
        close={() => setOpen(false)}
        items={menu.map((o) => ({
          label: o.label,
          icon: <o.icon size={18} strokeWidth={1.85} />,
          onSelect: o.run,
          danger: o.danger,
        }))}
      />
    </Popover.Root>
  )
}

function Item({
  href,
  selected,
  open,
  muted,
  title,
  nav,
  press,
  className,
  children,
}: {
  href: string
  selected?: boolean
  /** Its menu is open. */
  open?: boolean
  muted?: boolean
  title?: string
  /** A chat ⌥↑/⌥↓ can land on. */
  nav?: boolean
  press?: ReturnType<typeof useLongPress>
  className?: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      title={title}
      data-nav={nav ? 'chat' : undefined}
      aria-current={selected ? 'page' : undefined}
      {...press}
      className={cn(
        'relative isolate flex h-8 items-center gap-1.5 rounded-md px-2.5 text-footnote select-none [-webkit-touch-callout:none]',
        'transition-colors duration-150 active:bg-fill-2',
        selected ? 'font-medium text-ink' : cn(muted ? 'text-ink-3' : 'text-ink-2', 'hover:bg-fill-1 hover:text-ink'),
        open && !selected && 'bg-fill-1 text-ink',
        className,
      )}
    >
      {/* The sidebar's one selection, gliding here from the agent's row. */}
      {selected && (
        <motion.span
          layoutId="roster-selection"
          aria-hidden
          className="absolute inset-0 -z-10 rounded-md bg-accent-soft"
          transition={{ type: 'spring', duration: 0.38, bounce: 0.12 }}
        />
      )}
      {children}
    </Link>
  )
}
