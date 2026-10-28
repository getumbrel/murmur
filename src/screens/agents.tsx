import { useEffect, useState } from 'react'
import { MotionConfig, motion, useReducedMotion } from 'motion/react'
import { Plus } from 'lucide-react'
import { IconButton } from '@/ui/button'
import { Skeleton } from '@/ui/skeleton'
import { useIsWide } from '@/lib/use-media'
import { useAgents, type Agent } from '@/state/agents'
import { useBusyAgents } from '@/state/status'
import { useAgentActions } from '@/features/home/actions'
import { agentAt } from '@/features/home/roster'
import { AgentCard, NewAgentCard } from '@/features/agent-page/agent-card'
import { PageBar } from '@/features/agent-page/page-bar'
import { usePageScroll } from '@/features/agent-page/scroll'

// All agents: everyone you can talk to, as a gallery of cards, with a card
// for making another. The main agent leads; the rest follow by who you
// talked to last (one at work stays put until it replies, as in the roster).

// Cards arrive once, a beat apart; never again on the way back.
let greeted = false

export function AgentsScreen() {
  const { data: agents, isPending } = useAgents()
  const busy = useBusyAgents()
  const wide = useIsWide()
  const actions = useAgentActions()
  const reduce = useReducedMotion()
  const { page, title, scrolled, under, onScroll } = usePageScroll<HTMLHeadingElement>('agents')
  const [arrive] = useState(() => !greeted && !reduce)
  useEffect(() => {
    if (agents) greeted = true
  }, [agents])

  const at = (a: Agent) => agentAt(a, busy)
  const sorted = agents && [...agents].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || at(b) - at(a))

  return (
    <MotionConfig reducedMotion="user">
      <div ref={page} onScroll={onScroll} className="h-dvh overflow-y-auto overscroll-contain bg-bg">
        <PageBar
          title="Agents"
          scrolled={scrolled}
          under={under}
          back={wide ? undefined : { href: '/', label: 'Murmur' }}
          trailing={
            wide ? undefined : (
              <IconButton size="lg" label="New agent" onClick={actions.newAgent}>
                <Plus size={20} strokeWidth={1.85} />
              </IconButton>
            )
          }
        />
        <div className="mx-auto w-full max-w-[60rem] px-5 pb-[max(40px,env(safe-area-inset-bottom))] md:px-8">
          <div className="pt-1 pb-5 md:pt-6 md:pb-7">
            <h1 ref={title} className="text-large font-semibold tracking-[-0.025em]">
              Agents
            </h1>
            {/* Holds its line while the count loads, so the gallery never jumps. */}
            <p className="mt-0.5 min-h-[1.375rem] text-subhead text-ink-2">
              {sorted && (sorted.length === 1 ? 'One agent, ready when you are.' : `${sorted.length} agents, each with its own knack.`)}
            </p>
          </div>

          <ul className="grid grid-cols-2 gap-3 min-[600px]:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(184px,1fr))] md:gap-4">
            {isPending || !sorted
              ? [0, 1, 2, 3].map((i) => (
                  <li key={i} className="flex flex-col items-center rounded-2xl bg-fill-1 px-3 pt-6 pb-4">
                    <Skeleton className="size-18 rounded-full" />
                    <Skeleton className="mt-4 h-3.5 w-20 rounded-full" />
                    <Skeleton className="mt-2.5 h-2.5 w-28 rounded-full opacity-60" />
                    <Skeleton className="mt-4 h-2 w-14 rounded-full opacity-50" />
                  </li>
                ))
              : [...sorted.map((a) => ({ key: a.id, agent: a })), { key: 'new', agent: undefined }].map(
                  ({ key, agent }, i) => (
                    <motion.li
                      key={key}
                      className="grid"
                      initial={arrive ? { opacity: 0, y: 10, scale: 0.97 } : false}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: 'spring', duration: 0.5, bounce: 0.18, delay: Math.min(i, 8) * 0.04 }}
                    >
                      {agent ? <AgentCard agent={agent} /> : <NewAgentCard onClick={actions.newAgent} />}
                    </motion.li>
                  ),
                )}
          </ul>
        </div>
        {actions.sheets}
      </div>
    </MotionConfig>
  )
}
