import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { Link } from 'wouter'
import { ArrowRight, Repeat, SquarePen } from 'lucide-react'
import type { Agent } from '@/state/agents'
import { useChatUnread } from '@/state/status'
import { Grow } from '@/ui/grow'
import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import { useAgentChatList, type AgentChat } from '@/features/agent-page/chats'

// An agent's latest chats, tucked under its row in the sidebar, with a way
// through to all of them on its page. Text only, on the row's name column,
// so the list stays calm.

const SHOWN = 4
const spring = { type: 'spring', duration: 0.34, bounce: 0 } as const

export function NestedChats({
  id,
  agent,
  open,
  openChatId,
}: {
  id: string
  agent: Agent
  open: boolean
  openChatId?: string
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="chats"
          id={id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: { ...spring, duration: 0.26 } }}
          transition={spring}
          className="overflow-hidden"
        >
          <List agent={agent} openChatId={openChatId} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Does the sidebar show this chat under its agent (so the agent's own row needn't be highlighted)? */
export function useShowsChat(agentId: string, open: boolean, chatId: string | undefined) {
  const { data } = useAgentChatList(open && chatId ? agentId : undefined)
  return !!chatId && !!data?.slice(0, SHOWN).some((c) => c.id === chatId)
}

function List({ agent, openChatId }: { agent: Agent; openChatId?: string }) {
  const { data, isPending } = useAgentChatList(agent.id)
  const chats = data?.slice(0, SHOWN) ?? []
  // Folding away: out of reach (and out of ⌥↑/⌥↓'s walk) while it goes.
  const leaving = !useIsPresent()
  return (
    // Content (and the row highlights) on the name column: 8px + 10px + a 40px Buddy + 12px.
    <Grow>
      <ul
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
              <ChatItem agent={agent} chat={chat} selected={chat.id === openChatId} />
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
    </Grow>
  )
}

function ChatItem({ agent, chat, selected }: { agent: Agent; chat: AgentChat; selected: boolean }) {
  // Hermes only says when the newest chat last moved, so that's the one that can be unread.
  const latest = agent.lastChat?.id === chat.id
  const unread = useChatUnread(latest ? chat.id : undefined, agent.lastChat?.at)
  return (
    <Item href={`/chat/${agent.id}/${chat.id}`} selected={selected} title={chat.title} nav>
      <span className={cn('min-w-0 flex-1 truncate', unread && 'font-medium text-ink')}>{chat.title}</span>
      {/* Trailing, so every title keeps the list's left edge. */}
      {chat.routine && (
        <Repeat size={12} strokeWidth={2.25} role="img" aria-label="Routine" className="flex-none text-ink-3" />
      )}
      {unread && <span aria-label="New messages" className="size-1.5 flex-none rounded-full bg-accent" />}
    </Item>
  )
}

function Item({
  href,
  selected,
  muted,
  title,
  nav,
  children,
}: {
  href: string
  selected?: boolean
  muted?: boolean
  title?: string
  /** A chat ⌥↑/⌥↓ can land on. */
  nav?: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      title={title}
      data-nav={nav ? 'chat' : undefined}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'relative isolate flex h-8 items-center gap-1.5 rounded-md px-2.5 text-footnote select-none',
        'transition-colors duration-150 active:bg-fill-2',
        selected ? 'font-medium text-ink' : cn(muted ? 'text-ink-3' : 'text-ink-2', 'hover:bg-fill-1 hover:text-ink'),
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
