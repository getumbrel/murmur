import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import type { Agent } from '@/state/agents'
import { useChatUnread } from '@/state/status'
import { useRoutineNews, useRoutines, type RoutineNews } from '@/state/routines'
import { shortTime } from '@/features/home/time'
import { Glyph } from './glyph'
import { resultLine } from '@shared/routines.ts'
import { iconFor } from './templates'

// What an agent's routines have found lately, on its page above its chats:
// each routine's newest result, and one calm line for the ones that checked
// and found nothing. A run with nothing to say is the routine doing its job,
// not news, so it never lands among the chats or lights anything up.

export function RoutineNewsList({
  agent,
  onOpen,
}: {
  agent: Agent
  /** Open a routine, with this result showing. */
  onOpen: (routineId: string, runId?: string) => void
}) {
  const routines = useRoutines(agent.id).data
  const news = useRoutineNews(agent.id)
  // Nothing to show until a routine has run at least once.
  if (!routines?.length || (news.data && !news.data.length)) return null

  return (
    <section aria-labelledby="agent-routine-news">
      <h2 id="agent-routine-news" className="mb-2 px-4 text-footnote font-medium text-ink-2">
        From routines
      </h2>
      {!news.data ? (
        <div role="status" className="overflow-hidden rounded-xl bg-fill-1">
          <span className="sr-only">Loading what routines found</span>
          {[52, 68].map((w, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5 pl-4">
              <Skeleton className="size-9 rounded-[11px]" />
              <span className="min-w-0 flex-1">
                <span className="flex h-6 items-center">
                  <Skeleton className="h-3.5 w-28 rounded-full" />
                </span>
                <span className="flex h-4.5 items-center">
                  <Skeleton className="h-2.5 rounded-full" style={{ width: `${w}%` }} />
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <ul className="animate-fade overflow-hidden rounded-xl bg-fill-1">
          {news.data.map((item) => (
            <NewsRow key={item.routine.id} item={item} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  )
}

function NewsRow({ item, onOpen }: { item: RoutineNews; onOpen: (routineId: string, runId?: string) => void }) {
  const { routine, latest, quiet, more } = item
  const unread = useChatUnread(latest?.run.id, latest?.run.lastAt)
  const at = latest?.run.at ?? item.lastAt
  const checks = `${quiet}${more ? '+' : ''} ${quiet === 1 && !more ? 'time' : 'times'}`
  return (
    <li className="[&+&]:shadow-[inset_0_0.5px_0_var(--line)]">
      <button
        type="button"
        onClick={() => onOpen(routine.id, latest?.run.id)}
        className="flex min-h-15 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-fill-1 active:bg-fill-2"
      >
        <Glyph icon={iconFor(routine.template, routine.name)} size={36} className={cn(!latest && 'opacity-55')} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('min-w-0 truncate text-body', unread && 'font-semibold')}>{routine.name}</span>
            {unread && <span aria-label="New" className="size-2 flex-none self-center rounded-full bg-accent" />}
            <span className={cn('ml-auto flex-none text-footnote tabular-nums', unread ? 'font-medium text-accent' : 'text-ink-3')}>
              {at ? shortTime(at) : ''}
            </span>
          </span>
          {latest ? (
            <span className="block truncate text-footnote text-ink-2">{resultLine(latest.text, routine.name)}</span>
          ) : (
            <span className="block truncate text-footnote text-ink-3">Checked {checks}, nothing new</span>
          )}
        </span>
      </button>
    </li>
  )
}
