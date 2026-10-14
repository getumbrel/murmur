import type { CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'wouter'
import { Plus } from 'lucide-react'
import { Buddy, BuddyStack } from '@/ui/buddy'
import { cn } from '@/lib/cn'
import type { Agent } from '@/state/agents'
import { useAgentStatus, useChatUnread } from '@/state/status'
import { TEMPLATES } from '@/features/templates/templates'
import { shortTime } from '@/features/home/time'

// One agent in the All agents gallery: its live Buddy in its own light, its
// name and what it's for, and when you last talked (or what it's doing now).

const ease = [0.16, 1, 0.3, 1] as const

const card =
  'group/card pressable relative flex min-w-0 flex-col items-center overflow-hidden rounded-2xl px-3 pt-6 pb-4 text-center select-none'

export function AgentCard({ agent }: { agent: Agent }) {
  const status = useAgentStatus(agent.id)
  const busy = Boolean(status.activity && status.state !== 'idle' && status.state !== 'done')
  const unread = useChatUnread(agent.lastChat?.id, agent.lastChat?.at) && !busy
  const line = busy ? status.activity! : agent.lastChat ? shortTime(agent.lastChat.at) : 'No chats yet'
  return (
    <Link
      href={`/agent/${agent.id}`}
      aria-label={`${agent.name}${agent.role ? `, ${agent.role}` : ''}${unread ? ', new messages' : ''}`}
      className={cn(card, 'hue-scope bg-fill-1 hover:bg-fill-2 active:bg-fill-2')}
      style={{ '--hue': agent.hue } as CSSProperties}
    >
      {/* Its own colour, softly, from behind it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-10 left-1/2 size-44 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)] transition-opacity duration-300 [@media(hover:hover)]:opacity-80 [@media(hover:hover)]:group-hover/card:opacity-100"
      />
      <span className="relative transition-transform duration-300 ease-[var(--ease-out)] [@media(hover:hover)]:group-hover/card:-translate-y-0.5">
        <Buddy hue={agent.hue} size={72} state={status.state} seed={agent.id} />
      </span>
      <span className="relative mt-3 w-full truncate text-body font-semibold tracking-[-0.015em]" title={agent.name}>
        {agent.name}
      </span>
      <span
        className={cn(
          'relative mt-0.5 line-clamp-2 min-h-[2.25rem] w-full text-footnote text-balance break-words',
          agent.role ? 'text-ink-2' : 'text-ink-3',
        )}
      >
        {agent.role || (agent.isDefault ? 'Your main agent' : 'Your agent')}
      </span>
      <span className="relative mt-2.5 flex h-4 w-full items-center justify-center gap-1.5 overflow-hidden">
        {unread && <span aria-hidden className="size-1.5 flex-none rounded-full bg-accent" />}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={busy ? `busy:${line}` : 'idle'}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.26, ease }}
            className={cn(
              'block truncate text-caption',
              busy
                ? status.state === 'waiting'
                  ? 'font-medium text-accent'
                  : 'text-shimmer'
                : unread
                  ? 'font-medium text-accent'
                  : 'text-ink-3',
            )}
          >
            {line}
          </motion.span>
        </AnimatePresence>
      </span>
    </Link>
  )
}

/** Make one from a template: three of them huddle where a Buddy would stand. */
export function NewAgentCard({ onClick }: { onClick: () => void }) {
  const faces = [TEMPLATES[0], TEMPLATES[1], TEMPLATES[3]]
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        card,
        'bg-transparent ring-1 ring-line-strong ring-inset hover:bg-fill-1 active:bg-fill-2 [&_.buddy]:block',
      )}
    >
      <span className="relative grid size-18 place-items-center opacity-90 transition-[opacity,transform] duration-300 ease-[var(--ease-out)] [@media(hover:hover)]:group-hover/card:-translate-y-0.5 [@media(hover:hover)]:group-hover/card:opacity-100">
        <BuddyStack hues={faces.map((t) => t.hue)} seeds={faces.map((t) => t.id)} size={72} />
        <span
          aria-hidden
          className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full bg-ink text-bg ring-[3px] ring-bg"
        >
          <Plus size={16} strokeWidth={2.5} />
        </span>
      </span>
      <span className="mt-3 w-full truncate text-body font-semibold tracking-[-0.015em]">New agent</span>
      <span className="mt-0.5 line-clamp-2 min-h-[2.25rem] w-full text-footnote text-balance text-ink-2">
        Start from a template, or from scratch
      </span>
      <span className="mt-2.5 h-4" />
    </button>
  )
}
