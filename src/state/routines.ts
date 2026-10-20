// Routines: things an agent does on its own, on a schedule. They're Hermes's
// scheduled jobs (per agent), started from Hermes's built-in blueprints or
// from a plain request. Every run is a chat Hermes keeps; Murmur shows what
// came of it with its routine and leaves out runs with nothing to report.
// Among your chats, each routine is one line, its newest result, and a run
// you've replied in is a chat of its own.
//
// Results are delivered "locally" (saved only), which is what makes them show
// up here; Telegram is offered only when that agent has Telegram connected.

import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMemo, useRef } from 'react'
import { create } from 'zustand'
import { api, HermesError } from '@/hermes/rest'
import { agentZone, ensureAgentTimezone } from '@/state/timezone'
import {
  dayPreset,
  hhmm,
  isoInZone,
  landsAt,
  nextOccurrence,
  parseSchedule,
  toSchedule,
  type RawSchedule,
  type When,
} from '@/features/routines/schedule'
import { isQuiet, isRunBrief, routineIdOf, runTitle } from '@/features/routines/runs'

// ── Shapes ──────────────────────────────────────────────────────────────────

type RawJob = {
  id: string
  name?: string
  prompt?: string
  enabled?: boolean
  state?: string
  schedule?: RawSchedule
  schedule_display?: string
  next_run_at?: string | null
  last_run_at?: string | null
  last_status?: string | null
  last_error?: string | null
  last_delivery_error?: string | null
  deliver?: string
  created_at?: string
  /** Murmur's own note of the template a routine came from (Hermes keeps unknown fields). */
  murmur_template?: string
}

export type Routine = {
  id: string
  agentId: string
  name: string
  /** What the agent is asked to do each time. */
  prompt: string
  /** On, and will run again. */
  enabled: boolean
  /** A one-off that already happened. */
  done: boolean
  when: When | null
  /** Hermes's own wording, for schedules Murmur can't put in words. */
  scheduleText: string
  nextAt?: number
  lastAt?: number
  lastOk?: boolean
  lastError?: string
  /** 'local' (saved here) or 'telegram'. */
  deliver: string
  /** The template it came from: a blueprint key, 'custom' or 'custom-once'. Unknown for routines made elsewhere. */
  template?: string
  /** The request is the person's own words (not a template's instructions), so it's worth showing. */
  ownWords: boolean
  createdAt: number
}

export type BlueprintField = {
  name: string
  type: 'time' | 'enum' | 'text' | 'weekdays'
  label: string
  default?: string
  options: string[]
  optional?: boolean
  help?: string
}

export type Blueprint = {
  key: string
  title: string
  description: string
  category: string
  fields: BlueprintField[]
  /** Cron template, e.g. "{minute} {hour} * * 1-5". */
  schedule: string
  scheduleHuman: string
}

export type RoutineRun = {
  /** The run's chat id (open it like any chat). */
  id: string
  routineId: string
  /** The routine's name, or the run's own title if the routine is gone. */
  routineName: string
  at: number
  /** When it last moved: when it finished, or when you last replied in it. */
  lastAt: number
  /** Hermes closed it as a routine run. Until then it's going; opening it in a chat reopens it. */
  finished: boolean
  messageCount: number
}

export type JobRun = {
  id: string
  at: number
  endedAt?: number
  lastAt: number
  running: boolean
  messageCount: number
}

/** What came of a run: what the agent said last, whether that was "nothing to report", and whether you replied. */
export type RunResult = { text: string; quiet: boolean; replied: boolean }

// ── Reading ─────────────────────────────────────────────────────────────────

const p = (agentId: string) => `profile=${encodeURIComponent(agentId)}`
const job = (id: string, agentId: string, action = '') =>
  `/api/cron/jobs/${encodeURIComponent(id)}${action ? `/${action}` : ''}?${p(agentId)}`
const ms = (iso?: string | null) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? undefined : t
}

