import type { HTMLAttributes, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, SquarePen } from 'lucide-react'
import { Link, useLocation } from 'wouter'
import { IconButton } from '@/ui/button'
import { Orb, type OrbState } from '@/ui/orb'
import { cn } from '@/lib/cn'
import { upFrom } from '@/lib/transitions'

type Props = {
  agent?: { id: string; name: string; hue: number }
  orb: OrbState
  /** Live status words, or the model name when idle. */
  subtitle: string
  live: boolean
  showBack: boolean
  /** Messages are scrolled beneath it: frost it and draw the edge. */
  scrolled: boolean
  onNewChat: () => void
  /** The agent's own page: its other chats, routines, memory and settings. */
  onOpenAgent: () => void
  /** Pinned just under the bar, e.g. the chat's goal. */
  below?: ReactNode
  /** Beside the back chevron: what's waiting elsewhere (an unread count, a needs-you dot). */
  backBadge?: ReactNode
  /** Read out with "Back", e.g. ", 2 unread". */
  backHint?: string
  /** More things to do with the chat, before New chat (e.g. a "…" menu). */
  menu?: ReactNode
  /** Extra handlers for the agent's name, e.g. press and hold for that menu. */
  titleProps?: HTMLAttributes<HTMLButtonElement>
}

export function ChatHeader({
  agent,
  orb,
  subtitle,
  live,
  showBack,
  scrolled,
  onNewChat,
  onOpenAgent,
  below,
  backBadge,
  backHint = '',
  menu,
  titleProps,
}: Props) {
  // Back to wherever this chat was opened from: its agent's page, or Home.
  const [location] = useLocation()
  const up = upFrom(location)
  return (
    // (Only the bar itself takes touches; what hangs below it lets them through.)
    <header className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20">
      <div
        aria-hidden
        className={cn(
          'glass absolute inset-x-0 top-0 h-[calc(3.5rem+env(safe-area-inset-top))] hairline-b transition-opacity duration-300',
          !scrolled && 'opacity-0',
        )}
      />
      {/* The back chevron's stroke and the new-chat glyph land on the
          thread's own 16px (24px) margins, so the bar and the messages share
          one left and one right edge. The buttons keep their full 44px. */}
      <div
        className={cn(
          'pointer-events-auto relative mx-auto flex h-14 max-w-[736px] items-center gap-1 pr-0 sm:pr-2',
          showBack ? 'pl-0 sm:pl-2' : 'pl-2',
        )}
      >
        {showBack && (
          <Link
            href={up}
            aria-label={`${up === '/' ? 'All chats' : 'Back'}${backHint}`}
            className="pressable relative z-10 -mr-2.5 flex h-11 min-w-11 flex-none items-center rounded-full pr-2.5 pl-1.5 text-accent hover:bg-fill-1"
          >
            <ChevronLeft size={26} strokeWidth={2} aria-hidden className="flex-none" />
            {backBadge}
          </Link>
        )}

        <button
          type="button"
          {...titleProps}
          onClick={onOpenAgent}
          disabled={!agent}
          aria-label={agent ? `${agent.name}: chats and settings` : undefined}
          className={cn(
            'group/agent pressable flex min-w-0 flex-1 items-center gap-2.5 rounded-full py-1 pr-3 text-left select-none',
            !showBack && 'pl-2.5',
          )}
          title={agent ? `${agent.name}’s chats and settings` : undefined}
        >
          {agent ? (
            // Named for the orb's flight in from the agent's row (src/lib/transitions.ts).
            <span data-orb={agent.id} className="flex-none">
              <Orb hue={agent.hue} size={34} state={orb} seed={agent.id} />
            </span>
          ) : (
            <span className="size-[34px] flex-none rounded-full bg-fill-2" />
          )}
          <span className="min-w-0 flex-1">
            {/* A small chevron after the name says it opens, as a contact's name does in Messages. */}
            <span className="flex min-w-0 items-center gap-0.5">
              <span className="truncate text-subhead leading-5 font-semibold tracking-[-0.01em]">
                {agent?.name ?? ' '}
              </span>
              {agent && (
                <ChevronRight
                  size={14}
                  strokeWidth={2.5}
                  aria-hidden
                  className="flex-none text-ink-3 transition-transform duration-200 ease-[var(--ease-out)] [@media(hover:hover)]:group-hover/agent:translate-x-0.5"
                />
              )}
            </span>
            <span className="relative block h-4 overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={subtitle}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className={cn('block truncate text-caption', live ? 'text-accent' : 'text-ink-3')}
                >
                  {subtitle}
                </motion.span>
              </AnimatePresence>
            </span>
          </span>
        </button>

        {menu}
        <IconButton size="lg" label="New chat" onClick={onNewChat} disabled={!agent}>
          <SquarePen size={20} strokeWidth={1.85} aria-hidden />
        </IconButton>
      </div>
      {below}
    </header>
  )
}
