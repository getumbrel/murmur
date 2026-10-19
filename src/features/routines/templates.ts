// Hermes ships a catalog of routine blueprints. Murmur shows them with its own
// short, human copy and one of its own icons, in an order that starts with the everyday
// ones. Blueprints Hermes adds later still show up, with Hermes's words.

import type { ComponentType } from 'react'
import {
  BellIcon,
  BookIcon,
  BriefcaseIcon,
  GlassIcon,
  HeartIcon,
  HourglassIcon,
  MailIcon,
  MoonIcon,
  NewsIcon,
  OnceIcon,
  PotIcon,
  ReceiptIcon,
  RoutinesIcon,
  SproutIcon,
  SunriseIcon,
  TagIcon,
  WatchIcon,
  WeekIcon,
  type IconProps,
} from '@/ui/icons'
import type { Blueprint, BlueprintField } from '@/state/routines'

/** One of Murmur's own icons (src/ui/icons.tsx), shown on the agent's lit chip. */
export type RoutineIcon = ComponentType<IconProps>

type Copy = { title: string; description: string; icon: RoutineIcon; name?: (v: Record<string, string>) => string }

const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s).replace(/[.\s]+$/, '')

const COPY: Record<string, Copy> = {
  'morning-brief': { title: 'Morning briefing', description: 'Weather, plans and anything urgent.', icon: SunriseIcon },
  'custom-reminder': {
    title: 'Reminder',
    description: 'A nudge, in your own words.',
    icon: BellIcon,
    name: (v) => sentence(v.what ?? '') || 'Reminder',
  },
  'news-digest': {
    title: 'News on a topic',
    description: 'Only what’s new on a topic you follow.',
    icon: NewsIcon,
    name: (v) => (v.topic ? `${sentence(v.topic)} news` : 'News digest'),
  },
  'evening-winddown': {
    title: 'Evening wind-down',
    description: 'Tomorrow at a glance, and what to prep.',
    icon: MoonIcon,
  },
  'workday-start': { title: 'Workday start', description: 'Your agenda and top priorities.', icon: BriefcaseIcon },
  'weekly-review': {
    title: 'Weekly review',
    description: 'What’s done, what’s open, what’s next.',
    icon: WeekIcon,
  },
  'learn-daily': {
    title: 'Learn something',
    description: 'A small lesson every day.',
    icon: BookIcon,
    name: (v) => (v.topic ? `Learn ${v.topic}` : 'Daily lesson'),
  },
  'habit-checkin': {
    title: 'Habit check-in',
    description: 'A gentle nudge to keep a habit going.',
    icon: SproutIcon,
    name: (v) => sentence(v.habit ?? '') || 'Habit check-in',
  },
  'on-this-day': { title: 'On this day', description: 'A bit of history, a word or a fact.', icon: HourglassIcon },
  'gratitude-journal': { title: 'Gratitude', description: 'An evening moment for what went well.', icon: HeartIcon },
  'meal-plan': { title: 'Weekly meal plan', description: 'Meals for the week and a grocery list.', icon: PotIcon },
  'hydration-move': {
    title: 'Water and stretch',
    description: 'Drink water and move, during the day.',
    icon: GlassIcon,
  },
  'bill-renewal-watch': {
    title: 'Bills and renewals',
    description: 'A heads-up before something is due.',
    icon: ReceiptIcon,
    name: (v) => sentence(v.what ?? '') || 'Bills and renewals',
  },
  'price-watch': {
    title: 'Price watch',
    description: 'Know when a price drops.',
    icon: TagIcon,
    name: (v) => (v.item ? `Watch ${v.item}` : 'Price watch'),
  },
  'important-mail': { title: 'Important email', description: 'Only the mail that needs you.', icon: MailIcon },
  'competitor-watch': {
    title: 'Company news',
    description: 'Launches, pricing and funding news for companies you follow.',
    icon: WatchIcon,
  },
}

/** Shown in this order; anything else Hermes offers follows. */
const ORDER = [
  'morning-brief',
  'custom-reminder',
  'news-digest',
  'evening-winddown',
  'workday-start',
  'weekly-review',
  'learn-daily',
  'habit-checkin',
  'on-this-day',
  'gratitude-journal',
  'meal-plan',
  'hydration-move',
  'bill-renewal-watch',
  'price-watch',
]

/** Need an email account connected, or are for businesses: not for a first glance. */
const HIDDEN = new Set(['important-mail', 'competitor-watch'])

/** Defaults that are really instructions, shown as a placeholder instead. */
const HINT_ONLY = new Set(['price-watch:item', 'competitor-watch:companies'])

