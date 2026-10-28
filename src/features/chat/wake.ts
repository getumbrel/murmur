// Hermes wakes an agent on its own now and then: helpers it sent off are back
// (since Hermes 0.22 every helper works in the background), a command it left
// running has finished, or a reply a restart cut off picks up again. The wake
// is saved as a message from you, so the model reads it in turn, but Hermes
// marks the row with what it is (`display_kind`) and a few facts about it
// (`display_metadata`), the same fields Hermes Desktop draws it from. These
// read only those, never the text, which is written for the model.

import type { ChatItem, WakeReason } from './types'

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

/** Helpers sent off together: what each was asked, and who went (their ids key their cards and faces). */
export type Errand = { goals: string[]; subagentIds: (string | undefined)[] }

/**
 * Every errand the agent sent off in these messages, by its id: delegate_task
 * answers a background call with what it sent (`status: "dispatched"`). When
 * the parts of one call report back on their own, each part is listed too.
 */
export function errandsOf(rows: SavedRow[]): Map<string, Errand> {
  const errands = new Map<string, Errand>()
  for (const row of rows) {
    if (row.role !== 'tool' || row.tool_name !== 'delegate_task') continue
    const sent = record(row.content)
    if (sent?.status !== 'dispatched' || typeof sent.delegation_id !== 'string') continue
    const goals = Array.isArray(sent.goals) ? sent.goals.map((g) => (typeof g === 'string' ? g.trim() : '')) : []
    const ids = Array.isArray(sent.subagent_ids) ? sent.subagent_ids : []
    // One id per helper that went; a task Hermes turned away leaves the two lists out of step.
    const subagentIds = ids.length === goals.length ? ids.map((s) => (typeof s === 'string' && s ? s : undefined)) : []
    errands.set(sent.delegation_id, { goals, subagentIds })
    for (const part of Array.isArray(sent.units) ? (sent.units as unknown[]) : []) {
      const unit = record(part)
      if (typeof unit?.delegation_id !== 'string' || !Array.isArray(unit.task_indexes)) continue
      const tasks = unit.task_indexes.filter((i): i is number => typeof i === 'number')
      errands.set(unit.delegation_id, {
        goals: tasks.map((i) => goals[i] ?? ''),
        subagentIds: tasks.map((i) => subagentIds[i]),
      })
    }
  }
  return errands
}

/**
 * A wake as chat items: the wake, and when helpers are back, a card for each
 * one. Who they were and what they were asked come from the errand that sent
 * them, when that's still in view; how it went comes from the wake.
 * `answered`: the agent's reply comes next.
 */
export function wakeItems(row: SavedRow, id: string, errands: Map<string, Errand>, answered = false): ChatItem[] {
  const reason = wakeReason(row, answered)
  if (!reason) return []
  const at = (row.timestamp ?? 0) * 1000
  const wake: Of<'wake'> = { kind: 'wake', id, reason, at, rowId: row.id }
  if (reason !== 'helpers') return [wake]

  const meta = record(row.display_metadata) ?? {}
  const delegationId = typeof meta.delegation_id === 'string' && meta.delegation_id ? meta.delegation_id : undefined
  const errand = delegationId ? errands.get(delegationId) : undefined
  const helpers = errand?.goals.length || count(meta.task_count) || 1
  const failed = Math.min(count(meta.failed_count) ?? 0, helpers)
  const took = count(meta.duration_seconds)
  return [
    { ...wake, delegationId, helpers, failed, ...(took != null && { took: took * 1000 }) },
    ...Array.from(
      { length: helpers },
      (_, i): Of<'helper'> => ({
        kind: 'helper',
        id: `${id}-helper-${i}`,
        // Hermes's own id when the errand names it; otherwise how an older Hermes keyed its live events.
        subagentId: errand?.subagentIds[i] ?? `${delegationId ?? id}-${i}`,
        goal: errand?.goals[i] ?? '',
        // How each one went is only known here when they all went the same way.
        status: failed === helpers ? 'error' : 'done',
        tools: 0,
        startedAt: took != null ? at - took * 1000 : at,
        endedAt: at,
        delegationId,
      }),
    ),
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
    return {
      ...i,
      goal: i.goal || was.goal,
      status: was.status === 'running' ? i.status : was.status,
      summary: was.summary ?? i.summary,
      tools: was.tools,
      startedAt: was.startedAt,
      endedAt: was.status === 'running' ? i.endedAt : (was.endedAt ?? i.endedAt),
    }
  })
}
