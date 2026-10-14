// Routines in human terms. Hermes stores a schedule as a cron line, an
// interval, or a one-off instant; Murmur only ever speaks in times and days.

/** 0 = Sunday … 6 = Saturday, like cron. */
export type Days = number[]

export type When =
  /** At a time of day, on some days of the week. */
  | { kind: 'time'; hour: number; minute: number; days: Days }
  /** Every so often, optionally only between two hours / on some days. */
  | { kind: 'every'; minutes: number; from?: number; to?: number; days?: Days }
  /** Just once. */
  | { kind: 'once'; at: number }

export const EVERY_DAY: Days = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAYS: Days = [1, 2, 3, 4, 5]
export const WEEKENDS: Days = [0, 6]

export type RawSchedule = { kind?: string; expr?: string; minutes?: number; run_at?: string; display?: string }

const same = (a: Days, b: Days) => a.length === b.length && a.every((d, i) => d === b[i])
const norm = (days: Days) => [...new Set(days.map((d) => ((d % 7) + 7) % 7))].sort((a, b) => a - b)

export function dayPreset(days: Days): 'everyday' | 'weekdays' | 'weekends' | null {
  const d = norm(days)
  if (same(d, EVERY_DAY)) return 'everyday'
  if (same(d, WEEKDAYS)) return 'weekdays'
  if (same(d, WEEKENDS)) return 'weekends'
  return null
}

// ── Reading Hermes's schedules ──────────────────────────────────────────────

function parseDow(field: string): Days | null {
  if (field === '*' || field === '?') return EVERY_DAY
  const out: number[] = []
  for (const part of field.split(',')) {
    const m = /^(\d)(?:-(\d))?$/.exec(part)
    if (!m) return null
    const a = Number(m[1])
    const b = m[2] === undefined ? a : Number(m[2])
    for (let d = a; d <= b; d++) out.push(d % 7)
  }
  return out.length ? norm(out) : null
}

const int = (s: string) => (/^\d+$/.test(s) ? Number(s) : null)

export function parseSchedule(s: RawSchedule | undefined): When | null {
  if (!s) return null
  if (s.kind === 'interval' && s.minutes) return { kind: 'every', minutes: s.minutes }
  if (s.kind === 'once' && s.run_at) {
    const at = Date.parse(s.run_at)
    return Number.isNaN(at) ? null : { kind: 'once', at }
  }
  if (s.kind !== 'cron' || !s.expr) return null
  const parts = s.expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [m, h, dom, mon, dow] = parts
  if (dom !== '*' || mon !== '*') return null
  const days = parseDow(dow)
  if (!days) return null
  const minute = int(m)
  const hour = int(h)
  if (minute !== null && hour !== null) return { kind: 'time', hour, minute, days }
  // */30 * * * *
  const everyMin = /^\*\/(\d+)$/.exec(m)
  if (everyMin && h === '*') return { kind: 'every', minutes: Number(everyMin[1]), days }
  // 0 */3 * * *   ·   0 9-17/2 * * 1-5   ·   0 9-17 * * *
  const hours = /^(?:\*|(\d+)-(\d+))(?:\/(\d+))?$/.exec(h)
  if (minute !== null && hours && (hours[3] || hours[1])) {
    return {
      kind: 'every',
      minutes: Number(hours[3] ?? 1) * 60,
      from: hours[1] ? Number(hours[1]) : undefined,
      to: hours[2] ? Number(hours[2]) : undefined,
      days,
    }
  }
  return null
}

// ── Writing them ────────────────────────────────────────────────────────────

function dowExpr(days: Days) {
  const d = norm(days)
  if (!d.length || same(d, EVERY_DAY)) return '*'
  if (same(d, WEEKDAYS)) return '1-5'
  return d.join(',')
}

const pad = (n: number) => String(n).padStart(2, '0')

