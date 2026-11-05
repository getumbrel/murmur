// What a chat's routines found. A routine an agent set up in a chat reports
// there (shared/routines.ts): each run that found something shows in the chat
// as the agent speaking up, at the moment it did, and your next message there
// takes it to the agent. Each run is read once. What they found is kept on the
// routine, with how far its runs have been read, since Hermes lists only a
// routine's newest runs; Murmur's server keeps it too, as runs land. One whose
// newest runs failed says so in the chat once, where the last of them did.

import { useEffect, useMemo, useRef } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { api } from '@/hermes/rest'
import { hearReports } from '@/state/chats'
import { jobRunsQuery, keepFindings, reportHere, routinesKey, useRoutines, type Routine } from '@/state/routines'
import { useAgentTimezone } from '@/state/timezone'
import { relativeDate } from '@/features/routines/schedule'
import type { ChatItem } from '@/features/chat/types'
import { couldntRun, deliversElsewhere, findingIn, type Finding } from '@shared/routines.ts'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

const findingKey = (agentId: string, runId: string) => ['routine-finding', agentId, runId] as const

/** What a run found, read from its start: Hermes's brief, the agent's work, its answer. '' for nothing. */
async function fetchFinding(agentId: string, runId: string) {
  type Row = { role?: string; content?: string | null }
  const res = await api.get<{ messages?: Row[] }>(
    `/api/sessions/${encodeURIComponent(runId)}/messages?profile=${encodeURIComponent(agentId)}&order=oldest&limit=100&inline_images=false`,
  )
  return findingIn(res.messages ?? [])
}

/** One of the chat's routines' runs, kept as a finding or not read yet. */
type Look = { routine: Routine; run: string; at: number; startedAt?: number; kept: boolean }

/**
 * What the routines reporting to a chat found, oldest first: routines noted
 * as reporting to it, and any the agent `made` in it (noted or not yet). Ones
 * from before `from` (older than the history shown) are left out.
 */
