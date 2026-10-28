// The small live moments inside a turn, folded into the thread's items: the
// agent's checklist (todo.updated), the helpers it sends off (subagent.*) and
// tapbacks on messages (message.react / message.reaction). Pure, so the chat
// store stays a thin router and these stay easy to test.

import type { ChatItem, Reaction, Todo } from './types'
import { toolLabel } from './tool-labels'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>
type P = Record<string, unknown>

// ── The plan ────────────────────────────────────────────────────────────────

const STATUSES = new Set<Todo['status']>(['pending', 'in_progress', 'completed', 'cancelled'])

/** Hermes's todo tool (renamed in 0.21; the old name still runs). */
export const isTodoTool = (name: string) => name === 'todo_list' || name === 'todo'

/** A todo list as Hermes sends it, made safe to draw; null when it isn't one. */
export function todosOf(value: unknown): Todo[] | null {
  if (!Array.isArray(value)) return null
  return value.flatMap((raw): Todo[] => {
    const t = raw as P | null
    const content = typeof t?.content === 'string' ? t.content.trim() : ''
    if (!t || !content) return []
    const status = STATUSES.has(t.status as Todo['status']) ? (t.status as Todo['status']) : 'pending'
    const parent = typeof t.parent === 'string' && t.parent ? t.parent : undefined
    return [{ id: String(t.id ?? content), content, status, ...(parent && { parent }) }]
  })
}

function parse(value: unknown): P | null {
  if (value && typeof value === 'object') return value as P
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return null
  try {
    const out = JSON.parse(value)
    return out && typeof out === 'object' ? out : null
  } catch {
    return null
  }
}

/**
 * The list a todo call came back with (`{todos, revision, summary}`), also
 * when it ran through Hermes's tool search, which wraps results in `results`.
 */
export function planFromResult(result: unknown): { todos: Todo[]; revision: number } | null {
  const r = parse(result)
  if (!r) return null
  const todos = todosOf(r.todos)
  if (todos) return { todos, revision: Number(r.revision) || 0 }
  for (const inner of Array.isArray(r.results) ? r.results : []) {
    const found = planFromResult((inner as P | null)?.result ?? inner)
    if (found) return found
  }
  return null
}

/** What a turn answers: something you said, or Hermes waking the agent (a helper back, say). */
export const startsTurn = (i: ChatItem) => i.kind === 'user' || i.kind === 'wake'

/** Where this turn starts: just after what it answers. */
const turnStart = (items: ChatItem[]) => items.findLastIndex(startsTurn) + 1

/**
 * The turn's checklist, made or brought up to date. One per turn: later
 * updates tick it off in place, and an older snapshot never undoes a newer
 * one. An emptied list takes the checklist away.
 */
