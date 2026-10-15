// How much of a plan is left, and when a service that hit its limit is back.
// Hermes keeps both in /api/model/options (hermes_cli/inventory.py), read from
// its own cache so the list never waits on them: a provider row carries
// `usage` (each window's % spent and when it resets) and, while it's rate
// limited, `limit` (the whole account, or just some of its models).

export type PlanWindow = {
  /** Hermes' label, e.g. "Weekly" or "Session". */
  label: string
  /** Percent remaining, 0–100. */
  left: number
  resetsAt?: Date
}
export type PlanUsage = { windows: PlanWindow[] }

type Window = { label?: unknown; used_percent?: unknown; resets_at?: unknown; scope?: unknown }
type Account = { windows?: unknown; state?: unknown }

const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

const dateOf = (v: unknown) => {
  if (typeof v !== 'string' || !v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** The windows that cap the whole account (a model family's own weekly cap doesn't). */
function windowsOf(raw: unknown): PlanWindow[] {
  if (!Array.isArray(raw)) return []
  return (raw as Window[])
    .filter((w) => w && typeof w.used_percent === 'number' && w.scope !== 'model')
    .map((w) => ({
      label: typeof w.label === 'string' ? w.label : '',
      left: Math.round(Math.max(0, Math.min(100, 100 - (w.used_percent as number)))),
      resetsAt: dateOf(w.resets_at),
    }))
}

const tightest = (windows: PlanWindow[]) => Math.min(...windows.map((w) => w.left))

/**
 * A provider row's `usage`, as what's left. With several accounts signed in,
 * Hermes moves between them, so the one with the most room is the honest answer.
 * Null when Hermes has nothing to say (yet).
 */
export function planUsage(usage: unknown): PlanUsage | null {
  const u = record(usage)
  if (!u) return null
  const own = windowsOf(u.windows)
  if (own.length) return { windows: own }
  if (!Array.isArray(u.accounts)) return null
  const best = (u.accounts as Account[])
    .filter((a) => a?.state !== 'unavailable')
    .map((a) => windowsOf(a.windows))
    .filter((w) => w.length)
    .sort((a, b) => tightest(b) - tightest(a))[0]
  return best ? { windows: best } : null
}

/**
 * When a service (or, given `model`, one of its models) is back after hitting
 * its limit. Undefined when it isn't resting, or that time has passed.
 */
export function restingUntil(limit: unknown, model?: string, now = Date.now()): Date | undefined {
  const l = record(limit)
  if (!l) return undefined
  const at =
    l.scope === 'account'
      ? dateOf(l.resets_at)
      : l.scope === 'models' && model
        ? dateOf(record(l.models)?.[model])
        : undefined
  return at && at.getTime() > now ? at : undefined
}

const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const time = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined })

/** "5 PM", "9 AM tomorrow", "Tue", "Oct 20": when something comes back, as briefly as it can be said. */
export function untilText(at: Date, now = new Date()) {
  const days = Math.round((day(at) - day(now)) / 86_400_000)
  if (days <= 0) return time(at)
  if (days === 1) return `${time(at)} tomorrow`
  if (days <= 6) return at.toLocaleDateString(undefined, { weekday: 'short' })
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * "Plenty left this week · resets Tue", "12% left · resets 5 PM" (the gauge turns warm).
 * Also in parts, so a narrow row can drop the scope ("this week").
 */
export function planUsageLine(usage: PlanUsage, now = new Date()) {
  // The tightest window is the one that matters.
  const w = usage.windows.reduce((a, b) => (b.left < a.left ? b : a))
  const scope = /week/i.test(w.label)
    ? 'this week'
    : /month/i.test(w.label)
      ? 'this month'
      : /day/i.test(w.label)
        ? 'today'
        : ''
  const low = w.left < 20
  const lead =
    w.left === 0 ? 'All used' : low ? `${w.left}% left` : w.left >= 50 ? 'Plenty left' : `${w.left}% left`
  const reset = w.resetsAt ? resetText(w.resetsAt, now) : ''
  const parts = { lead, scope: low ? '' : scope, reset }
  const text = [[parts.lead, parts.scope].filter(Boolean).join(' '), reset].filter(Boolean).join(' · ')
  return { text, low, left: w.left, parts }
}

function resetText(at: Date, now: Date) {
  const ms = at.getTime() - now.getTime()
  if (ms < 60 * 60_000) return `resets in ${Math.max(1, Math.round(ms / 60_000))} min`
  const days = Math.round((day(at) - day(now)) / 86_400_000)
  if (days === 0) return `resets ${time(at)}`
  if (days === 1) return 'resets tomorrow'
  if (days <= 7) return `resets ${at.toLocaleDateString(undefined, { weekday: 'short' })}`
  return `resets ${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

// ── Hermes before 0.22 ──────────────────────────────────────────────────────
// Its services don't carry `usage`; the plan only shows in session.usage's
// account lines, as text.

// "Weekly: 96% remaining (4% used) • resets in 6d 15h (2026-10-20 05:01 UTC)"
const LINE = /^(.+?): (\d+)% remaining.*?resets in (.+?) \(/

/** The ChatGPT plan from session.usage's account_lines; null when nothing in them reads as one. */
export function planFromAccountLines(lines: unknown, now = Date.now()): PlanUsage | null {
  if (!Array.isArray(lines)) return null
  const windows: PlanWindow[] = []
  for (const line of lines) {
    if (typeof line !== 'string') continue
    // Only the ChatGPT plan (the main agent may be thinking with something else).
    const provider = /^Provider: (\S+)/.exec(line)?.[1]
    if (provider && provider !== 'openai-codex') return null
    const m = LINE.exec(line)
    if (!m) continue
    // The relative part is timezone-proof; the stamp is in the container's zone.
    const n = (unit: string) => Number(new RegExp(`(\\d+)${unit}`).exec(m[3])?.[1] ?? 0)
    const ms = ((n('d') * 24 + n('h')) * 60 + n('m')) * 60_000
    windows.push({
      label: m[1].trim(),
      left: Math.max(0, Math.min(100, Number(m[2]))),
      resetsAt: ms ? new Date(now + ms) : undefined,
    })
  }
  return windows.length ? { windows } : null
}

/** A Hermes older than 0.22, from /api/status's version ("0.21.5"). */
export function reportsPlanAsText(version: string | undefined) {
  const [major, minor] = (version ?? '').split('.').map(Number)
  return Number.isFinite(minor) && major === 0 && minor < 22
}
