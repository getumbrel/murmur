import type { CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'wouter'
import { ChevronRight } from 'lucide-react'
import { Orb } from '@/ui/orb'
import { cn } from '@/lib/cn'
import { useAgents, type Agent } from '@/state/agents'
import { useGroupSummaries } from '@/state/groups'
import { useAgentStatus } from '@/state/status'
import { ChatList } from '@/features/agent-page/chat-list'
import { useAgentChatList } from '@/features/agent-page/chats'
import { noteArrivals } from './roster'

// Most people have one agent. For them a roster of one is a detour: Home is
// that agent's chats, one tap from any of them, with the agent itself just
// above. A second agent (or a group) brings the roster back, the newcomer
// arriving with its halo.

/** The only agent, while there's just one and no groups. */
export function useSoloAgent(): Agent | undefined {
  const agents = useAgents().data
  const groups = useGroupSummaries()
  const solo = agents?.length === 1 && !groups.data?.length ? agents[0] : undefined
  // Keep the roster's arrivals current while it's away, so whoever ends the
  // solo gets their halo when the roster comes back (once groups are in, or
  // ones that were always there would read as new).
  if (solo && !groups.isPending) noteArrivals([solo.id])
  return solo
}

const ease = [0.16, 1, 0.3, 1] as const

export function SoloChats({ agent, title }: { agent: Agent; title: React.ReactNode }) {
  const chats = useAgentChatList(agent)
  return (
    <div className="hue-scope px-5" style={{ '--hue': agent.hue } as CSSProperties}>
      <AgentCard agent={agent} />
      {title}
      <ChatList
        agent={agent}
        chats={chats.data}
        pending={chats.isPending}
        failed={chats.isError}
        onRetry={() => void chats.refetch()}
        filing={chats.filing}
        heading={false}
        plain
      />
    </div>
  )
}

/** Who these chats are with, in their own light; it opens the agent's page. */
function AgentCard({ agent }: { agent: Agent }) {
  const status = useAgentStatus(agent.id)
  const busy = Boolean(status.activity && status.state !== 'idle' && status.state !== 'done')
  const line = busy ? status.activity! : agent.role || (agent.isDefault ? 'Your main agent' : 'Your agent')
  return (
    <Link
      href={`/agent/${agent.id}`}
      aria-label={`${agent.name}, agent details`}
      className="group/card pressable relative mb-6 flex items-center gap-3.5 overflow-hidden rounded-2xl bg-fill-1 py-3 pr-3 pl-2.5 select-none hover:bg-fill-2"
    >
      {/* Its colour, softly, from behind its face. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 -left-10 size-40 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
      />
      <span className="relative flex-none">
        <Orb hue={agent.hue} size={52} state={status.state} seed={agent.id} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-body font-semibold tracking-[-0.015em]">{agent.name}</span>
        <span className="relative block h-5 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={busy ? `busy:${line}` : 'idle'}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.26, ease }}
              className={cn(
                'block truncate text-subhead',
                busy ? (status.state === 'waiting' ? 'font-medium text-accent' : 'text-shimmer') : 'text-ink-2',
              )}
            >
              {line}
            </motion.span>
          </AnimatePresence>
        </span>
      </span>
      <ChevronRight
        size={20}
        strokeWidth={2.25}
        aria-hidden
        className="relative flex-none text-ink-3 transition-transform duration-200 ease-[var(--ease-out)] [@media(hover:hover)]:group-hover/card:translate-x-0.5"
      />
    </Link>
  )
}