export function useChatFindings(agentId: string | undefined, chatId: string | undefined, made: string[], from = 0) {
  const qc = useQueryClient()
  const routines = useRoutines(chatId ? agentId : undefined)
  const madeKey = made.join(',')
  const mine = useMemo(
    () =>
      (routines.data ?? []).filter(
        (r) => r.chat === chatId || (madeKey.split(',').includes(r.id) && !deliversElsewhere(r.deliver)),
      ),
    [routines.data, chatId, madeKey],
  )

  // One the agent just made isn't among the routines yet; one made here before Murmur noted it, is now.
  const asked = useRef(new Set<string>())
  useEffect(() => {
    if (!agentId || !chatId || !routines.data) return
    for (const id of made) {
      if (asked.current.has(id)) continue
      const routine = routines.data.find((r) => r.id === id)
      if (routine && (routine.noted || deliversElsewhere(routine.deliver))) continue
      asked.current.add(id)
      const settle = () => void qc.invalidateQueries({ queryKey: routinesKey(agentId) })
      if (!routine) settle()
      else void reportHere(agentId, id, chatId).then((noted) => noted && settle()).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, chatId, routines.data, madeKey])

  const runs = useQueries({
    queries: mine.map((r) => ({ ...jobRunsQuery(agentId ?? '', r.id), enabled: Boolean(agentId) })),
  })
  // Each routine's kept findings, and its newer runs that haven't been read.
  const looks: Look[] = []
  for (const [i, routine] of mine.entries()) {
    const kept = new Set(routine.findings.map((f) => f.run))
    for (const f of routine.findings) if (f.at >= from) looks.push({ routine, run: f.run, at: f.at, kept: true })
    for (const run of runs[i]?.data ?? []) {
      if (run.running || run.at <= routine.findingsRead || kept.has(run.id)) continue
      looks.push({ routine, run: run.id, at: run.endedAt ?? run.lastAt, startedAt: run.at, kept: false })
    }
  }
  const read = useQueries({
    queries: looks.map((l) => ({
      queryKey: findingKey(agentId ?? '', l.run),
      queryFn: () => fetchFinding(agentId!, l.run),
      staleTime: Infinity,
      enabled: Boolean(agentId),
    })),
  })

  // What newly read runs found goes on the routine, with how far its runs are read.
  const kept = useRef(new Map<string, string>())
  const settled = looks.map((l, i) => `${l.run}:${read[i]?.status}`).join('|')
  useEffect(() => {
    if (!agentId) return
    for (const [i, routine] of mine.entries()) {
      const list = runs[i]?.data
      const fresh = looks.flatMap((l, n) => (l.routine === routine && !l.kept ? [{ l, r: read[n] }] : []))
      // Only once every run read has answered, so none is passed over.
      if (!list || !fresh.length || fresh.some(({ r }) => r?.status !== 'success')) continue
      const found: Finding[] = fresh.flatMap(({ l, r }) => (r?.data ? [{ run: l.run, at: l.at }] : []))
      // Read up to the oldest run still going: it hasn't said yet.
      const going = Math.min(...list.filter((run) => run.running).map((run) => run.at))
      const upTo = Math.max(
        routine.findingsRead,
        ...fresh.flatMap(({ l }) => (l.startedAt! < going ? [l.startedAt!] : [])),
      )
      const key = `${found.map((f) => f.run).join(',')}@${upTo}`
      if (kept.current.get(routine.id) === key) continue
      kept.current.set(routine.id, key)
      void keepFindings(routine, found, upTo).then(
        () => qc.invalidateQueries({ queryKey: routinesKey(agentId) }),
        () => kept.current.delete(routine.id),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, mine, settled])

  const done = looks.map((l, i) => `${l.run}:${read[i]?.data ? 1 : 0}`).join('|')
  const findings = useMemo(() => {
    const out: Of<'finding'>[] = []
    const seen = new Set<string>()
    for (const [i, l] of looks.entries()) {
      const text = read[i]?.data
      if (!text || seen.has(l.run)) continue
      seen.add(l.run)
      out.push({
        kind: 'finding',
        id: l.run,
        routineId: l.routine.id,
        routine: l.routine.name,
        template: l.routine.template,
        at: l.at,
        text,
      })
    }
    // One whose newest runs failed says so, once, where the last of them did.
    for (const r of mine) {
      const f = r.failing
      if (!f?.at || f.at < from) continue
      out.push({
        kind: 'finding',
        id: `failed-${r.id}`,
        routineId: r.id,
        routine: r.name,
        template: r.template,
        at: f.at,
        text: f.why,
        failed: f.times ?? 1,
      })
    }
    return out.sort((a, b) => a.at - b.at)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, mine])

  // Your next message takes along what they've reported since your last one.
  const zone = useAgentTimezone(agentId).data || undefined
  const latest = useRef(findings)
  latest.current = findings
  useEffect(() => {
    if (!chatId) return
    hearReports(chatId, (since) =>
      latest.current
        .filter((f) => f.at > since)
        .map((f) => ({
          routine: f.routine,
          when: relativeDate(f.at, { withTime: true, zone }),
          text: f.failed ? couldntRun(f.text, f.failed) : f.text,
          failed: Boolean(f.failed),
        })),
    )
    return () => hearReports(chatId)
  }, [chatId, zone])

  return findings
}

/**
 * The chat's items with what its routines found, each where it came in: just
 * before the first message (yours, or Hermes waking the agent) after it, so
 * no reply is split. While a reply is going, what's come in since waits for
 * it to finish.
 */
export function placeFindings(items: ChatItem[], findings: Of<'finding'>[], busy: boolean): ChatItem[] {
  if (!findings.length) return items
  const out: ChatItem[] = []
  let next = 0
  for (const item of items) {
    if (item.kind === 'user' || item.kind === 'wake') {
      while (next < findings.length && item.at && findings[next].at < item.at) out.push(findings[next++])
    }
    out.push(item)
  }
  if (!busy) out.push(...findings.slice(next))
  return out
}
