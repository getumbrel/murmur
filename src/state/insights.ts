// What you've been up to with an agent, and what a chat is costing: read from
// Hermes's own accounting. The week from /api/analytics/usage (per agent, per
// day); a chat's room left and spend from session.usage, its stored row and
// session.context_breakdown.

import { useQuery } from '@tanstack/react-query'
import { api } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import { toolCategory, type ToolCategory } from '@/features/chat/tool-labels'

// ── The week ────────────────────────────────────────────────────────────────

type DailyRow = { day?: string; sessions?: number; estimated_cost?: number; actual_cost?: number }
type ToolRow = { tool?: string; count?: number }
export type UsageAnalytics = { daily?: DailyRow[]; tools?: ToolRow[] }

export type Day = { key: string; date: Date; chats: number }
export type ToolUse = { category: ToolCategory; count: number }
export type Week = {
  /** The last seven days, oldest first, ending today. */
  days: Day[]
  chats: number
  /** Spent this calendar month; `estimated` when Hermes only has its own sums. */
  month: { amount: number; estimated: boolean }
  /** What it reached for most, by kind of tool. */
  tools: ToolUse[]
}

const pad = (n: number) => String(n).padStart(2, '0')
/** A local date as Hermes keys its days ("2026-10-15"). */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Hermes's per-day rows as a week you can glance at; null when there's nothing in it yet. */
export function summarizeWeek(raw: UsageAnalytics, now = new Date()): Week | null {
  const byDay = new Map((raw.daily ?? []).map((r) => [r.day ?? '', r]))
  const days: Day[] = []
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = dayKey(date)
    days.push({ key, date, chats: byDay.get(key)?.sessions ?? 0 })
  }
  const chats = days.reduce((n, d) => n + d.chats, 0)
  if (!chats) return null

  const monthStart = dayKey(new Date(now.getFullYear(), now.getMonth(), 1))
  let actual = 0
  let estimated = 0
  for (const r of raw.daily ?? []) {
    if ((r.day ?? '') < monthStart) continue
    actual += r.actual_cost ?? 0
    estimated += r.estimated_cost ?? 0
  }
  // Billed amounts beat Hermes's own sums when the service reports them.
  const month = actual > 0 ? { amount: actual, estimated: false } : { amount: estimated, estimated: true }

  const counts = new Map<ToolCategory, number>()
  for (const t of raw.tools ?? []) {
    if (!t.tool || !t.count) continue
    const c = toolCategory(t.tool)
    counts.set(c, (counts.get(c) ?? 0) + t.count)
  }
  const tools = [...counts]
    .filter(([c]) => c !== 'other' && c !== 'question')
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)

  return { days, chats, month, tools }
}

