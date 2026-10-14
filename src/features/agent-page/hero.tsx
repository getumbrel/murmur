import type { Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { Buddy, type BuddyState } from '@/ui/buddy'
import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import type { Agent } from '@/state/agents'
import type { AgentStatus } from '@/state/status'
import { prettyModel } from '@/features/model/names'
import { useModelOptions } from '@/features/model/use-models'

// Who this is: a big, live Buddy in its own soft light, its name, what it's
// for, and the model it thinks with (a tap changes it).

const ease = [0.16, 1, 0.3, 1] as const

export function AgentHero({
  agent,
  status,
  perk,
  titleRef,
  onModel,
}: {
  agent: Agent
  status: AgentStatus
  /** Something is about to start a chat with it: it looks up and listens. */
  perk: boolean
  titleRef: Ref<HTMLHeadingElement>
  onModel: () => void
}) {
  const busy = Boolean(status.activity && status.state !== 'idle' && status.state !== 'done')
  const state: BuddyState = status.state === 'idle' && perk ? 'listening' : status.state
  return (
    <section className="flex flex-col items-center px-5 text-center">
      <div className="relative grid place-items-center">
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-14 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
        />
        {/* The face that flies here from its row, its card or a chat's header (src/lib/transitions.ts). */}
        <span data-orb={agent.id} className="relative">
          <Buddy hue={agent.hue} size={104} state={state} seed={agent.id} label={`${agent.name}, ${describe(state)}`} />
        </span>
      </div>
      <h1
        ref={titleRef}
        className="mt-5 max-w-full text-large font-semibold tracking-[-0.025em] text-balance [overflow-wrap:anywhere]"
      >
        {agent.name}
      </h1>
      {/* What it's for, or (while it's busy) what it's doing right now. */}
      <div className="relative mt-1 min-h-[1.375rem] w-full max-w-80">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={busy ? 'busy' : 'role'}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease }}
            className={cn(
              'text-subhead text-balance',
              busy ? (status.state === 'waiting' ? 'font-medium text-accent' : 'text-shimmer') : 'text-ink-2',
              !busy && !agent.role && 'text-ink-3',
            )}
          >
            {busy ? status.activity : agent.role || (agent.isDefault ? 'Your main agent' : 'Your agent')}
          </motion.p>
        </AnimatePresence>
      </div>
      <ModelButton agent={agent} onClick={onModel} />
    </section>
  )
}

function ModelButton({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  const options = useModelOptions(agent.id)
  const model = options.data?.current?.model ?? agent.model
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={model ? `Model: ${prettyModel(model)}. Change` : 'Choose a model'}
      className="pressable touch-target relative mt-3.5 flex h-8 max-w-full items-center gap-1 rounded-full bg-fill-2 pr-2.5 pl-3.5 text-footnote font-medium text-ink-2 select-none hover:bg-fill-3 hover:text-ink"
    >
      {model ? (
        <span className="truncate">{prettyModel(model)}</span>
      ) : options.isPending ? (
        <Skeleton className="h-2.5 w-20 rounded-full" />
      ) : (
        <span>Choose a model</span>
      )}
      <ChevronDown size={14} strokeWidth={2.25} aria-hidden className="flex-none text-ink-3" />
    </button>
  )
}

const describe = (s: BuddyState) =>
  ({
    idle: 'here',
    listening: 'listening',
    speaking: 'talking',
    thinking: 'thinking',
    working: 'working',
    waiting: 'needs you',
    done: 'just finished',
    error: 'something went wrong',
    offline: 'offline',
  })[s]