/** An ISO instant with this browser's offset, e.g. 2026-10-20T09:00:00+07:00. */
export function localIso(ms: number) {
  const d = new Date(ms)
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/** The schedule string Hermes accepts for a `When`. */
export function toSchedule(when: When): string {
  switch (when.kind) {
    case 'time':
      return `${when.minute} ${when.hour} * * ${dowExpr(when.days)}`
    case 'every':
      if (when.from !== undefined && when.to !== undefined) {
        return `0 ${when.from}-${when.to}/${Math.max(1, Math.round(when.minutes / 60))} * * ${dowExpr(when.days ?? EVERY_DAY)}`
      }
      return when.minutes % 60 === 0 ? `every ${when.minutes / 60}h` : `every ${when.minutes}m`
    case 'once':
      return localIso(when.at)
  }
}

export const hhmm = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`

// ── Timezones ───────────────────────────────────────────────────────────────

const partsCache = new Map<string, Intl.DateTimeFormat>()

function zoneParts(ms: number, zone: string) {
  let f = partsCache.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    })
    partsCache.set(zone, f)
  }
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd }
}

/** The instant a wall-clock time happens in `zone`. */
function zonedInstant(y: number, mo: number, d: number, h: number, mi: number, zone: string) {
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  let guess = wall
  for (let i = 0; i < 3; i++) {
    const p = zoneParts(guess, zone)
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)
    guess += wall - seen
  }
  return guess
}

/** When a time-of-day routine next fires, on the wall clock of `zone`. */
export function nextOccurrence(when: Extract<When, { kind: 'time' }>, zone: string, now = Date.now()): number | null {
  let tz = zone
  try {
    zoneParts(now, tz)
  } catch {
    tz = 'UTC'
  }
  const days = norm(when.days.length ? when.days : EVERY_DAY)
  const today = zoneParts(now, tz)
  for (let i = 0; i < 9; i++) {
    const base = new Date(Date.UTC(today.y, today.mo - 1, today.d + i))
    if (!days.includes(base.getUTCDay())) continue
    const at = zonedInstant(
      base.getUTCFullYear(),
      base.getUTCMonth() + 1,
      base.getUTCDate(),
      when.hour,
      when.minute,
      tz,
    )
    if (at > now) return at
  }
  return null
}

/** An ISO instant written on `zone`'s wall clock, the way Hermes stores its own. */
export function isoInZone(at: number, zone: string): string {
  try {
    const p = zoneParts(at, zone)
    const wall = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)
    const off = Math.round((wall - (at - (at % 60_000))) / 60_000)
    const sign = off >= 0 ? '+' : '-'
    const abs = Math.abs(off)
    return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  } catch {
    return new Date(at).toISOString()
  }
}

/** Does the instant `at` fall on this routine's wall-clock time (and day) in `zone`? */
export function landsAt(at: number, when: Extract<When, { kind: 'time' }>, zone: string): boolean {
  try {
    const p = zoneParts(at, zone)
    const days = when.days.length ? norm(when.days) : EVERY_DAY
    return p.h === when.hour && p.mi === when.minute && days.includes(p.wd)
  } catch {
    return true // unknown zone: nothing to judge by
  }
}

// ── Saying them ─────────────────────────────────────────────────────────────

export function formatTime(hour: number, minute: number) {
  return new Date(2000, 0, 3, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "Mon", "Monday" or "M" in this browser's language. 2000-01-02 was a Sunday. */
export function weekdayName(day: number, width: 'long' | 'short' | 'narrow' = 'short') {
  return new Date(2000, 0, 2 + day).toLocaleDateString(undefined, { weekday: width })
}

function listOf(items: string[]) {
  try {
    return new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

/** "Every day", "Weekdays", "Mondays", "Mon, Wed and Fri". */
export function describeDays(days: Days) {
  const preset = dayPreset(days)
  if (preset === 'everyday') return 'Every day'
  if (preset === 'weekdays') return 'Weekdays'
  if (preset === 'weekends') return 'Weekends'
  const d = norm(days)
  if (d.length === 1) return `${weekdayName(d[0], 'long')}s`
  // Monday-first reads naturally for lists like "Mon, Wed and Fri".
  const ordered = [...d.filter((x) => x !== 0), ...d.filter((x) => x === 0)]
  return listOf(ordered.map((x) => weekdayName(x, 'short')))
}

function describeEvery(minutes: number) {
  if (minutes < 60) return minutes === 1 ? 'Every minute' : `Every ${minutes} minutes`
  const h = minutes / 60
  if (h === 1) return 'Every hour'
  if (Number.isInteger(h)) return `Every ${h} hours`
  return `Every ${minutes} minutes`
}

/** "Every day at 8:00 AM", "Weekdays at 9:00", "Every 2 hours", "Once, Tue 20 Oct at 9:00". */
export function describeWhen(when: When | null, fallback = 'On a schedule', zone?: string): string {
  if (!when) return fallback
  switch (when.kind) {
    case 'time':
      return `${describeDays(when.days)} at ${formatTime(when.hour, when.minute)}`
    case 'every': {
      let s = describeEvery(when.minutes)
      if (when.from !== undefined && when.to !== undefined)
        s += `, ${formatTime(when.from, 0)}–${formatTime(when.to, 0)}`
      const days = when.days && dayPreset(when.days) !== 'everyday' ? describeDays(when.days) : ''
      return days ? `${s} · ${days.toLowerCase().startsWith('week') ? days.toLowerCase() : days}` : s
    }
    case 'once':
      return `Once, ${relativeDate(when.at, { withTime: true, zone })}`
  }
}

/** Days since the epoch on `zone`'s calendar (this browser's when none). */
function dayNumber(ms: number, zone?: string) {
  if (zone) {
    try {
      const p = zoneParts(ms, zone)
      return Date.UTC(p.y, p.mo - 1, p.d) / 86_400_000
    } catch {
      // Unknown zone: this browser's calendar.
    }
  }
  const d = new Date(ms)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000
}

/** Formatting options on `zone`'s clock, when it's a zone this browser knows. */
function onClock(zone?: string): { timeZone?: string } {
  if (!zone) return {}
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone })
    return { timeZone: zone }
  } catch {
    return {}
  }
}

/**
 * "today", "tomorrow", "Monday", "20 Oct" — optionally with "at 8:00 AM".
 * With `zone`, on that zone's calendar and clock instead of this browser's.
 */
export function relativeDate(
  ms: number,
  { withTime = false, now = Date.now(), zone }: { withTime?: boolean; now?: number; zone?: string } = {},
) {
  const tz = onClock(zone)
  const days = dayNumber(ms, tz.timeZone) - dayNumber(now, tz.timeZone)
  const date = new Date(ms)
  const year = (t: number) => new Intl.DateTimeFormat('en', { year: 'numeric', ...tz }).format(t)
  let day: string
  if (days === 0) day = 'today'
  else if (days === 1) day = 'tomorrow'
  else if (days === -1) day = 'yesterday'
  else if (days > 1 && days < 7) day = date.toLocaleDateString(undefined, { weekday: 'long', ...tz })
  else
    day = date.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: year(ms) === year(now) ? undefined : 'numeric',
      ...tz,
    })
  return withTime
    ? `${day} at ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', ...tz })}`
    : day
}

