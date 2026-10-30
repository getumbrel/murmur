// Reading a routine's runs the way Hermes does. A run is a chat Hermes keeps;
// when the agent finds nothing worth saying it answers with a silence marker,
// and Hermes delivers nothing. Murmur follows the same rule, so what's quiet
// here is what never reached Telegram.

import { plainLine } from './message.ts'

/**
 * A run's chat id up to Hermes 0.22.2 (`cron_<routine>_<yyyymmdd>_<hhmmss>`),
 * which names the routine it belongs to. From 0.22.3 a run is named for its
 * own execution (`local-…`), and only Hermes can say whose it is (`runOf`).
 */
const RUN_ID = /^cron_([0-9a-z]+)_\d{8}_\d{6}$/i

/** The routine a run belongs to, when its id says so. */
export const routineIdOf = (runId: string) => RUN_ID.exec(runId)?.[1]

/** Hermes titles a run "<routine> · Oct 19 08:00", plus " #2" when that's taken. */
export const runTitle = (title: string) =>
  title.replace(/\s+·\s+[A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2}(?:\s+#\d+)?$/, '').trim()

/** Hermes's instructions to the agent, which open every run as its first message. */
export const isRunBrief = (text: string) => text.includes('You are running as a scheduled cron job')

// ── Silence ─────────────────────────────────────────────────────────────────
// A port of Hermes's `gateway/response_filters.is_autonomous_silence_response`.

const MARKERS = new Set(['[SILENT]', 'SILENT', 'NO_REPLY', 'NO REPLY', '[静默]', '静默', '[沉默]', '沉默'])
const BRACKETED = [...MARKERS].filter((m) => m.startsWith('[')).sort()
const MARKER_CAP = 64

const canonical = (text: string) => text.trim().toUpperCase().split(/\s+/).join(' ')
// Square brackets stay, so a malformed "[SILENT" can't become "SILENT".
const edge = (ch: string) => ch !== '[' && ch !== ']' && /\p{P}/u.test(ch)

function stripEdges(text: string) {
  const chars = [...text]
  let start = 0
  let end = chars.length
  while (start < end && edge(chars[start])) start++
  while (end > start && edge(chars[end - 1])) end--
  return chars.slice(start, end).join('').trim()
}

/** Exactly a marker, give or take stray punctuation ("*NO_REPLY*"). */
function isMarker(text: string | undefined) {
  const stripped = text?.trim() ?? ''
  if (!stripped || [...stripped].length > MARKER_CAP) return false
  const bare = stripEdges(stripped)
  return (bare === stripped ? [stripped] : [stripped, bare]).some((form) => MARKERS.has(canonical(form)))
}

/**
 * Did the agent decide there was nothing to report? A marker as the whole
 * answer, or on its own first or last line, or "[SILENT]" opening it. One
 * buried mid-sentence is content.
 */
export function isQuiet(answer: string) {
  const text = answer.trim()
  if (!text) return false
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  return BRACKETED.some((m) => text.toUpperCase().startsWith(m)) || [text, lines[0], lines.at(-1)].some(isMarker)
}

/**
 * The same, for a one-line excerpt (Hermes's roster preview flattens line
 * breaks), where a marker that ended the answer on its own line ends the line.
 */
export function isQuietExcerpt(excerpt: string) {
  const text = excerpt.trim()
  return isQuiet(text) || BRACKETED.some((m) => text.toUpperCase().endsWith(` ${m}`))
}

// ── Folding ─────────────────────────────────────────────────────────────────

export type RunGroup<R> = { kind: 'run'; run: R } | { kind: 'quiet'; runs: R[] }

/** Back-to-back quiet runs, newest first, become one group; every other run stands alone. */
export function foldQuiet<R>(runs: R[], quiet: (run: R) => boolean): RunGroup<R>[] {
  const out: RunGroup<R>[] = []
  for (const run of runs) {
    const last = out.at(-1)
    if (!quiet(run)) out.push({ kind: 'run', run })
    else if (last?.kind === 'quiet') last.runs.push(run)
    else out.push({ kind: 'quiet', runs: [run] })
  }
  return out
}

// ── Among the chats ─────────────────────────────────────────────────────────

/**
 * Which routines' newest results stand among the chats: one line per routine,
 * unless you've since replied in a newer run of it, which stands for it there.
 */
export function standingResults<R extends { routineId?: string; at: number }>(latest: R[], continued: R[]): R[] {
  return latest.filter((run) => !continued.some((c) => c.routineId === run.routineId && c.at > run.at))
}

/**
 * What a run found, as one line of words. Shown under the routine's `name`,
 * a lead that only says the name again ("## Morning brief") goes.
 */
export function resultLine(markdown: string, name?: string) {
  return plainLine(name?.trim() ? markdown.replace(saysName(name), '') : markdown)
}

/**
 * The name alone on the first line, or, in a preview Hermes ran onto one
 * line, marked as a heading or bold with more markup straight after it.
 */
function saysName(name: string) {
  const n = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const alone = `(?:#{1,6}[^\\S\\n]+)?(?:\\*\\*|__)?${n}(?:\\*\\*|__)?[^\\S\\n]*(?:\\n|$)`
  const marked = `(?:#{1,6}[^\\S\\n]+${n}|\\*\\*${n}\\*\\*|__${n}__)(?=\\s+(?:[#*_>|\`-]|\\d+\\.))`
  return new RegExp(`^\\s*(?:${alone}|${marked})`, 'i')
}

// ── Landing ─────────────────────────────────────────────────────────────────
// Runs that finish with something to say are told as they land (server/watch.ts).

export type RunRow = { id: string; startedAt: number; finished: boolean; title: string }

/** What's been seen of one agent's runs. */
export type Memory = {
  /** Hermes's clock: a run started after this is new. */
  since: number
  /** Runs seen going, so their finishing counts even though they started before. */
  going: Set<string>
  /** Runs seen finished, with when they started. */
  done: Map<string, number>
}

/**
 * Which runs just landed: finished, and either seen going or started since
 * watching began. The first look only remembers. `rows` are the newest few.
 */
export function look<R extends RunRow>(rows: R[], memory?: Memory): { memory: Memory; landed: R[] } {
  if (!memory) {
    return {
      memory: {
        since: Math.max(0, ...rows.map((r) => r.startedAt)),
        going: new Set(rows.filter((r) => !r.finished).map((r) => r.id)),
        done: new Map(rows.filter((r) => r.finished).map((r) => [r.id, r.startedAt])),
      },
      landed: [],
    }
  }
  const landed: R[] = []
  for (const row of rows) {
    if (!row.finished) {
      memory.going.add(row.id)
      continue
    }
    if (memory.done.has(row.id)) continue
    memory.done.set(row.id, row.startedAt)
    if (memory.going.delete(row.id) || row.startedAt > memory.since) landed.push(row)
  }
  // Runs that have left the newest few are let go, and so is anything as old.
  const here = new Set(rows.map((r) => r.id))
  for (const id of memory.going) if (!here.has(id)) memory.going.delete(id)
  for (const [id, startedAt] of memory.done) {
    if (here.has(id)) continue
    memory.done.delete(id)
    memory.since = Math.max(memory.since, startedAt)
  }
  return { memory, landed }
}

/** A routine whose results Hermes already sends somewhere else (Telegram), which would say it twice. */
export const deliversElsewhere = (deliver: unknown) => {
  const to = Array.isArray(deliver) ? deliver.join(',') : String(deliver ?? '')
  return to.split(',').some((t) => t.trim() && t.trim() !== 'local')
}
