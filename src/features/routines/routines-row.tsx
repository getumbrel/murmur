import { Repeat } from 'lucide-react'
import { ListRow } from '@/ui/list'
import { Skeleton } from '@/ui/skeleton'
import type { Agent } from '@/state/agents'
import { useRoutines } from '@/state/routines'
import { RowIcon } from '@/features/memory/memory-row'
import { describeNext } from './schedule'

/**
 * "Routines · 2 on", with what's coming next, for the agent sheet. Sits in a
 * ListGroup beside Memory and Telegram; opens <RoutinesSheet> via `onOpen`.
 */
export function RoutinesRow({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const { data } = useRoutines(agent.id)
  const on = data?.filter((r) => r.enabled) ?? []
  const next = on.filter((r) => r.nextAt).sort((a, b) => a.nextAt! - b.nextAt!)[0]
  const subtitle = !data ? (
    <Skeleton className="inline-block h-2.5 w-40 rounded-full align-middle" />
  ) : next ? (
    `Next: ${next.name}, ${describeNext(next.when, next.nextAt)}`
  ) : data.length ? (
    'All paused'
  ) : (
    `Have ${agent.name} do things on a schedule`
  )
  return (
    <ListRow
      icon={
        <RowIcon hue={agent.hue}>
          <Repeat size={16} strokeWidth={2} />
        </RowIcon>
      }
      title="Routines"
      subtitle={subtitle}
      detail={data?.length ? <span className="tabular-nums">{on.length ? `${on.length} on` : 'Off'}</span> : undefined}
      onClick={onOpen}
      chevron
    />
  )
}
