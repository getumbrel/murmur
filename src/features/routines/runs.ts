// Reading a routine's runs the way Hermes does. A run is a chat Hermes keeps
// (`cron_<routine>_<yyyymmdd>_<hhmmss>`); when the agent finds nothing worth
// saying it answers with a silence marker, and Hermes delivers nothing. Murmur
// follows the same rule, so what's quiet here is what never reached Telegram.

/** A run's chat id, and the routine it belongs to. */
export const RUN_ID = /^cron_([0-9a-z]+)_\d{8}_\d{6}$/i

export const isRunId = (id: string | undefined) => !!id && RUN_ID.test(id)
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
export function standingResults<R extends { routineId: string; at: number }>(latest: R[], continued: R[]): R[] {
  return latest.filter((run) => !continued.some((c) => c.routineId === run.routineId && c.at > run.at))
}

/** What a run found, as one line of words. */
export function resultLine(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