function toRoutine(j: RawJob, agentId: string): Routine {
  const done = j.state === 'completed'
  const template = j.murmur_template || undefined
  return {
    id: j.id,
    agentId,
    name: (j.name || j.prompt || 'Routine').trim(),
    prompt: (j.prompt ?? '').trim(),
    enabled: j.enabled !== false && j.state !== 'paused' && !done,
    done,
    when: parseSchedule(j.schedule),
    scheduleText: j.schedule?.display || j.schedule_display || '',
    nextAt: j.enabled === false ? undefined : ms(j.next_run_at),
    lastAt: ms(j.last_run_at),
    lastOk: j.last_status ? j.last_status === 'ok' : undefined,
    lastError: j.last_error || j.last_delivery_error || undefined,
    deliver: j.deliver || 'local',
    template,
    ownWords: !template || template === 'custom' || template === 'custom-once',
    createdAt: ms(j.created_at) ?? 0,
  }
}

export const routinesKey = (agentId: string) => ['routines', agentId] as const
export const routineRunsKey = (agentId: string) => ['routine-runs', agentId] as const

export function useRoutines(agentId: string | undefined, { live = false } = {}) {
  return useQuery({
    queryKey: routinesKey(agentId ?? ''),
    enabled: Boolean(agentId),
    queryFn: async () => {
      const rows = await api.get<RawJob[]>(`/api/cron/jobs?${p(agentId!)}`)
      const list = (Array.isArray(rows) ? rows : [])
        .map((j) => toRoutine(j, agentId!))
        .sort((a, b) => a.createdAt - b.createdAt)
      return healNextRuns(agentId!, list)
    },
    staleTime: 15_000,
    // While a sheet is open, keep "Next" and fresh runs current.
    refetchInterval: live ? 30_000 : false,
  })
}

export function useBlueprints(agentId: string | undefined) {
  return useQuery({
    queryKey: ['routine-blueprints', agentId],
    enabled: Boolean(agentId),
    queryFn: async () => {
      const res = await api.get<{ blueprints: Blueprint[] }>(`/api/cron/blueprints?${p(agentId!)}`)
      return res.blueprints ?? []
    },
    staleTime: 10 * 60_000,
  })
}

/** Where results can go besides Murmur. Telegram only once it's connected and has a home chat. */
export function useDeliveryTargets(agentId: string | undefined) {
  return useQuery({
    queryKey: ['routine-targets', agentId],
    enabled: Boolean(agentId),
    queryFn: async () => {
      type Target = { id: string; home_target_set?: boolean }
      const res = await api.get<{ targets: Target[] }>(`/api/cron/delivery-targets?${p(agentId!)}`)
      return { telegram: (res.targets ?? []).some((t) => t.id === 'telegram' && t.home_target_set !== false) }
    },
    staleTime: 60_000,
  })
}

type SessionRow = {
  id: string
  title?: string | null
  started_at?: number
  ended_at?: number | null
  end_reason?: string | null
  last_active?: number
  is_active?: boolean
  message_count?: number
}

/**
 * Every run of every routine of one agent, newest first, labelled with the
 * routine's name. Runs are chats: open one by its `id` like any other.
 */
export function useRoutineRuns(agentId: string | undefined) {
  const routines = useRoutines(agentId)
  const runs = useQuery({
    queryKey: routineRunsKey(agentId ?? ''),
    enabled: Boolean(agentId),
    queryFn: async () => {
      const res = await api.get<{ sessions?: SessionRow[] }>(
        `/api/sessions?${p(agentId!)}&source=cron&order=recent&limit=100`,
      )
      return (res.sessions ?? []).flatMap((s) => {
        const routineId = routineIdOf(s.id)
        if (!routineId) return []
        const at = (s.started_at ?? 0) * 1000
        return [
          {
            id: s.id,
            routineId,
            title: runTitle(s.title ?? ''),
            at,
            lastAt: s.last_active ? s.last_active * 1000 : at,
            // Hermes ends a run "cron_complete" (or "cron_incomplete_no_output"); opening it reopens it.
            finished: Boolean(s.end_reason?.startsWith('cron_')),
            messageCount: s.message_count ?? 0,
          },
        ]
      })
    },
    staleTime: 15_000,
  })
  const names = new Map(routines.data?.map((r) => [r.id, r.name]))
  const data: RoutineRun[] | undefined = runs.data?.map(({ title, ...r }) => ({
    ...r,
    routineName: names.get(r.routineId) ?? (title || 'Routine'),
  }))
  return { ...runs, data }
}

