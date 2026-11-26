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

// "[审核]" ("reviewed") isn't the word for silence: it's a label Hermes saw a
// routine drift to as its whole answer, so Hermes holds it back too.
const MARKERS = new Set(['[SILENT]', 'SILENT', 'NO_REPLY', 'NO REPLY', '[静默]', '静默', '[沉默]', '沉默', '[审核]', '审核'])
const BRACKETED = [...MARKERS].filter((m) => m.startsWith('[')).sort()
const MARKER_CAP = 64

// Invisible characters a model can slip into a marker: zero-width spaces, BOMs, bidi marks.
const visible = (text: string) => text.replace(/\p{Cf}/gu, '')
// "[ SILENT ]" is "[SILENT]": only the space just inside the brackets goes.
const unpadded = (text: string) => text.replace(/\[\s+/g, '[').replace(/\s+\]/g, ']')
const canonical = (text: string) => unpadded(visible(text).trim().toUpperCase().split(/\s+/).join(' '))
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

/** The text inside code formatting that wraps all of it: "`[SILENT]`", or a fenced block. */
function unwrapCode(text: string) {
  let t = text.trim()
  if (t.startsWith('```') && t.endsWith('```') && t.length >= 6) {
    const inner = t.slice(3, -3)
    // The fence's first line is its language, if any.
    t = (inner.includes('\n') ? inner.slice(inner.indexOf('\n') + 1) : inner).trim()
  }
  while (t.length >= 2 && t.startsWith('`') && t.endsWith('`')) t = t.replace(/^`+|`+$/g, '').trim()
  return t
}

