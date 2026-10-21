// Routines that find something, told as they land. Every run is a chat Hermes
// keeps; when one finishes having something to say (not "nothing to report",
// read the way Hermes reads it before delivering), Murmur shows what it found.
// Runs already there when Murmur starts watching are never told, so nothing is
// stored: what lands while Murmur is closed waits on the agent's page.

import { gateway } from '@/hermes/gateway'
import { listProfileNames } from '@/hermes/compat'
import { api } from '@/hermes/rest'
import { runTitle } from '@/features/routines/runs'
import { fetchRunResult, runOf } from '@/state/routines'
import { isOn, useNotifications } from './notifications'

export type RunRow = { id: string; startedAt: number; finished: boolean; title: string }

/** What's been seen of one agent's runs. */
export type Memory = {
  /** The newest run there when watching began (Hermes's clock): anything newer is new. */
  since: number
  /** Runs seen going, so their finishing counts even though they started before. */
  going: Set<string>
  /** Runs seen finished. */
  done: Set<string>
}

/**
 * Which runs just landed: finished, and either seen going or started since
 * watching began. The first look only remembers. Pure; see routine-runs.test.ts.
 */
export function look(rows: RunRow[], memory?: Memory): { memory: Memory; landed: RunRow[] } {
  if (!memory) {
    return {
      memory: {
        since: Math.max(0, ...rows.map((r) => r.startedAt)),
        going: new Set(rows.filter((r) => !r.finished).map((r) => r.id)),
        done: new Set(rows.filter((r) => r.finished).map((r) => r.id)),
      },
      landed: [],
    }
  }
  const landed: RunRow[] = []
  for (const row of rows) {
    if (!row.finished) {
      memory.going.add(row.id)
      continue
    }
    if (memory.done.has(row.id)) continue
    memory.done.add(row.id)
    if (memory.going.delete(row.id) || row.startedAt > memory.since) landed.push(row)
  }
  return { memory, landed }
}

/** A routine whose results Hermes already sends somewhere else (Telegram), which would say it twice. */
export const deliversElsewhere = (deliver: unknown) => {
  const to = Array.isArray(deliver) ? deliver.join(',') : String(deliver ?? '')
  return to.split(',').some((t) => t.trim() && t.trim() !== 'local')
}

/** A run that landed with something to say. */
export type Found = { agentId: string; runId: string; routine: string; text: string }

type SessionRow = { id: string; title?: string | null; started_at?: number; end_reason?: string | null }
type JobRow = { id: string; name?: string; prompt?: string; deliver?: unknown }

const p = (agentId: string) => `profile=${encodeURIComponent(agentId)}`

/** Hermes says a lot when anything moves, so wait for it to settle. */
const SETTLE_MS = 1500
/** In case a change isn't announced (another agent's runs, a dropped connection). */
const EVERY_MS = 60_000

/**
 * Watches every agent's routine runs while notifications are on, and calls
 * `tell` for each one that lands with a result. Returns the stop.
 */
export function watchRoutineRuns(tell: (found: Found) => void) {
  const memories = new Map<string, Memory>()
  let checking = false
  let again = false

  async function lookAt(agentId: string) {
    // Only Hermes's scheduler makes chats from "cron", so these are all runs.
    const res = await api.get<{ sessions?: SessionRow[] }>(`/api/sessions?${p(agentId)}&source=cron&order=recent&limit=20`)
    const rows = (res.sessions ?? []).map(
      (s): RunRow => ({
        id: s.id,
        startedAt: s.started_at ?? 0,
        finished: Boolean(s.end_reason?.startsWith('cron_')),
        title: s.title ?? '',
      }),
    )
    const { memory, landed } = look(rows, memories.get(agentId))
    memories.set(agentId, memory)
    if (!landed.length) return
    const jobs = await api.get<JobRow[]>(`/api/cron/jobs?${p(agentId)}`).catch(() => [])
    for (const run of landed) {
      const routineId = (await runOf(agentId, run.id))?.routineId
      const job = (Array.isArray(jobs) ? jobs : []).find((j) => j.id === routineId)
      if (job && deliversElsewhere(job.deliver)) continue
      const result = await fetchRunResult(agentId, run.id)
      // Nothing to report, or a run you've replied in (a conversation, which tells you itself).
      if (result.quiet || result.replied || !result.text) continue
      const routine = (job?.name || job?.prompt || runTitle(run.title) || 'Routine').trim()
      tell({ agentId, runId: run.id, routine, text: result.text })
    }
  }

  async function check() {
    if (!isOn()) return void memories.clear()
    if (checking) return void (again = true)
    checking = true
    try {
      const agents = await listProfileNames()
      for (const agentId of agents) await lookAt(agentId).catch(() => {})
    } catch {
      // Hermes is away; the next change or tick looks again.
    } finally {
      checking = false
      if (again) {
        again = false
        void check()
      }
    }
  }

  let settle: ReturnType<typeof setTimeout> | undefined
  const soon = () => {
    clearTimeout(settle)
    settle = setTimeout(check, SETTLE_MS)
  }
  const stops = [
    gateway.onEvent((ev) => (ev.type === 'sessions.changed' || ev.type === 'cron.changed') && soon()),
    gateway.onState((state) => state === 'open' && soon()),
    // Turned on: remember what's there now. Turned off: forget it.
    useNotifications.subscribe((now, before) => isOn(now) !== isOn(before) && void check()),
  ]
  const tick = setInterval(check, EVERY_MS)
  void check()
  return () => {
    clearTimeout(settle)
    clearInterval(tick)
    for (const stop of stops) stop()
  }
}