export type Template = {
  key: string
  title: string
  description: string
  icon: RoutineIcon
  blueprint: Blueprint
  /** Has a time of day (and maybe days) to pick. */
  timed: boolean
  /** Days: free choice, one weekday, or fixed by the blueprint. */
  days: 'any' | 'one' | 'fixed'
  /** The rest of the form. */
  fields: BlueprintField[]
  nameFor: (values: Record<string, string>) => string
}

const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

export function toTemplate(b: Blueprint): Template {
  const copy = COPY[b.key]
  const timed = b.fields.some((f) => f.type === 'time')
  const days = b.fields.some((f) => f.type === 'weekdays')
    ? 'any'
    : b.fields.some((f) => f.name === 'day')
      ? 'one'
      : 'fixed'
  return {
    key: b.key,
    title: copy?.title ?? b.title,
    description: copy?.description ?? b.description,
    icon: copy?.icon ?? RoutinesIcon,
    blueprint: b,
    timed,
    days,
    fields: b.fields.filter(
      (f) => f.name !== 'deliver' && f.type !== 'time' && f.type !== 'weekdays' && f.name !== 'day',
    ),
    nameFor: (v) => clip(copy?.name?.(v) ?? copy?.title ?? b.title),
  }
}

export function curate(blueprints: Blueprint[]): Template[] {
  const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length)
  return blueprints
    .filter((b) => !HIDDEN.has(b.key))
    .sort((a, b) => rank(a.key) - rank(b.key))
    .map(toTemplate)
}

/** A gallery tile: all it takes to show a template. */
export type Tile = Pick<Template, 'key' | 'title' | 'description' | 'icon'>

/**
 * What the gallery shows: Murmur's own picks straight away, then Hermes's
 * catalog once it's in (same keys, so nothing already shown moves).
 */
export function tiles(blueprints: Blueprint[] | undefined, failed = false): Tile[] {
  if (blueprints) return curate(blueprints)
  return failed ? [] : ORDER.map((key) => ({ key, ...COPY[key] }))
}

/** A template's own words before its blueprint arrives. */
export const tileFor = (key: string): Tile | undefined => (COPY[key] ? { key, ...COPY[key] } : undefined)

export const isHintOnly = (template: string, field: string) => HINT_ONLY.has(`${template}:${field}`)

/** The icon for an existing routine. One in your own words wears the routine clock. */
export function iconFor(template: string | undefined, name: string): RoutineIcon {
  if (template && COPY[template]) return COPY[template].icon
  if (template === 'custom-once') return OnceIcon
  if (template === 'custom') return RoutinesIcon
  // Made elsewhere (Hermes Desktop, or another browser): match by name.
  const byName = Object.values(COPY).find((c) => c.title.toLowerCase() === name.toLowerCase())
  return byName?.icon ?? RoutinesIcon
}

// ── Field wording ───────────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  'custom-reminder:what': 'Remind me to',
  'bill-renewal-watch:what': 'What’s coming up',
  'news-digest:topic': 'Topic',
  'news-digest:count': 'How many stories',
  'learn-daily:topic': 'What to learn',
  'habit-checkin:habit': 'Which habit',
  'on-this-day:flavor': 'What kind',
  'meal-plan:diet': 'Diet',
  'meal-plan:meals': 'Meals',
  'meal-plan:effort': 'Cooking time',
  'hydration-move:interval_hours': 'How often',
  'hydration-move:start_hour': 'From',
  'hydration-move:end_hour': 'Until',
  'price-watch:item': 'What to watch',
  'price-watch:condition': 'Tell me when',
  'price-watch:interval_h': 'Check every',
  'important-mail:interval_min': 'Check every',
  'important-mail:criteria': 'Only tell me if the email',
}

export function fieldLabel(template: string, f: BlueprintField) {
  return LABELS[`${template}:${f.name}`] ?? f.label.replace(/[?…:]+$/, '')
}

const hourLabel = (h: number) => new Date(2000, 0, 3, h).toLocaleTimeString(undefined, { hour: 'numeric' })

/** "9" in an hour field → "9 AM"; "6" hours → "6 hours"; "dinner only" → "Dinner only". */
export function optionLabel(template: string, f: BlueprintField, value: string) {
  const n = Number(value)
  if (/_hour$/.test(f.name) && Number.isFinite(n)) return hourLabel(n)
  if (/^interval_(h|hours)$/.test(f.name)) return n === 1 ? 'Hour' : `${n} hours`
  if (f.name === 'interval_min') return `${n} min`
  if (f.name === 'count') return value
  void template
  return value ? value[0].toUpperCase() + value.slice(1) : value
}