/** One routine's runs, newest first. */
export function useJobRuns(agentId: string, routineId: string | undefined) {
  return useQuery({
    queryKey: ['routine-job-runs', agentId, routineId],
    enabled: Boolean(routineId),
    queryFn: async () => {
      const res = await api.get<{ runs: SessionRow[] }>(`${job(routineId!, agentId, 'runs')}&limit=30`)
      return (res.runs ?? []).map<JobRun>((r) => {
        const at = (r.started_at ?? 0) * 1000
        return {
          id: r.id,
          at,
          endedAt: r.ended_at ? r.ended_at * 1000 : undefined,
          lastAt: r.last_active ? r.last_active * 1000 : at,
          running: Boolean(r.is_active) && !r.end_reason,
          messageCount: r.message_count ?? 0,
        }
      })
    },
    staleTime: 10_000,
  })
}

/** What came of a run. A run that has moved since is asked again; one that hasn't never changes. */
export const runResultKey = (agentId: string, run: { id: string; lastAt: number }) =>
  ['routine-run-result', agentId, run.id, run.lastAt] as const

export async function fetchRunResult(agentId: string, runId: string): Promise<RunResult> {
  type Row = { id?: number; timestamp?: number; role?: string; content?: string | null }
  const res = await api.get<{ messages?: Row[] }>(
    `/api/sessions/${encodeURIComponent(runId)}/messages?${p(agentId)}&order=latest&limit=20`,
  )
  const rows = (res.messages ?? []).sort((a, b) => (a.timestamp ?? a.id ?? 0) - (b.timestamp ?? b.id ?? 0))
  const said = rows.filter((r) => r.role === 'assistant' && r.content?.trim())
  const text = (said.at(-1)?.content ?? '').trim()
  return {
    text: isQuiet(text) ? '' : text,
    quiet: isQuiet(text),
    // Anything you wrote, as opposed to Hermes's brief that opens every run.
    replied: rows.some((r) => r.role === 'user' && r.content?.trim() && !isRunBrief(r.content)),
  }
}

// ── What came of them ───────────────────────────────────────────────────────

/** How many of a routine's newest runs are read for its latest result. */
const LOOK_BACK = 12

export type RoutineNews = {
  routine: Routine
  /** Its newest run with something to say, and what it said. */
  latest?: { run: RoutineRun; text: string }
  /** Runs since then (or in all, with no result) that had nothing to report. */
  quiet: number
  /** There were more quiet runs than were read. */
  more: boolean
  /** Its newest run that said something (or nothing to report). */
  lastAt?: number
}

/**
 * Each routine that has run, with what it last had to say, newest first;
 * the ones with nothing to report so far go last. Reads only each routine's
 * newest few runs, and each run once. While a new or moving run is read, what
 * was known stays, so nothing blinks out and back.
 */
