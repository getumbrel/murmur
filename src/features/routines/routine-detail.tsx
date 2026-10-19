import { useEffect, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown, MessageSquareText, Play, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet } from '@/ui/sheet'
import { Button } from '@/ui/button'
import { Toggle } from '@/ui/toggle'
import { Spinner } from '@/ui/spinner'
import { Grow } from '@/ui/grow'
import { ConfirmCard } from '@/ui/confirm-card'
import { cn } from '@/lib/cn'
import { Markdown } from '@/features/chat/lazy-markdown'
import type { Agent } from '@/state/agents'
import { useQueries } from '@tanstack/react-query'
import {
  fetchRunResult,
  runResultKey,
  useJobRuns,
  useRoutineActions,
  useRoutines,
  useRunningNow,
  type JobRun,
  type Routine,
  type RunResult,
} from '@/state/routines'
import { markChatSeen } from '@/state/status'
import { foldQuiet } from './runs'
import { Glyph } from './glyph'
import { TimeWheel } from './time-wheel'
import { RepeatPicker } from './day-picker'
import { iconFor } from './templates'
import { capitalize, describeWhen, relativeDate, zoneLabel, type Days } from './schedule'
import { useAgentTimezone } from '@/state/timezone'
import { StatusLine } from './routine-item'

const spring = { type: 'spring', duration: 0.35, bounce: 0 } as const