/**
 * "Berlin" when `zone` keeps a different time from this browser at `at`, so
 * a time on its clock can say whose clock it is. '' when they agree.
 */
export function zoneLabel(zone: string | undefined, at = Date.now()) {
  if (!zone) return ''
  try {
    const p = zoneParts(at, zone)
    const d = new Date(at)
    if (p.h === d.getHours() && p.mi === d.getMinutes() && p.d === d.getDate()) return ''
  } catch {
    return ''
  }
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
}

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** A short "Next: …" for a row: just the day when the time is already said. */
export function describeNext(when: When | null, nextAt: number | undefined, now = Date.now(), zone?: string) {
  if (!nextAt) return ''
  if (when?.kind === 'time') return relativeDate(nextAt, { now, zone })
  if (when?.kind === 'once') return ''
  const sameDay = dayNumber(nextAt, onClock(zone).timeZone) === dayNumber(now, onClock(zone).timeZone)
  // Later today: just the time ("Next: 4:30 PM").
  return sameDay
    ? new Date(nextAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', ...onClock(zone) })
    : relativeDate(nextAt, { withTime: true, now, zone })
}

/** First day of the week for this browser's region (0 = Sunday, 1 = Monday). */
export function firstDayOfWeek(): number {
  try {
    const loc = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    const info = loc.getWeekInfo?.() ?? loc.weekInfo
    if (info?.firstDay) return info.firstDay % 7
  } catch {
    // Older engines: fall through.
  }
  return /-(US|CA|MX|BR|JP|IL|PH|KR|TW|HK|IN|ZA)$/i.test(navigator.language) ? 0 : 1
}

/** Does this browser tell time on a 12-hour clock? */
export function uses12Hour() {
  try {
    return (
      new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle?.startsWith('h1') ?? false
    )
  } catch {
    return false
  }
}
