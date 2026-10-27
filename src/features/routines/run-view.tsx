import { useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { motion } from 'motion/react'
import { Play, Repeat } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/ui/button'
import { Spinner } from '@/ui/spinner'
import { api } from '@/hermes/rest'
import type { Agent } from '@/state/agents'
import type { ChatItem } from '@/features/chat/types'
import { useAgentTimezone } from '@/state/timezone'
import { useRoutineActions, useRoutines, useRunningNow, type RunOf } from '@/state/routines'
import { Glyph } from './glyph'
import { iconFor } from './templates'
import { capitalize, describeWhen, relativeDate } from './schedule'
import { RoutineDetailSheet } from './routine-detail'
import { isQuiet, isRunBrief, runTitle } from '@shared/routines.ts'

// A routine's run, opened, reads as a report: what the routine is and when it
// ran, then what the agent found. Hermes's brief to the agent (which opens
// every run as if you'd written it) stays out of sight, and an answer of
// "nothing to report" says so in words.

/**
 * The run's items as they read here, and when it ran. Any other chat passes
 * through. Until it's known which a chat is, it reads as a run might, so a
 * run's brief never shows for a moment.
 */
export function useRunItems(run: RunOf | undefined, items: ChatItem[]) {
  const passThrough = run === null
  return useMemo(() => {
    if (passThrough) return { items, ranAt: undefined }
    let ranAt: number | undefined
    const shown = items.flatMap<ChatItem>((item) => {
      if (item.kind === 'user' && isRunBrief(item.text)) {
        ranAt ??= item.at || undefined
        return []
      }
      if (item.kind === 'assistant' && !item.streaming && isQuiet(item.text))
        return [{ kind: 'notice', id: item.id, text: 'Nothing to report this time.' }]
      return [item]
    })
    return { items: shown, ranAt }
  }, [passThrough, items])
}

/** What sits above a run: the routine, when it ran, what it was asked, and a way to run it again. */
export function RunHeader({
  agent,
  chatId,
  routineId,
  title,
  ranAt,
}: {
  agent: Agent
  chatId: string
  routineId?: string
  title?: string
  ranAt?: number
}) {
  const [, navigate] = useLocation()
  const routines = useRoutines(agent.id)
  const routine = routines.data?.find((r) => r.id === routineId)
  const actions = useRoutineActions(agent.id)
  const running = useRunningNow((s) => Boolean(routineId && s.ids[routineId]))
  const zone = useAgentTimezone(agent.id).data || undefined
  const [details, setDetails] = useState(false)

  const name = routine?.name ?? (runTitle(title ?? '') || 'Routine')
  const when = [
    ranAt && `Ran ${relativeDate(ranAt, { withTime: true, zone })}`,
    routine && !routine.done && capitalize(describeWhen(routine.when, routine.scheduleText, zone)),
  ]
    .filter(Boolean)
    .join(' · ')

  const runAgain = () => {
    if (!routine) return
    const id = toast.loading(`${agent.name} is working on “${routine.name}”…`)
    actions.runNow(routine).then(
      async () => {
        const res = await api
          .get<{ runs?: { id: string }[] }>(
            `/api/cron/jobs/${encodeURIComponent(routine.id)}/runs?profile=${encodeURIComponent(agent.id)}&limit=1`,
          )
          .catch(() => ({ runs: [] as { id: string }[] }))
        const newest = res.runs?.[0]?.id
        toast.success(`${routine.name} is ready`, {
          id,
          action: newest && newest !== chatId ? { label: 'See it', onClick: () => navigate(`/chat/${agent.id}/${newest}`) } : undefined,
        })
      },
      () => toast.error(`${agent.name} couldn’t run that just now. Try again in a moment.`, { id }),
    )
  }

  // Nothing rather than a placeholder name until the routines are in.
  if (!routines.data) return null

  return (
    <motion.header
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
      className="mb-8"
    >
      <div className="flex items-center gap-3">
        <Glyph icon={iconFor(routine?.template, name)} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold">{name}</p>
          {when && <p className="truncate text-footnote text-ink-2">{when}</p>}
        </div>
      </div>
      {routine?.prompt && routine.ownWords && (
        <p className="mt-4 line-clamp-4 rounded-2xl bg-fill-1 px-4 py-3 text-subhead whitespace-pre-wrap text-ink-2">
          {routine.prompt}
        </p>
      )}
      {routine && (
        <div className="mt-3 flex flex-wrap gap-1 -ml-3">
          <Button variant="ghost" size="sm" className="text-accent!" onClick={runAgain} disabled={running}>
            {running ? <Spinner /> : <Play size={14} strokeWidth={2.25} aria-hidden className="fill-current" />}
            {running ? `${agent.name} is on it…` : 'Run again'}
          </Button>
          <Button variant="ghost" size="sm" className="text-accent!" onClick={() => setDetails(true)}>
            <Repeat size={15} strokeWidth={2} aria-hidden />
            Routine
          </Button>
        </div>
      )}
      <RoutineDetailSheet
        agent={agent}
        routineId={routineId}
        open={details}
        onOpenChange={setDetails}
        onOpenRun={(runId) => {
          setDetails(false)
          if (runId !== chatId) navigate(`/chat/${agent.id}/${runId}`)
        }}
      />
    </motion.header>
  )
}
