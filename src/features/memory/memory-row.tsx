import { Brain } from 'lucide-react'
import type { CSSProperties } from 'react'
import { ListRow } from '@/ui/list'
import { Skeleton } from '@/ui/skeleton'
import type { Agent } from '@/state/agents'
import { useMemories } from '@/state/memory'

/**
 * "Memory · Remembers 7 things", for the agent sheet. Sits in a ListGroup
 * (or any `rounded-xl bg-fill-1` list); opens <MemorySheet> via `onOpen`.
 */
export function MemoryRow({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const { data, isPending, isError } = useMemories(agent.id)
  const count = data?.length ?? 0
  const subtitle = isPending ? (
    <Skeleton className="inline-block h-2.5 w-32 rounded-full align-middle" />
  ) : isError ? (
    `What ${agent.name} remembers`
  ) : count === 0 ? (
    'Nothing saved yet'
  ) : (
    `Remembers ${count === 1 ? 'one thing' : `${count} things`}`
  )
  return (
    <ListRow
      icon={
        <RowIcon hue={agent.hue}>
          <Brain size={16} strokeWidth={2} />
        </RowIcon>
      }
      title="Memory"
      subtitle={subtitle}
      onClick={onOpen}
      chevron
    />
  )
}

/** The tinted tile Murmur's agent rows lead with. */
export function RowIcon({ hue, children }: { hue: number; children: React.ReactNode }) {
  return (
    <span
      className="hue-scope flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent"
      style={{ '--hue': hue } as CSSProperties}
      aria-hidden
    >
      {children}
    </span>
  )
}
