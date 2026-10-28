// Hermes wakes an agent on its own now and then: helpers it sent off are back
// (since Hermes 0.22 every helper works in the background), a command it left
// running has finished, or a reply a restart cut off picks up again. The wake
// is saved as a message from you, so the model reads it in turn, but Hermes
// marks the row with what it is (`display_kind`) and a few facts about it
// (`display_metadata`), the same fields Hermes Desktop draws it from. These
// read those. The text is written for the model, and is read only for what
// the counts leave out, how each helper went; when it doesn't read, the counts
// stand.

import type { ChatItem, WakeReason } from './types'
import { ENDED, WHY } from './live'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

/** A saved message, as much of it as a wake needs. */
export type SavedRow = {
  id?: number
  role: string
  content?: string | null
  tool_name?: string | null
  display_kind?: string | null
  display_metadata?: unknown
  timestamp?: number
}

const REASONS: Record<string, WakeReason> = {
  async_delegation_complete: 'helpers',
  process_complete: 'command',
  auto_continue: 'resume',
  // A wake in a chat that runs through Hermes's messaging gateway (Telegram, WhatsApp).
  internal_notification: 'update',
}

/** Marked messages that are only notes to the model, never a turn of their own. */
const NOTES = new Set(['hidden', 'model_switch', 'personality_switch'])

/**
 * The person's own words. Hermes marks every message it writes in their name
 * (a wake, a hidden prompt, a note to the model); the one marked message that
 * is still theirs is one sent while a reply was underway ("steer").
 */
export const isYours = (row: Pick<SavedRow, 'role' | 'display_kind'>) =>
  row.role === 'user' && (!row.display_kind || row.display_kind === 'steer')

/**
 * Why Hermes woke the agent, when this message is a wake. A kind newer than
 * this page is one too when the agent answered it (`answered`): it still
 * opens a turn of its own, as a plain "checked back in".
 */
export function wakeReason(row: Pick<SavedRow, 'role' | 'display_kind'>, answered = false): WakeReason | undefined {
  const kind = row.role === 'user' && !isYours(row) ? row.display_kind! : undefined
  if (!kind) return undefined
  return REASONS[kind] ?? (answered && !NOTES.has(kind) ? 'update' : undefined)
}

type Json = Record<string, unknown>

/** Hermes's REST gives JSON columns decoded; an older one gave them as text. */
function record(value: unknown): Json | undefined {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined
}

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

/** How one helper went, by the report under the wake. */
export type Outcome = { status: Of<'helper'>['status']; took?: number; line?: string; summary?: string }

/**
 * How an errand went, as the wake that brought its helpers back tells it:
 * the counts, and each helper by its place in the call that sent it.
 */
export type Return = { at: number; helpers: number; failed: number; took?: number; tasks?: Map<number, Outcome> }

/**
 * Helpers sent off together: what each was asked, who went (their ids key
 * their cards and faces) and, once they're back, how it went.
 */
export type Errand = { goals: string[]; subagentIds: (string | undefined)[]; back?: Return }

/** The parts of one call that report back on their own: each part's errand id, and which tasks it took. */
function partsOf(sent: Json) {
  return (Array.isArray(sent.units) ? (sent.units as unknown[]) : []).flatMap((part) => {
    const unit = record(part)
    if (typeof unit?.delegation_id !== 'string' || !Array.isArray(unit.task_indexes)) return []
    return [{ id: unit.delegation_id, tasks: unit.task_indexes.filter((i): i is number => typeof i === 'number') }]
  })
}

/** What a background delegate_task call sent: `{status: "dispatched", delegation_id, goals, subagent_ids}`. */
function dispatchOf(row: SavedRow) {
  if (row.role !== 'tool' || row.tool_name !== 'delegate_task') return undefined
  const sent = record(row.content)
  return sent?.status === 'dispatched' && typeof sent.delegation_id === 'string'
    ? (sent as Json & { delegation_id: string })
    : undefined
}

// The report under a helpers' wake has a block for each one: a line like
// "--- ✓ TASK 1/2: <goal>  (status=completed, api_calls=3, 39.5s) ---", then
// what it came back with (tools/process_registry_notifications.py).
const TASK =
  /^--- \S+ TASK (\d+)\/\d+[^\n]*?\(status=([a-z_]+)(?:, api_calls=\d+)?(?:, ([\d.]+)s)?(?:, TRUNCATED[^)\n]*)?\) ---$/gmu
