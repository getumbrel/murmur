import { useState } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { Grow } from '@/ui/grow'
import { cn } from '@/lib/cn'
import type { GroupChatRow, GroupRow } from './groups'
import { Item } from './nested-chats'

// A group's chats, tucked under its row in the sidebar the way an agent's are:
// text only, on the row's name column, newest first. One the group is talking
// in has its title aglow; one with something new has a dot.

const spring = { type: 'spring', duration: 0.34, bounce: 0 } as const

export function NestedGroupChats({
  id,
  group,
  open,
  openChatId,
}: {
  id: string
  group: GroupRow
  open: boolean
  openChatId?: string
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
          <List group={group} openChatId={openChatId} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const SHOWN = 4

function List({ group, openChatId }: { group: GroupRow; openChatId?: string }) {
  // Folding away: out of reach (and out of ⌥↑/⌥↓'s walk) while it goes.
  const leaving = !useIsPresent()
  // The latest few, and the one that's open wherever it falls; the rest are a click away.
  const [all, setAll] = useState(false)
  const chats =
    all || group.chats.length <= SHOWN + 1
      ? group.chats
      : group.chats.filter((c, i) => i < SHOWN || c.id === openChatId)
  return (
    <Grow>
      <ul
        className="space-y-px pt-0.5 pb-2 pl-13"
        aria-label={`Chats with ${group.name}`}
        data-leaving={leaving || undefined}
        inert={leaving}
      >
        {chats.map((chat) => (
          <li key={chat.id}>
            <Chat chat={chat} selected={chat.id === openChatId} />
          </li>
        ))}
        {chats.length < group.chats.length && (
          <li>
            <button
              type="button"
              onClick={() => setAll(true)}
              className="flex h-8 w-full items-center gap-1.5 rounded-md px-2.5 text-left text-footnote text-ink-3 transition-colors duration-150 select-none hover:bg-fill-1 hover:text-ink active:bg-fill-2"
            >
              <span className="truncate">All {group.chats.length} chats</span>
              <ChevronDown size={13} strokeWidth={2} aria-hidden className="flex-none" />
            </button>
          </li>
        )}
      </ul>
    </Grow>
  )
}

function Chat({ chat, selected }: { chat: GroupChatRow; selected: boolean }) {
  const unread = chat.unread && !chat.live
  return (
    <Item href={`/group/${chat.id}`} selected={selected} title={chat.title || undefined} nav>
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          !chat.title && !selected && 'text-ink-3',
          unread && 'font-medium text-ink',
          chat.live && 'text-shimmer',
        )}
      >
        {chat.title || 'New chat'}
        {chat.live && <span className="sr-only">, working</span>}
      </span>
      {unread && <span aria-label="New messages" className="size-1.5 flex-none rounded-full bg-accent" />}
    </Item>
  )
}