export function useRoutineNews(agentId: string | undefined) {
  const held = useRef<{ agentId?: string; data?: RoutineNews[] }>({})
  const routines = useRoutines(agentId)
  const runs = useRoutineRuns(agentId)
  const byRoutine = new Map<string, RoutineRun[]>()
  for (const run of runs.data ?? []) {
    const list = byRoutine.get(run.routineId) ?? []
    if (list.length < LOOK_BACK) byRoutine.set(run.routineId, [...list, run])
  }
  const read = [...byRoutine.values()].flat()
  const results = useQueries({
    queries: read.map((run) => ({
      queryKey: runResultKey(agentId ?? '', run),
      queryFn: () => fetchRunResult(agentId!, run.id),
      staleTime: Infinity,
      enabled: Boolean(agentId),
    })),
  })
  const resultOf = new Map(read.map((run, i) => [run.id, results[i]?.data]))
  const loaded = results.every((r) => !r.isPending)
  // Opening a run reopens it in Hermes, so whether it's finished says little;
  // what it said does. One still going has said nothing yet, and one you've
  // replied in is a conversation now, among the chats.
  const said = (run: RoutineRun) => {
    const r = resultOf.get(run.id)
    return !r || r.replied ? undefined : r.quiet ? 'quiet' : r.text ? 'result' : undefined
  }

  const data: RoutineNews[] | undefined =
    routines.data && runs.data && loaded
      ? routines.data
          .filter((r) => byRoutine.get(r.id)?.some(said))
          .map((routine) => {
            const list = byRoutine.get(routine.id)!.filter(said)
            const index = list.findIndex((run) => said(run) === 'result')
            const latest = index >= 0 ? { run: list[index], text: resultOf.get(list[index].id)!.text } : undefined
            const quiet = index >= 0 ? index : list.length
            const total = runs.data!.filter((run) => run.routineId === routine.id).length
            return { routine, latest, quiet, more: index < 0 && total > LOOK_BACK, lastAt: list[0]?.at }
          })
          .sort((a, b) => (b.latest?.run.at ?? -1) - (a.latest?.run.at ?? -1) || (b.lastAt ?? 0) - (a.lastAt ?? 0))
      : undefined
  if (data) held.current = { agentId, data }
  return {
    data: data ?? (held.current.agentId === agentId ? held.current.data : undefined),
    isPending: routines.isPending || runs.isPending || !loaded,
  }
}