/** An agent's last seven days (and this month's spend), or null while there's nothing to show. */
export function useWeek(agentId: string) {
  return useQuery({
    queryKey: ['week', agentId],
    queryFn: async () => {
      // A month back covers both the week and this month so far.
      const raw = await api.get<UsageAnalytics>(`/api/analytics/usage?days=31&profile=${encodeURIComponent(agentId)}`)
      return summarizeWeek(raw)
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
}

/** "$1.95", "$0.04", "< $0.01"; dollars only (Hermes counts in USD). */
export function money(amount: number) {
  if (amount <= 0) return '$0'
  if (amount < 0.01) return '< $0.01'
  if (amount < 100) return `$${amount.toFixed(2)}`
  return `$${Math.round(amount).toLocaleString()}`
}

// ── One chat ────────────────────────────────────────────────────────────────

type SessionUsage = {
  cache_hit_pct?: number | null
  cost_usd?: number | null
  cost_status?: string | null
  prompt?: number | null
  completion?: number | null
}
type SessionRow = {
  estimated_cost_usd?: number | null
  actual_cost_usd?: number | null
  cost_status?: string | null
  input_tokens?: number | null
  cache_read_tokens?: number | null
  cache_write_tokens?: number | null
  output_tokens?: number | null
}

export type ChatUsage = {
  /** Spent so far; undefined when it's covered by a plan or nothing's known. */
  cost?: number
  /** Covered by a subscription (a ChatGPT plan), so there's no bill. */
  included: boolean
  /**
   * How much the agent has read and written over the whole chat, in the units
   * a model counts and bills in. Every reply reads the chat again, so reading
   * runs far ahead of what the chat holds. Undefined before the first reply.
   */
  work?: { read: number; written: number }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export function chatUsageOf(usage: SessionUsage | null | undefined, row: SessionRow | null | undefined): ChatUsage {
  const status = usage?.cost_status ?? row?.cost_status ?? undefined
  const cost = num(usage?.cost_usd) ?? num(row?.actual_cost_usd) ?? num(row?.estimated_cost_usd)
  // The stored row first: a chat reopened from the list has no live count
  // until its next reply. Reading includes what came back from the cache.
  const stored = row && [row.input_tokens, row.cache_read_tokens, row.cache_write_tokens].some((n) => num(n))
  const read = stored
    ? (num(row.input_tokens) ?? 0) + (num(row.cache_read_tokens) ?? 0) + (num(row.cache_write_tokens) ?? 0)
    : (num(usage?.prompt) ?? 0)
  const written = stored ? (num(row.output_tokens) ?? 0) : (num(usage?.completion) ?? 0)
  return {
    cost: status === 'included' || !cost ? undefined : cost,
    included: status === 'included',
    work: read > 0 ? { read, written } : undefined,
  }
}

/**
 * What a chat has cost. Re-read after every reply (`turns`); the
 * live numbers need the chat open in Hermes (`runtimeId`), the spend doesn't.
 */
export function useChatUsage(chat: { id: string; profile: string; runtimeId?: string; turns?: number } | undefined) {
  const runtimeId = chat?.runtimeId
  return useQuery({
    queryKey: ['chat-usage', chat?.id, runtimeId, chat?.turns ?? 0],
    enabled: !!chat?.id,
    queryFn: async () => {
      const [usage, row] = await Promise.all([
        runtimeId ? rpc<SessionUsage>('session.usage', { session_id: runtimeId }, 15_000).catch(() => null) : null,
        api
          .get<SessionRow>(`/api/sessions/${encodeURIComponent(chat!.id)}?profile=${encodeURIComponent(chat!.profile)}`)
          .catch(() => null),
      ])
      return chatUsageOf(usage, row)
    },
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    retry: false,
  })
}

// ── What fills a chat's context ─────────────────────────────────────────────

type Category = { id?: string; label?: string; tokens?: number }
export type Slice = { id: 'chat' | 'instructions' | 'tools' | 'skills' | 'memory'; label: string; tokens: number }

const SLICES: Record<string, Slice['id']> = {
  conversation: 'chat',
  system_prompt: 'instructions',
  rules: 'instructions',
  tool_definitions: 'tools',
  mcp: 'tools',
  subagent_definitions: 'tools',
  skills: 'skills',
  memory: 'memory',
}
const LABELS: Record<Slice['id'], string> = {
  chat: 'This chat',
  instructions: 'Instructions',
  tools: 'Tools',
  skills: 'Skills',
  memory: 'Memory',
}

/** Hermes's eight categories folded into the five a person would name, biggest first. */
export function slicesOf(categories: Category[] | undefined): Slice[] {
  const sums = new Map<Slice['id'], number>()
  for (const c of categories ?? []) {
    const id = SLICES[c.id ?? '']
    if (!id || !c.tokens || c.tokens <= 0) continue
    sums.set(id, (sums.get(id) ?? 0) + c.tokens)
  }
  return [...sums].map(([id, tokens]) => ({ id, label: LABELS[id], tokens })).sort((a, b) => b.tokens - a.tokens)
}

/** What's taking up a chat's context, while its sheet is open. */
export function useContextBreakdown(runtimeId: string | undefined, open: boolean) {
  return useQuery({
    queryKey: ['context-breakdown', runtimeId],
    enabled: open && !!runtimeId,
    queryFn: async () => {
      const res = await rpc<{ categories?: Category[]; context_max?: number }>(
        'session.context_breakdown',
        { session_id: runtimeId },
        20_000,
      )
      return { slices: slicesOf(res.categories), max: res.context_max ?? 0 }
    },
    staleTime: 30_000,
    retry: false,
  })
}

/** "128K", "1.2M": a context window's size the way model pages write it. */
export function tokensText(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}
