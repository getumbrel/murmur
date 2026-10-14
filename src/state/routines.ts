// Routines: things an agent does on its own, on a schedule. They're Hermes's
// scheduled jobs (per agent), started from Hermes's built-in blueprints or
// from a plain request. Every run is saved as a chat with the agent, kept
// apart from your own chats, so Murmur can show what came of it.
//
// Results are delivered "locally" (saved only), which is what makes them show
// up here; Telegram is offered only when that agent has Telegram connected.

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { api, HermesError } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
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
  messageCount: number
}

export type JobRun = {
  id: string
  at: number
  endedAt?: number
  running: boolean
  messageCount: number
}

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

const RUN_ID = /^cron_([0-9a-z]+)_\d{8}_\d{6}$/i

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
      type Row = { id: string; title?: string; started_at?: number; message_count?: number; source?: string }
      const res = await rpc<{ sessions: Row[] }>('session.list', { profile: agentId, limit: 100 })
      return res.sessions
        .filter((s) => s.source === 'cron' && RUN_ID.test(s.id))
        .map((s) => ({
          id: s.id,
          routineId: RUN_ID.exec(s.id)![1],
          title: (s.title ?? '').replace(/\s+·\s+[A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2}$/, '').trim(),
          at: (s.started_at ?? 0) * 1000,
          messageCount: s.message_count ?? 0,
        }))
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
      type Row = { id: string; started_at?: number; ended_at?: number | null; is_active?: boolean; message_count?: number }
      const res = await api.get<{ runs: Row[] }>(`${job(routineId!, agentId, 'runs')}&limit=20`)
      return (res.runs ?? []).map<JobRun>((r) => ({
        id: r.id,
        at: (r.started_at ?? 0) * 1000,
        endedAt: r.ended_at ? r.ended_at * 1000 : undefined,
        running: Boolean(r.is_active),
        messageCount: r.message_count ?? 0,
      }))
    },
    staleTime: 10_000,
  })
}

/** What the agent said at the end of a run. */
export function useRunResult(agentId: string, runId: string | undefined) {
  return useQuery({
    queryKey: ['routine-run-result', agentId, runId],
    enabled: Boolean(runId),
    queryFn: async () => {
      type Row = { id?: number; timestamp?: number; role?: string; content?: string | null }
      const res = await api.get<{ messages?: Row[] }>(
        `/api/sessions/${encodeURIComponent(runId!)}/messages?${p(agentId)}&order=latest&limit=20`,
      )
      const said = (res.messages ?? [])
        .filter((r) => r.role === 'assistant' && r.content?.trim())
        .sort((a, b) => (a.timestamp ?? a.id ?? 0) - (b.timestamp ?? b.id ?? 0))
      return (said.at(-1)?.content ?? '').trim().replace(/^\[SILENT\]\s*/i, '')
    },
    staleTime: Infinity,
  })
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