/** What Hermes adds under a helper's own words: that it was cut short, where its transcript is, what it left running. */
const ASIDE = /^(\[TRUNCATED|Full live transcript|Handed off to you:|Child left |Child's process )/

/** How each helper went, by its place in the call: its block in the report. */
function outcomesOf(text: string): Map<number, Outcome> {
  const heads = [...text.matchAll(TASK)]
  return new Map(
    heads.map((m, n) => {
      const [, place, word, secs] = m
      const status = ENDED[word] ?? 'error'
      const said = text
        .slice(m.index + m[0].length, heads[n + 1]?.index ?? text.length)
        .split('\n')
        .filter((l) => !ASIDE.test(l))
        .join('\n')
        .trim()
      const outcome: Outcome = {
        status,
        ...(secs && { took: Math.round(Number(secs) * 1000) }),
        ...(status === 'error' && WHY[word] && { line: WHY[word] }),
        ...(status === 'done' && said && { summary: said }),
      }
      return [Number(place) - 1, outcome]
    }),
  )
}

/** A helpers' wake, read: which errand it brings back, and how that went. */
function returnOf(row: SavedRow, errand?: Errand): Return & { delegationId?: string } {
  const meta = record(row.display_metadata) ?? {}
  const delegationId = typeof meta.delegation_id === 'string' && meta.delegation_id ? meta.delegation_id : undefined
  const helpers = errand?.goals.length || count(meta.task_count) || 1
  const took = count(meta.duration_seconds)
  const tasks = typeof row.content === 'string' ? outcomesOf(row.content) : undefined
  return {
    delegationId,
    at: (row.timestamp ?? 0) * 1000,
    helpers,
    failed: Math.min(count(meta.failed_count) ?? 0, helpers),
    ...(took != null && { took: took * 1000 }),
    ...(tasks?.size && { tasks }),
  }
}

/**
 * Every errand the agent sent off in these messages, by its id: delegate_task
 * answers a background call with what it sent, and Hermes wakes the agent
 * with the errand's id when its helpers are back. When the parts of one call
 * report back on their own, each part is listed too.
 */
export function errandsOf(rows: SavedRow[]): Map<string, Errand> {
  const errands = new Map<string, Errand>()
  for (const row of rows) {
    if (wakeReason(row) === 'helpers') {
      const { delegationId, ...back } = returnOf(row)
      const errand = delegationId ? errands.get(delegationId) : undefined
      if (errand) errand.back = { ...back, helpers: errand.goals.length || back.helpers }
      continue
    }
    const sent = dispatchOf(row)
    if (!sent) continue
    const goals = Array.isArray(sent.goals) ? sent.goals.map((g) => (typeof g === 'string' ? g.trim() : '')) : []
    const ids = Array.isArray(sent.subagent_ids) ? sent.subagent_ids : []
    // One id per helper that went; a task Hermes turned away leaves the two lists out of step.
    const subagentIds = ids.length === goals.length ? ids.map((s) => (typeof s === 'string' && s ? s : undefined)) : []
    errands.set(sent.delegation_id, { goals, subagentIds })
    for (const part of partsOf(sent))
      errands.set(part.id, {
        goals: part.tasks.map((i) => goals[i] ?? ''),
        subagentIds: part.tasks.map((i) => subagentIds[i]),
      })
  }
  return errands
}

/**
 * The helpers a background delegate_task sent off, as cards in the turn that
 * sent them (in place of the step): who went and what each was asked, and how
 * it went once the wake that brings them back is saved. Until then they're
 * still out working.
 */
export function sentItems(row: SavedRow, errands: Map<string, Errand>): Of<'helper'>[] {
  const sent = dispatchOf(row)
  const errand = sent && errands.get(sent.delegation_id)
  if (!sent || !errand) return []
  const at = (row.timestamp ?? 0) * 1000
  const parts = partsOf(sent)
  return errand.goals.map((goal, i): Of<'helper'> => {
    // Hermes's own id when the call names it; otherwise how an older Hermes keyed its live events.
    const key = errand.subagentIds[i] ?? `${sent.delegation_id}-${i}`
    const part = parts.find((p) => p.tasks.includes(i))
    const back = (part && errands.get(part.id)?.back) ?? errand.back
    const told = back?.tasks?.get(i)
    // Without its own block in the report, how it went is only known when they all went the same way.
    const status =
      told?.status ?? (!back ? 'running' : !back.failed ? 'done' : back.failed >= back.helpers ? 'error' : 'back')
    const took = told?.took ?? back?.took
    return {
      kind: 'helper',
      id: `helper-${key}`,
      subagentId: key,
      goal,
      status,
      ...(told?.line && { line: told.line }),
      tools: 0,
      startedAt: at,
      ...(back && { endedAt: took != null ? at + took : back.at }),
      ...(told?.summary && { summary: told.summary }),
      delegationId: sent.delegation_id,
      ...(!back && { background: true }),
    }
  })
}

/**
 * A wake as a chat item. When helpers are back it says how many and how it
 * went; the helpers themselves stay in the turn that sent them.
 * `answered`: the agent's reply comes next.
 */
export function wakeItems(row: SavedRow, id: string, errands: Map<string, Errand>, answered = false): ChatItem[] {
  const reason = wakeReason(row, answered)
  if (!reason) return []
  const at = (row.timestamp ?? 0) * 1000
  const wake: Of<'wake'> = { kind: 'wake', id, reason, at, rowId: row.id }
  if (reason !== 'helpers') return [wake]
  const meta = record(row.display_metadata)
  const errand = typeof meta?.delegation_id === 'string' ? errands.get(meta.delegation_id) : undefined
  const { delegationId, helpers, failed, took } = returnOf(row, errand)
  const subagentIds = errand?.subagentIds.filter((s): s is string => !!s)
  return [
    {
      ...wake,
      delegationId,
      helpers,
      failed,
      ...(took != null && { took }),
      ...(subagentIds?.length && { subagentIds }),
    },
  ]
}

/**
 * Helpers read back from history, with what this page saw of them live: how
 * each one went, what it said and how long it took.
 */
export function withSeenHelpers(items: ChatItem[], seen: ChatItem[]): ChatItem[] {
  const live = new Map(seen.flatMap((i) => (i.kind === 'helper' ? [[i.subagentId, i] as const] : [])))
  if (!live.size) return items
  return items.map((i) => {
    const was = i.kind === 'helper' ? live.get(i.subagentId) : undefined
    if (i.kind !== 'helper' || !was) return i
    const status = was.status === 'running' ? i.status : was.status
    return {
      ...i,
      goal: i.goal || was.goal,
      status,
      line: status === was.status ? was.line : i.line,
      summary: was.summary ?? i.summary,
      tools: was.tools,
      startedAt: was.startedAt,
      endedAt: was.status === 'running' ? i.endedAt : (was.endedAt ?? i.endedAt),
    }
  })
}