export function withPlan(items: ChatItem[], todos: Todo[], revision: number, id: string): ChatItem[] {
  const from = turnStart(items)
  const at = items.findIndex((i, n) => n >= from && i.kind === 'plan')
  const plan = items[at] as Of<'plan'> | undefined
  if (plan && revision < plan.revision) return items
  if (!todos.length) return plan ? items.filter((_, n) => n !== at) : items
  if (!plan) return [...items, { kind: 'plan', id, todos, revision }]
  return items.map((i, n) => (n === at ? { ...plan, todos, revision } : i))
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const ENDED: Record<string, Of<'helper'>['status']> = {
  completed: 'done',
  interrupted: 'stopped',
  failed: 'error',
  error: 'error',
  timeout: 'error',
}

/** Which helper an event is about: Hermes's id, or (older Hermes) its place in the batch. */
export function helperKey(p: P) {
  if (typeof p.subagent_id === 'string' && p.subagent_id) return p.subagent_id
  return `${String(p.delegation_id ?? 'd')}-${Number(p.task_index ?? 0)}`
}

/** What a helper is up to, in the same words the agent's own steps use. */
function lineOf(type: string, p: P): string | undefined {
  if (type === 'subagent.thinking') return 'Thinking'
  if (type === 'subagent.tool' && typeof p.tool_name === 'string' && p.tool_name) {
    const preview = typeof p.tool_preview === 'string' ? p.tool_preview : undefined
    const { label, detail } = toolLabel(p.tool_name, undefined, preview)
    // A page reads as its site, as the agent's own steps put it.
    const site = detail && /^https?:\/\/([^/\s]+)/.exec(detail)?.[1]?.replace(/^www\./, '')
    return detail ? `${label} · ${site || detail}` : label
  }
  return undefined
}

/** One subagent.* event, folded into its helper's card (made on first sight). */
export function withHelper(items: ChatItem[], type: string, p: P, now: number): ChatItem[] {
  const key = helperKey(p)
  const from = turnStart(items)
  // One working in the background keeps its card in the turn that sent it, whatever has been said since.
  const at = items.findIndex((i, n) => i.kind === 'helper' && i.subagentId === key && (n >= from || i.background))
  const was = items[at] as Of<'helper'> | undefined
  const delegationId = typeof p.delegation_id === 'string' && p.delegation_id ? p.delegation_id : was?.delegationId
  const goal = typeof p.goal === 'string' && p.goal.trim() ? p.goal.trim() : (was?.goal ?? 'Helping out')
  const tools = typeof p.tool_count === 'number' ? p.tool_count : (was?.tools ?? 0)
  const ended = type === 'subagent.complete' ? (ENDED[String(p.status ?? 'completed')] ?? 'done') : undefined
  // A helper that's finished stays finished, whatever straggles in after.
  if (was && was.status !== 'running' && !ended) return items
  const next: Of<'helper'> = {
    ...(was ?? { kind: 'helper', id: `helper-${key}`, subagentId: key, startedAt: now }),
    goal,
    tools,
    status: ended ?? 'running',
    line: ended ? undefined : (lineOf(type, p) ?? was?.line),
    ...(ended && { endedAt: now }),
    ...(ended && typeof p.summary === 'string' && p.summary.trim() && { summary: p.summary.trim() }),
    ...(delegationId && { delegationId }),
  }
  return was ? items.map((i, n) => (n === at ? next : i)) : [...items, next]
}

/**
 * delegate_task sent its helpers off to work in the background (every call
 * the agent itself makes, since Hermes 0.22): they carry on after this turn,
 * and Hermes wakes the agent when they're back. Their cards stay live, and
 * any helper not heard from yet gets its card now, from what the call says it
 * sent (`{status: "dispatched", delegation_id, goals, subagent_ids}`).
 */
export function withErrand(items: ChatItem[], result: unknown, now: number): ChatItem[] {
  const r = parse(result)
  if (r?.status !== 'dispatched' || typeof r.delegation_id !== 'string') return items
  const errand = r.delegation_id
  const goals = Array.isArray(r.goals) ? r.goals : []
  const ids = Array.isArray(r.subagent_ids) && r.subagent_ids.length === goals.length ? r.subagent_ids : []
  const keys = goals.map((_, i) => (typeof ids[i] === 'string' && ids[i] ? (ids[i] as string) : `${errand}-${i}`))
  const from = turnStart(items)
  const sent = (i: ChatItem, n: number): i is Of<'helper'> =>
    n >= from && i.kind === 'helper' && (keys.includes(i.subagentId) || i.delegationId === errand)
  const known = new Set(items.flatMap((i, n) => (sent(i, n) ? [i.subagentId] : [])))
  const fresh = keys.flatMap((key, i): Of<'helper'>[] =>
    known.has(key)
      ? []
      : [
          {
            kind: 'helper',
            id: `helper-${key}`,
            subagentId: key,
            goal: typeof goals[i] === 'string' && goals[i].trim() ? goals[i].trim() : 'Helping out',
            status: 'running',
            tools: 0,
            startedAt: now,
            delegationId: errand,
            background: true,
          },
        ],
  )
  return [
    ...items.map((i, n) => (sent(i, n) ? { ...i, delegationId: i.delegationId ?? errand, background: true } : i)),
    ...fresh,
  ]
}

/** The turn is over: any helper still shown as running isn't anymore (unless it works in the background). */
export function settleHelpers(items: ChatItem[], stopped: boolean, now: number): ChatItem[] {
  if (!items.some((i) => i.kind === 'helper' && i.status === 'running' && !i.background)) return items
  return items.map((i) =>
    i.kind === 'helper' && i.status === 'running' && !i.background
      ? { ...i, status: stopped ? 'stopped' : 'done', endedAt: now }
      : i,
  )
}

// ── Reactions ───────────────────────────────────────────────────────────────

/** Hermes's stored reactions (a row's `display_metadata.reactions`), as tapbacks. */
export function reactionsOf(value: unknown): Reaction[] | undefined {
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as P | null)?.reactions)
      ? (value as P).reactions
      : []
  const out = (list as P[]).flatMap((r): Reaction[] =>
    typeof r?.emoji === 'string' && r.emoji && (r.author === 'user' || r.author === 'agent')
      ? [{ emoji: r.emoji, author: r.author }]
      : [],
  )
  return out.length ? out : undefined
}

/** Tapback rules, for showing yours at once: the same emoji takes it back, another replaces it. */
export function toggled(reactions: Reaction[] | undefined, emoji: string, author: Reaction['author']) {
  const mine = reactions?.find((r) => r.author === author)
  const rest = (reactions ?? []).filter((r) => r.author !== author)
  const next = mine?.emoji === emoji ? rest : [...rest, { emoji, author }]
  return next.length ? next : undefined
}

type Reactable = Of<'user'> | Of<'assistant'>

/**
 * A message's reactions as Hermes now has them. Found by its row id, or, for
 * one not saved when it was shown, as the newest message of its `role` (which
 * then learns its row id).
 */
export function withReactions(
  items: ChatItem[],
  { rowId, role, reactions }: { rowId?: number; role?: string; reactions?: Reaction[] },
): ChatItem[] {
  const isMsg = (i: ChatItem): i is Reactable => i.kind === 'user' || i.kind === 'assistant'
  let at = rowId == null ? -1 : items.findIndex((i) => isMsg(i) && i.rowId === rowId)
  if (at < 0 && (role === 'user' || role === 'assistant')) {
    const newest = items.findLastIndex((i) => i.kind === role)
    if (newest >= 0 && (items[newest] as Reactable).rowId == null) at = newest
  }
  if (at < 0) return items
  const item = items[at] as Reactable
  return items.map((i, n) => (n === at ? { ...item, rowId: rowId ?? item.rowId, reactions } : i))
}

// ── Previews ────────────────────────────────────────────────────────────────

/**
 * The agent opened something in "the preview pane" (Hermes Desktop's). Murmur
 * has none, so it shows up right under the step that opened it: a page as a
 * link, a file as the file itself.
 */
export function withPreview(items: ChatItem[], url: string): ChatItem[] {
  const target = url.trim().replace(/^file:\/\//i, '')
  if (!target) return items
  const from = turnStart(items)
  const isStep = (i: ChatItem, n: number): i is Of<'tool'> => n >= from && i.kind === 'tool'
  let at = items.findLastIndex((i, n) => isStep(i, n) && i.name === 'desktop_preview')
  if (at < 0) at = items.findLastIndex((i, n) => isStep(i, n) && i.status === 'running')
  const step = items[at]
  if (step?.kind !== 'tool' || step.media?.includes(target)) return items
  return items.map((i, n) => (n === at ? { ...step, media: [...(step.media ?? []), target] } : i))
}