/** What's inside a code span that opens the text on its line ("`[SILENT]` nothing new"), or the text as it is. */
function openingCode(text: string) {
  const fence = /^`+/.exec(text)?.[0]
  if (!fence) return text
  const close = text.indexOf(fence, fence.length)
  const inside = close === -1 ? '' : text.slice(fence.length, close)
  return close !== -1 && !inside.includes('\n') ? inside.trim() : text
}

/** One letter dropped, added, changed or swapped. */
function withinOneEdit(x: string, y: string) {
  const [a, b] = [[...x], [...y]]
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const diffs = a.flatMap((ch, i) => (ch === b[i] ? [] : [i]))
    const [i, j] = diffs
    return diffs.length <= 1 || (diffs.length === 2 && j === i + 1 && a[i] === b[j] && a[j] === b[i])
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  return long.some((_, i) => [...long.slice(0, i), ...long.slice(i + 1)].join('') === short.join(''))
}

const DAMAGED = /^\[\s*([^\s[\]]*)\s*(\]?)$/u

/**
 * The whole answer is a "[SILENT]" that came out damaged: misspelt by one
 * letter ("[SLENT]"), or cut off ("[SIL", even a lone "["). One bracketed
 * word and nothing else, so "[URGENT]" or "[SLENT] and more" is content.
 */
function isDamagedMarker(text: string) {
  const form = stripEdges(unwrapCode(visible(text).normalize('NFKC').toLowerCase()))
  const shape = [...form].length <= MARKER_CAP ? DAMAGED.exec(form) : null
  if (!shape) return false
  const [, letters, closed] = shape
  return (!closed && 'silent'.startsWith(letters)) || withinOneEdit(letters, 'silent')
}

/**
 * Did the agent decide there was nothing to report? A marker as the whole
 * answer, or on its own first or last line, or "[SILENT]" opening it, even
 * wrapped as code or damaged on the way. One buried mid-sentence is content.
 */
export function isQuiet(answer: string) {
  const text = visible(answer).trim()
  if (!text) return false
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).filter((line) => line.trim())
  const opening = canonical(openingCode(text))
  return (
    BRACKETED.some((m) => opening.startsWith(m)) ||
    isDamagedMarker(text) ||
    [text, lines[0], lines.at(-1)].some((line) => isMarker(line) || isMarker(unwrapCode(line ?? '')))
  )
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

// ── Reporting where it was set up ───────────────────────────────────────────
// Hermes can't deliver to a chat in Murmur: it has no address there, so a
// routine set up in one is only ever saved. Murmur notes that chat on the
// routine and shows each run that found something there, as the agent
// speaking up.

/** A run that found something, by when it ran (ms). */
export type Finding = { run: string; at: number }

/**
 * Murmur's own fields on a routine's job, where it kept its notes up to
 * Hermes 0.23.1. They're still read (see `noted`), and no longer written.
 */
export type Reporting = {
  /** The template it came from. */
  murmur_template?: unknown
  /** The chat it was set up in. */
  murmur_chat?: unknown
  /**
   * Its runs that found something, newest first. Hermes lists only a
   * routine's newest runs, so a busy one's findings would fall out of reach.
   */
  murmur_findings?: unknown
  /** When the newest run read for findings started (ms): none up to then needs reading again. */
  murmur_read?: unknown
}

/** How many findings a routine keeps. */
export const KEPT = 50

/** The chat a routine reports to: the one it was set up in, unless Hermes sends what it finds elsewhere. */
export function reportsTo(job: Reporting & { deliver?: unknown }) {
  const chat = job.murmur_chat
  return typeof chat === 'string' && chat && !deliversElsewhere(job.deliver) ? chat : undefined
}

/** A job's findings, as kept. */
export function findingsOf(job: Reporting): Finding[] {
  const list: unknown[] = Array.isArray(job.murmur_findings) ? job.murmur_findings : []
  return list.filter((f): f is Finding => typeof (f as Finding)?.run === 'string' && typeof (f as Finding)?.at === 'number')
}

/** Findings with more of them: each run once, newest first, the newest few kept. */
export function withFindings(kept: Finding[], found: Finding[]): Finding[] {
  const byRun = new Map<string, Finding>()
  for (const f of [...found, ...kept]) if (!byRun.has(f.run)) byRun.set(f.run, f)
  return [...byRun.values()].sort((a, b) => b.at - a.at).slice(0, KEPT)
}

// ── Murmur's notes on a routine ─────────────────────────────────────────────
// What Murmur notes on an agent's routines is one record the agent keeps (its
// ui_meta, under ROUTINE_NOTES), by routine. From 0.23.2 a job takes only
// Hermes's own fields, so the notes an older Murmur left on one are read
// along with the record, and every new one goes in the record.

/** The agent's record of them. */
export const ROUTINE_NOTES = 'murmur-routines'

/** What Murmur notes on one routine. */
export type RoutineNote = {
  /** The template it came from. */
  template?: string
  /** The chat it was set up in. */
  chat?: string
  /** Its runs that found something, newest first. */
  findings?: Finding[]
  /** When the newest run read for findings started (ms). */
  read?: number
}

/** An agent's notes, by routine. */
export type RoutineNotes = Record<string, RoutineNote>

/**
 * How much the record may hold, as JSON. Hermes caps everything an agent
 * keeps at 64 KB and sends it with every list of agents, so findings past
 * this go, oldest first.
 */
const NOTES_BUDGET = 24_000

const sized = (notes: RoutineNotes) => JSON.stringify(notes).length

/** An agent's notes on its routines, from the record as kept. */
export function routineNotes(kept: unknown): RoutineNotes {
  return kept && typeof kept === 'object' && !Array.isArray(kept) ? (kept as RoutineNotes) : {}
}

/**
 * A job with Murmur's notes on it, as the fields they used to be. Where the
 * job says too (an older Murmur's note), the record does, and the findings
 * are both's.
 */
export function noted<J extends { id: string }>(job: J, notes: RoutineNotes): J & Reporting {
  const note = notes[job.id]
  if (!note) return job
  const old = job as Reporting
  const read = (value: unknown) => (typeof value === 'number' ? value : 0)
  return {
    ...job,
    murmur_template: note.template ?? old.murmur_template,
    murmur_chat: note.chat ?? old.murmur_chat,
    murmur_findings: withFindings(findingsOf({ murmur_findings: note.findings }), findingsOf(old)),
    murmur_read: Math.max(read(note.read), read(old.murmur_read)),
  }
}

/**
 * The notes with one routine's changed. A note left with nothing in it goes,
 * and so do notes on routines that aren't among `live` (the agent's
 * routines, when the caller knows them).
 */
export function withNote(notes: RoutineNotes, id: string, change: (note: RoutineNote) => RoutineNote, live?: string[]): RoutineNotes {
  const next: RoutineNotes = {}
  for (const [key, note] of Object.entries({ ...notes, [id]: change(notes[id] ?? {}) })) {
    if (live && !live.includes(key)) continue
    const kept = Object.fromEntries(Object.entries(note).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)))
    if (Object.keys(kept).length) next[key] = kept
  }
  // Over budget: the oldest finding of any routine goes, until it fits.
  while (sized(next) > NOTES_BUDGET) {
    const oldest = Object.entries(next)
      .filter(([, note]) => note.findings?.length)
      .sort(([, a], [, b]) => a.findings!.at(-1)!.at - b.findings!.at(-1)!.at)[0]
    if (!oldest) break
    const [key, note] = oldest
    const { findings, ...rest } = note
    next[key] = findings!.length > 1 ? { ...rest, findings: findings!.slice(0, -1) } : rest
    if (!Object.keys(next[key]).length) delete next[key]
  }
  return next
}

/** Hermes's scheduler, by the names it's called by: its own, or through tool search's one "tool_call". */
const SCHEDULER = new Set(['cronjob', 'cronjob_manage', 'tool_call'])

/**
 * The routine a call to Hermes's scheduler made, from its answer (the JSON,
 * or that parsed): only making one answers with its id, its schedule and its
 * next run.
 */
export function madeRoutine(tool: string, result: unknown): string | undefined {
  if (!SCHEDULER.has(tool)) return undefined
  let answer = result
  if (typeof result === 'string') {
    try {
      answer = JSON.parse(result)
    } catch {
      // Cut short in history: its opening still says.
      return /^\s*\{\s*"success":\s*true,\s*"job_id":\s*"([\w-]+)"/.exec(result)?.[1]
    }
  }
  const a = answer && typeof answer === 'object' ? (answer as Record<string, unknown>) : {}
  const made = a.success === true && typeof a.job_id === 'string' && a.job_id && 'schedule' in a && 'next_run_at' in a
  return made ? (a.job_id as string) : undefined
}

type Said = { role?: string | null; content?: string | null; display_kind?: string | null; display_metadata?: unknown }

/** The agent's last words in a run, before anyone replied in it. `messages` are oldest first. */
function answerIn<M extends Said>(messages: M[]): M | undefined {
  const brief = messages.findIndex((m) => m.role === 'user' && isRunBrief(m.content ?? ''))
  const reply = messages.findIndex((m, i) => i > brief && m.role === 'user' && m.content?.trim())
  return messages.slice(0, reply < 0 ? undefined : reply).findLast((m) => m.role === 'assistant' && m.content?.trim())
}

const FAILED = '[CRON_FAILURE]'

/**
 * Why a run failed, from its answer: the error Hermes kept with a turn that
 * failed (the model turned it away, say), whose words are Hermes's stock
 * apology, or what the agent said after marking it failed. undefined when it
 * didn't fail.
 */
export function failureOf(answer: Said | undefined): string | undefined {
  if (answer?.display_kind === 'failed_turn') {
    const error = (answer.display_metadata as { error?: unknown } | null | undefined)?.error
    return typeof error === 'string' ? error.trim() : ''
  }
  const text = answer?.content?.trim() ?? ''
  return text.startsWith(FAILED) ? text.slice(FAILED.length).trim() : undefined
}

/** Why a run failed (see failureOf), or undefined. `messages` are oldest first. */
export const failureIn = (messages: Said[]) => failureOf(answerIn(messages))

/**
 * What a run found: the agent's last words before anyone replied in it, or ''
 * when it had nothing to report, or failed. `messages` are oldest first.
 */
export function findingIn(messages: Said[]) {
  const answer = answerIn(messages)
  const text = (answer?.content ?? '').trim()
  return isQuiet(text) || failureOf(answer) !== undefined ? '' : text
}

/** A routine whose newest run failed: when, how many runs in a row (where Hermes says), and why. */
export type Failing = { at: number; times?: number; why: string }

/** Whether a routine's newest run failed, from its job; undefined when it didn't. */
export function failingOf(job: {
  last_status?: unknown
  last_error?: unknown
  last_failure?: unknown
  failure_streak?: unknown
  last_run_at?: unknown
}): Failing | undefined {
  if (job.last_status !== 'error') return undefined
  const last = (job.last_failure && typeof job.last_failure === 'object' ? job.last_failure : {}) as { at?: unknown; detail?: unknown }
  const at = Date.parse(String(last.at ?? job.last_run_at ?? ''))
  const why = typeof last.detail === 'string' && last.detail ? last.detail : typeof job.last_error === 'string' ? job.last_error : ''
  const times = typeof job.failure_streak === 'number' && job.failure_streak > 0 ? job.failure_streak : undefined
  // Python's exception name says nothing to a person.
  return { at: Number.isNaN(at) ? 0 : at, times, why: why.replace(/^\w*(?:Error|Exception):\s*/, '').trim() }
}

/** What failed runs say in a line: that it couldn't run (`times` in a row), and why. */
export function couldntRun(why: string, times = 1) {
  const what = times > 1 ? `Couldn’t run the last ${times} times` : 'Couldn’t run'
  return why ? `${what}: ${why}` : `${what}.`
}

// ── Telling the agent ───────────────────────────────────────────────────────
// A routine's runs are chats of their own, so the agent in the chat they
// report to never saw what they found. Your next message there takes it
// along, after your words, under a mark Murmur leaves out when it shows that
// message again. Once in a chat, it also says how routines report here.

const MARK = '--- From Murmur ---'

/** What Murmur added to a message, up to whatever Hermes added after it. */
export const ALONG = new RegExp(
  `\\n*${MARK}[\\s\\S]*?(?=\\n--- Attached Context ---|\\n--- Context Warnings ---|\\n*Umbrel Runtime Context:|\\n*\\[Image attached at:|$)`,
)

/** The note on how routines report here, in a message as stored. */
export const toldIn = (raw: string) => raw.includes(MARK) && raw.includes(NOTE)

const NOTE =
  "This chat is in Murmur. A routine you schedule from it with deliver='local' reports back here: Murmur shows what each run finds in this chat and lets the person know, and their next message brings it back to you. Use deliver='local' unless they ask for it to go somewhere else."

/** Each finding's words, at most; and how many findings go along at once. */
const ALONG_LIMIT = { text: 4000, findings: 5 }

export type Carried = { routine: string; when: string; text: string; failed?: boolean }

/**
 * What goes along with a message: what routines reported in the chat since
 * the last one (oldest first), and, when `note`, how they report here.
 */
export function along({ found, note = false }: { found: Carried[]; note?: boolean }) {
  if (!found.length && !note) return ''
  const lines = [MARK]
  if (note) lines.push(NOTE)
  const shown = found.slice(-ALONG_LIMIT.findings)
  if (shown.length < found.length) lines.push('', `(${found.length - shown.length} earlier reports left out.)`)
  for (const f of shown) {
    const text = f.text.length > ALONG_LIMIT.text ? `${f.text.slice(0, ALONG_LIMIT.text).trimEnd()}…` : f.text
    const said = f.failed ? `couldn’t run ${f.when}` : `reported in this chat ${f.when}`
    lines.push('', `Your routine “${f.routine}” ${said}:`, text)
  }
  return lines.join('\n')
}

/**
 * Whether a message asks for something later or again, which an agent may
 * schedule: the moment it needs to know how routines report here.
 */
export const soundsScheduled = (text: string) =>
  /\b(?:every|each (?:day|morning|evening|night|week|hour)|daily|nightly|weekly|hourly|monthly|remind|routine|schedul|cron|recurring|watch|monitor|keep an eye|let me know|notify|alert|ping me|tell me (?:when|if)|whenever|check (?:back|again|in on))/i.test(
    text,
  )