type Props = {
  agent: Agent
  routineId: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Open a run as a chat (it's an ordinary chat with the agent). */
  onOpenRun?: (runId: string) => void
  /** A result to show open from the start. */
  openRunId?: string
}

/** One routine: when it runs, switch it off, run it now, see what it made. */
export function RoutineDetailSheet({ agent, routineId, open, onOpenChange, onOpenRun, openRunId }: Props) {
  const { data } = useRoutines(agent.id, { live: open })
  const routine = data?.find((r) => r.id === routineId)
  // Keep showing the last known routine while the sheet animates away after a delete.
  const [shown, setShown] = useState<Routine | undefined>(routine)
  useEffect(() => {
    if (routine) setShown(routine)
  }, [routine])
  const r = routine ?? shown

  return (
    <Sheet open={open && Boolean(r)} onOpenChange={onOpenChange} title={r?.name ?? 'Routine'} width={460}>
      {r && (
        <Grow className="hue-scope" style={{ '--hue': agent.hue } as CSSProperties}>
          <Body agent={agent} routine={r} openRunId={openRunId} onClose={() => onOpenChange(false)} onOpenRun={onOpenRun} />
        </Grow>
      )}
    </Sheet>
  )
}

function Body({
  agent,
  routine,
  openRunId,
  onClose,
  onOpenRun,
}: {
  agent: Agent
  routine: Routine
  openRunId?: string
  onClose: () => void
  onOpenRun?: (id: string) => void
}) {
  const reduce = useReducedMotion()
  const actions = useRoutineActions(agent.id)
  const running = useRunningNow((s) => Boolean(s.ids[routine.id]))
  const [editing, setEditing] = useState(false)
  const Icon = iconFor(routine.template, routine.name)
  const when = routine.when
  const editable = when?.kind === 'time' && !routine.done
  // Every time here is on the agent's clock, the one its schedule keeps. When
  // that isn't this device's, say whose it is.
  const zone = useAgentTimezone(agent.id).data || undefined
  const label = when && (when.kind !== 'every' || when.from !== undefined) ? zoneLabel(zone, routine.nextAt) : ''
  const headline = capitalize(describeWhen(when, routine.scheduleText, zone)) + (label ? `, ${label} time` : '')

  const runNow = () =>
    actions.runNow(routine).then(
      () => toast.success(`${routine.name} is ready`),
      () => toast.error(`${agent.name} couldn’t run that just now. Try again in a moment.`),
    )

  return (
    <div className="pb-1">
      {/* When, and the switch */}
      <div className="rounded-xl bg-fill-1">
        <div className="flex items-center gap-3 p-4">
          <Glyph icon={Icon} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium">{headline}</p>
            <StatusLine routine={routine} zone={zone} className="text-footnote" />
          </div>
          {!routine.done && (
            <Toggle
              checked={routine.enabled}
              label={`${routine.name} on`}
              onChange={(on) =>
                actions.setEnabled(routine, on).catch(() => toast.error('Couldn’t change that. Try again.'))
              }
            />
          )}
        </div>
        {editable && (
          <>
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              aria-expanded={editing}
              className="flex h-11 w-full items-center justify-between px-4 text-subhead text-accent shadow-[inset_0_0.5px_0_var(--line)] transition-colors hover:bg-fill-1"
            >
              {editing ? 'Done' : 'Change time'}
              <ChevronDown
                size={16}
                strokeWidth={2}
                className={cn('transition-transform duration-300 ease-[var(--ease-sheet)]', editing && 'rotate-180')}
              />
            </button>
            <AnimatePresence initial={false}>
              {editing && when?.kind === 'time' && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={reduce ? { duration: 0.12 } : { height: spring, opacity: { duration: 0.2 } }}
                  className="overflow-hidden"
                >
                  <EditTime
                    hour={when.hour}
                    minute={when.minute}
                    days={when.days}
                    onSave={(hour, minute, days) => {
                      setEditing(false)
                      actions
                        .reschedule(routine, { kind: 'time', hour, minute, days })
                        .catch(() => toast.error('Couldn’t change the time. Try again.'))
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* What it does */}
      {routine.prompt && routine.ownWords && (
        <section className="mt-6">
          <h3 className="mb-2 px-4 text-footnote font-medium text-ink-2">What {agent.name} does</h3>
          <p className="rounded-xl bg-fill-1 px-4 py-3 text-subhead whitespace-pre-wrap">{routine.prompt}</p>
        </section>
      )}
      {routine.deliver === 'telegram' && (
        <p className="mt-3 flex items-center gap-1.5 px-4 text-footnote text-ink-2">
          <Send size={14} strokeWidth={2} aria-hidden /> Results also go to Telegram.
        </p>
      )}

      <Button variant="secondary" size="lg" className="mt-6" onClick={runNow} disabled={running}>
        {running ? <Spinner /> : <Play size={16} strokeWidth={2.25} aria-hidden className="fill-current" />}
        {running ? `${agent.name} is on it…` : 'Run now'}
      </Button>

      <section className="mt-8">
        <h3 className="mb-2 px-4 text-footnote font-medium text-ink-2">Results</h3>
        <RoutineRunsList
          key={openRunId}
          agentId={agent.id}
          routine={routine}
          zone={zone}
          openRunId={openRunId}
          onOpenRun={onOpenRun ? (id) => (onClose(), onOpenRun(id)) : undefined}
        />
      </section>

      <ConfirmCard
        className="mt-8"
        label="Delete routine"
        title="Delete this routine?"
        body={`${agent.name} will stop doing it. Results you already have stay.`}
        confirm="Delete"
        onConfirm={() => {
          onClose()
          actions.remove(routine).catch(() => toast.error('Couldn’t delete that routine. Try again.'))
        }}
      />
    </div>
  )
}

function EditTime({
  hour,
  minute,
  days,
  onSave,
}: {
  hour: number
  minute: number
  days: Days
  onSave: (hour: number, minute: number, days: Days) => void
}) {
  const [time, setTime] = useState({ hour, minute })
  const [d, setD] = useState(days)
  const changed = time.hour !== hour || time.minute !== minute || d.join() !== days.join()
  return (
    <div className="space-y-4 px-4 pt-1 pb-4">
      <TimeWheel
        hour={time.hour}
        minute={time.minute}
        onChange={(h, m) => setTime({ hour: h, minute: m })}
        className="bg-fill-2"
      />
      <RepeatPicker days={d} onChange={setD} />
      <Button variant="accent" className="w-full" disabled={!changed} onClick={() => onSave(time.hour, time.minute, d)}>
        Save
      </Button>
    </div>
  )
}

// ── Results ─────────────────────────────────────────────────────────────────

/** A routine's past runs, newest first; tap one to read what came of it. Runs with nothing to report fold together. */
export function RoutineRunsList({
  agentId,
  routine,
  zone,
  openRunId,
  onOpenRun,
}: {
  agentId: string
  routine: Routine
  /** Times on this zone's clock (the agent's) rather than this browser's. */
  zone?: string
  /** A run to show open from the start. */
  openRunId?: string
  onOpenRun?: (runId: string) => void
}) {
  const runs = useJobRuns(agentId, routine.id)
  const running = useRunningNow((s) => Boolean(s.ids[routine.id]))
  const [openId, setOpenId] = useState<string | null>(openRunId ?? null)
  const results = useQueries({
    queries: (runs.data ?? []).map((run) => ({
      queryKey: runResultKey(agentId, run),
      queryFn: () => fetchRunResult(agentId, run.id),
      staleTime: Infinity,
    })),
  })
  const resultOf = new Map((runs.data ?? []).map((run, i) => [run.id, results[i]?.data]))
  // Opening a run reopens it in Hermes, so one that has had its say isn't still going, whatever Hermes says.
  const list = (runs.data ?? []).map((run) => {
    const r = resultOf.get(run.id)
    return run.running && (r?.quiet || r?.text) ? { ...run, running: false } : run
  })
  const groups = foldQuiet(list, (run) => resultOf.get(run.id)?.quiet === true && !resultOf.get(run.id)?.replied)

  // Reading a result is reading that run: it no longer counts as new.
  useEffect(() => {
    if (openId) markChatSeen(openId)
  }, [openId])

  // A run that just finished: open it, so Run now lands on its result. Until
  // the result is in, "Working on it" stays put rather than blinking out.
  const [wasRunning, setWasRunning] = useState(running)
  const [arriving, setArriving] = useState(false)
  useEffect(() => {
    if (wasRunning && !running) {
      setArriving(true)
      void runs
        .refetch()
        .then((r) => r.data?.[0] && setOpenId(r.data[0].id))
        .finally(() => setArriving(false))
    }
    setWasRunning(running)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])
  const live = running || arriving

  if (runs.isPending) {
    return (
      <div className="flex justify-center rounded-xl bg-fill-1 py-8 text-ink-3">
        <Spinner size={18} />
      </div>
    )
  }
  if (!list.length && !live) {
    return (
      <p className="rounded-xl bg-fill-1 px-6 py-6 text-center text-subhead text-balance text-ink-3">
        {routine.enabled && routine.nextAt
          ? `Nothing yet. The first one arrives ${relativeDate(routine.nextAt, { withTime: true, zone })}.`
          : 'Nothing yet. Run it now to see what you’ll get.'}
      </p>
    )
  }
  return (
    <ul className="overflow-hidden rounded-xl bg-fill-1">
      <AnimatePresence initial={false}>
        {live && !list[0]?.running && (
          <motion.li
            key="live"
            layout
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
            className="flex min-h-14 items-center gap-3 px-4"
          >
            <Spinner className="text-accent" />
            <span className="text-shimmer text-subhead">Working on it now</span>
          </motion.li>
        )}
        {groups.map((group) =>
          group.kind === 'quiet' ? (
            <QuietRow key={`quiet-${group.runs.at(-1)!.id}`} runs={group.runs} zone={zone} />
          ) : (
            <RunRow
              key={group.run.id}
              run={group.run}
              result={resultOf.get(group.run.id)}
              zone={zone}
              open={openId === group.run.id}
              onToggle={() => setOpenId((o) => (o === group.run.id ? null : group.run.id))}
              onOpenRun={onOpenRun}
            />
          ),
        )}
      </AnimatePresence>
    </ul>
  )
}

const rowMotion = {
  layout: true,
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { type: 'spring', duration: 0.4, bounce: 0 },
  className: '[&+&]:shadow-[inset_0_0.5px_0_var(--line)]',
} as const

/** Runs in a row that had nothing to report: one calm line, so the results stand out. */
function QuietRow({ runs, zone }: { runs: JobRun[]; zone?: string }) {
  const last = capitalize(relativeDate(runs[0].at, { withTime: true, zone }))
  return (
    <motion.li {...rowMotion}>
      <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block text-subhead text-ink-3">Nothing to report</span>
          <span className="block truncate text-footnote text-ink-3">
            {runs.length > 1 ? `Checked ${runs.length} times, last ${last.replace(/^\w/, (c) => c.toLowerCase())}` : last}
          </span>
        </span>
      </div>
    </motion.li>
  )
}

function plain(md: string) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~|]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function RunRow({
  run,
  result,
  zone,
  open,
  onToggle,
  onOpenRun,
}: {
  run: JobRun
  result?: RunResult
  zone?: string
  open: boolean
  onToggle: () => void
  onOpenRun?: (id: string) => void
}) {
  const reduce = useReducedMotion()
  const text = result?.text ?? ''
  const summary = run.running ? '' : plain(text)
  return (
    <motion.li {...rowMotion}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-fill-1 active:bg-fill-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-subhead">{capitalize(relativeDate(run.at, { withTime: true, zone }))}</span>
          {run.running ? (
            <span className="text-shimmer block text-footnote">Working on it</span>
          ) : (
            <AnimatePresence initial={false}>
              {!open && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="block truncate text-footnote text-ink-2"
                >
                  {summary || (result ? 'No answer this time' : '\u00a0')}
                </motion.span>
              )}
            </AnimatePresence>
          )}
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={cn(
            'flex-none text-ink-3 transition-transform duration-300 ease-[var(--ease-sheet)]',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0.12 } : { height: spring, opacity: { duration: 0.2 } }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              {!result && !run.running ? (
                <div className="flex justify-center py-4 text-ink-3">
                  <Spinner />
                </div>
              ) : text ? (
                <div className="text-subhead [&_p]:my-1.5">
                  <Markdown text={text} />
                </div>
              ) : (
                <p className="text-subhead text-ink-3">
                  {run.running ? 'Still working on it.' : 'It finished without an answer.'}
                </p>
              )}
              {onOpenRun && (
                <Button variant="ghost" size="sm" className="-ml-3 mt-1 text-accent!" onClick={() => onOpenRun(run.id)}>
                  <MessageSquareText size={15} strokeWidth={2} aria-hidden />
                  {result?.replied ? 'Open the chat' : 'Continue in chat'}
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}