/** Runs you've replied in, which have become conversations. */
export function useContinuedRuns(agentId: string | undefined) {
  const runs = useRoutineRuns(agentId)
  const open = (runs.data ?? []).filter((run) => !run.finished)
  const results = useQueries({
    queries: open.map((run) => ({
      queryKey: runResultKey(agentId ?? '', run),
      queryFn: () => fetchRunResult(agentId!, run.id),
      staleTime: Infinity,
      enabled: Boolean(agentId),
    })),
  })
  const replied = open.filter((_, i) => results[i]?.data?.replied)
  const key = replied.map((run) => `${run.id}@${run.lastAt}:${run.routineName}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => (runs.data ? replied : undefined), [Boolean(runs.data), key])
  return { ...runs, data }
}

/** How many routines an agent has switched on, for "Routines · 2 on". */
export function useRoutineCount(agentId: string | undefined) {
  const { data } = useRoutines(agentId)
  return { total: data?.length ?? 0, on: data?.filter((r) => r.enabled).length ?? 0, loaded: Boolean(data) }
}

// ── Running now ─────────────────────────────────────────────────────────────

/** Routines running because someone pressed Run now (survives closing the sheet). */
export const useRunningNow = create<{ ids: Record<string, true> }>(() => ({ ids: {} }))

function setRunning(id: string, on: boolean) {
  useRunningNow.setState((s) => {
    const ids = { ...s.ids }
    if (on) ids[id] = true
    else delete ids[id]
    return { ids }
  })
}

// ── Changing ────────────────────────────────────────────────────────────────

/**
 * Hermes works out "next run" in the timezone each of its processes read when
 * it started, which is stale (UTC) right after Murmur fills one in. For
 * time-of-day routines Murmur works the next occurrence out itself and pins
 * it whenever Hermes's answer lands on the wrong wall-clock time.
 */
function pinFor(when: When | null, theirs: string | null | undefined, zone: string): Record<string, string> {
  if (when?.kind !== 'time' || !zone) return {}
  const at = ms(theirs)
  if (at && at > Date.now() && landsAt(at, when, zone)) return {}
  const next = nextOccurrence(when, zone)
  return next ? { next_run_at: isoInZone(next, zone) } : {}
}

async function pin(agentId: string, j: RawJob, when: When | null, zone: string) {
  const updates = pinFor(when, j.next_run_at, zone)
  if (Object.keys(updates).length) await api.put(job(j.id, agentId), { updates }).catch(() => {})
}

/** Quietly correct routines whose next run Hermes put on the wrong wall-clock time. */
async function healNextRuns(agentId: string, list: Routine[]): Promise<Routine[]> {
  const now = Date.now()
  const running = useRunningNow.getState().ids
  const suspects = list.filter(
    (r) => r.enabled && r.when?.kind === 'time' && r.nextAt && r.nextAt > now + 60_000 && !running[r.id],
  )
  if (!suspects.length) return list
  const zone = await agentZone(agentId).catch(() => '')
  if (!zone) return list
  const fixed = new Map<string, number>()
  await Promise.all(
    suspects.map(async (r) => {
      const when = r.when as Extract<When, { kind: 'time' }>
      if (landsAt(r.nextAt!, when, zone)) return
      const next = nextOccurrence(when, zone, now)
      if (!next) return
      try {
        await api.put(job(r.id, agentId), { updates: { next_run_at: isoInZone(next, zone) } })
        fixed.set(r.id, next)
      } catch {
        // Leave it; the next look tries again.
      }
    }),
  )
  return fixed.size ? list.map((r) => (fixed.has(r.id) ? { ...r, nextAt: fixed.get(r.id) } : r)) : list
}

export type TemplateInput = {
  agentId: string
  blueprint: Blueprint
  /** Values for the blueprint's own fields (time and days come from `when`). */
  values: Record<string, string>
  when?: Extract<When, { kind: 'time' }>
  name?: string
  deliver: 'local' | 'telegram'
}

export async function createFromTemplate({ agentId, blueprint, values, when, name, deliver }: TemplateInput) {
  const zone = await ensureAgentTimezone(agentId)
  const has = (n: string) => blueprint.fields.some((f) => f.name === n)
  const filled: Record<string, string> = {}
  for (const f of blueprint.fields) {
    if (f.name === 'deliver') filled.deliver = deliver
    else if (f.type === 'time' && when) filled[f.name] = hhmm(when.hour, when.minute)
    else if (f.type === 'weekdays' && when) filled[f.name] = dayPreset(when.days) ?? 'everyday'
    else if (f.name === 'day' && when && when.days.length === 1) {
      const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][when.days[0]]
      filled.day = f.options.includes(day) ? day : (f.default ?? f.options[0])
    } else if (values[f.name] !== undefined) filled[f.name] = values[f.name]
  }
  const created = await api.post<RawJob>(`/api/cron/blueprints/instantiate?${p(agentId)}`, {
    blueprint: blueprint.key,
    values: filled,
  })

  const updates: Record<string, unknown> = { murmur_template: blueprint.key }
  if (name && name !== created.name) updates.name = name
  if (!has('deliver') || created.deliver !== deliver) updates.deliver = deliver
  // Days the blueprint can't say itself (Mon/Wed/Fri) go in as a schedule.
  if (when && created.schedule?.expr !== toSchedule(when)) updates.schedule = toSchedule(when)
  else Object.assign(updates, pinFor(when ?? null, created.next_run_at, zone))
  const saved = await api.put<RawJob>(job(created.id, agentId), { updates }).catch(() => created)
  // A new schedule makes Hermes recompute "next", so check it once more.
  if (updates.schedule) await pin(agentId, saved, when ?? null, zone)
  return created.id
}

export type CustomInput = {
  agentId: string
  prompt: string
  when: When
  name: string
  deliver: 'local' | 'telegram'
}

export async function createCustom({ agentId, prompt, when, name, deliver }: CustomInput) {
  const zone = await ensureAgentTimezone(agentId)
  const created = await api.post<RawJob>(`/api/cron/jobs?${p(agentId)}`, {
    name,
    prompt,
    schedule: toSchedule(when),
    deliver,
  })
  const updates = {
    murmur_template: when.kind === 'once' ? 'custom-once' : 'custom',
    ...pinFor(when, created.next_run_at, zone),
  }
  await api.put(job(created.id, agentId), { updates }).catch(() => {})
  return created.id
}

export async function setRoutineEnabled(routine: Routine, on: boolean) {
  const res = await api.post<RawJob>(job(routine.id, routine.agentId, on ? 'resume' : 'pause'))
  // Back on means "from now on", at the right local time.
  if (on) await pin(routine.agentId, res, routine.when, await agentZone(routine.agentId).catch(() => ''))
}

export async function rescheduleRoutine(routine: Routine, when: When) {
  const zone = await ensureAgentTimezone(routine.agentId)
  const updated = await api.put<RawJob>(job(routine.id, routine.agentId), { updates: { schedule: toSchedule(when) } })
  if (routine.enabled) await pin(routine.agentId, updated, when, zone)
}

export async function renameRoutine(routine: Routine, name: string) {
  await api.put(job(routine.id, routine.agentId), { updates: { name } })
}

export async function deleteRoutine(routine: Routine) {
  await api.delete(job(routine.id, routine.agentId))
}

/** Run a routine right away. Resolves when the run has finished. */
export async function runRoutineNow(routine: Routine) {
  setRunning(routine.id, true)
  try {
    await api.post(job(routine.id, routine.agentId, 'trigger'))
  } catch (err) {
    if (err instanceof HermesError && err.status === 409) return // already running: same outcome
    throw err
  } finally {
    setRunning(routine.id, false)
  }
}

// ── Hooks that keep lists fresh ─────────────────────────────────────────────

export function refreshRoutines(qc: QueryClient, agentId: string) {
  void qc.invalidateQueries({ queryKey: routinesKey(agentId) })
  void qc.invalidateQueries({ queryKey: routineRunsKey(agentId) })
  void qc.invalidateQueries({ queryKey: ['routine-job-runs', agentId] })
}

/** Every change, wired to refresh what it touches, with optimistic toggles and deletes. */
export function useRoutineActions(agentId: string) {
  const qc = useQueryClient()
  const key = routinesKey(agentId)
  const patch = (id: string, change: Partial<Routine> | null) =>
    qc.setQueryData<Routine[]>(key, (list) =>
      change === null ? list?.filter((r) => r.id !== id) : list?.map((r) => (r.id === id ? { ...r, ...change } : r)),
    )
  const settle = () => refreshRoutines(qc, agentId)

  return {
    createFromTemplate: (input: Omit<TemplateInput, 'agentId'>) => createFromTemplate({ ...input, agentId }).finally(settle),
    createCustom: (input: Omit<CustomInput, 'agentId'>) => createCustom({ ...input, agentId }).finally(settle),
    setEnabled: async (routine: Routine, on: boolean) => {
      const before = routine.enabled
      patch(routine.id, { enabled: on, nextAt: on ? routine.nextAt : undefined })
      try {
        await setRoutineEnabled(routine, on)
      } catch (err) {
        patch(routine.id, { enabled: before })
        throw err
      } finally {
        settle()
      }
    },
    reschedule: (routine: Routine, when: When) => {
      patch(routine.id, { when })
      return rescheduleRoutine(routine, when).finally(settle)
    },
    rename: (routine: Routine, name: string) => {
      patch(routine.id, { name })
      return renameRoutine(routine, name).finally(settle)
    },
    remove: async (routine: Routine) => {
      const snapshot = qc.getQueryData<Routine[]>(key)
      patch(routine.id, null)
      try {
        await deleteRoutine(routine)
      } catch (err) {
        qc.setQueryData(key, snapshot)
        throw err
      } finally {
        settle()
      }
    },
    runNow: (routine: Routine) => runRoutineNow(routine).finally(settle),
  }
}
