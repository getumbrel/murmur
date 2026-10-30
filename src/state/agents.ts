// Agents are Hermes profiles. The main profile ("default") is the person's
// first agent and is called Hermes unless they rename it.
//
// What Murmur adds on top lives where Hermes Desktop's Bot Mode keeps it, so
// both apps see the same agent: the name and colour in the profile's
// ui_meta['hermes-bots'] ({title, color}), the exact hue in ui_meta.murmur,
// the role in the profile description, the personality in SOUL.md.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/hermes/rest'
import { useEffect } from 'react'
import { gateway, rpc } from '@/hermes/gateway'
import { ensureAgentTimezone } from '@/state/timezone'
import { forgetInheritedMail } from '@/state/mail'
import { hideDesktopToolsets } from '@/state/toolsets'
import { ensureUmbrelContext } from '@/state/umbrel-context'
import { ensureUmbrelMcp } from '@/state/umbrel-mcp'
import { hexHue, hueFor } from '@/lib/hues'
import { personalityPrompt, type Personality } from '@/features/agents/agent-editor'
import { parseUserMessage } from '@/features/media/parse'
import type { Speaker } from '@/features/chat/types'
import { scoped } from '@/hermes/instance'
import { listProfileNames, listProfiles } from '@/hermes/compat'
import { isQuietExcerpt, isRunBrief, resultLine, runTitle } from '@shared/routines.ts'
import { agentName, botTitle } from '@shared/agents.ts'
import { fetchRunResult, knowRun, runOf } from '@/state/routines'
import { refreshActivity } from '@/state/status'

type LastSession = {
  id: string
  resolved_id?: string
  title?: string
  preview?: string
  started_at?: number
  last_active?: number
  message_count?: number
  source?: string
  /** One of a routine's runs (Murmur's note, from `runOf`). */
  run?: boolean
}

export type Profile = {
  name: string
  is_default: boolean
  model?: string | null
  provider?: string | null
  description?: string
  display_name?: string
  /** REST only: ui_meta['hermes-bots'].title. */
  bot_title?: string
  role?: string | null
  /** profiles.list only. */
  ui_meta?: Record<string, unknown> | null
  /**
   * profiles.list only: how many times each ui_meta record has been written,
   * so a write can refuse to land on one that changed since it was read. A
   * Hermes too old to check leaves it out.
   */
  ui_meta_revisions?: Record<string, number> | null
  last_session?: LastSession | null
  /** profiles.list only: the agent's hidden "Bot Chat" (Hermes Desktop's main chat). */
  canonical_session?: LastSession | null
}

export type Agent = {
  /** Hermes profile name, e.g. "default" or "atlas". */
  id: string
  name: string
  hue: number
  role: string
  isDefault: boolean
  model?: string
  provider?: string
  /**
   * The newest chat, for the roster (the main chat counts, though Hermes hides
   * it). A routine's run counts only when it had something to say.
   */
  lastChat?: { id: string; title: string; at: number; main?: boolean; routine?: boolean }
  /** When the main chat last moved (Hermes hides it from the lists that say so). */
  mainChatAt?: number
  /** Bot Mode's presentation record, kept so edits merge instead of clobbering. */
  botMeta?: Record<string, unknown>
  /** The template it was made from (ui_meta.murmur.template), for its chat starters. */
  template?: string
  /** Murmur's own record (ui_meta.murmur), kept so edits merge instead of clobbering. */
  murmurMeta?: Record<string, unknown>
  /** The main agent's sections and their order (ui_meta['murmur-sections'], src/state/sections.ts). */
  sectionsMeta?: unknown
  /** Each ui_meta record's revision (Profile.ui_meta_revisions); none on an older Hermes. */
  metaRevisions?: Record<string, number>
}

// ── Hues ────────────────────────────────────────────────────────────────────

const HUE_KEY = scoped('murmur:hues')

function storedHues(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(HUE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function rememberHue(id: string, hue: number) {
  try {
    localStorage.setItem(HUE_KEY, JSON.stringify({ ...storedHues(), [id]: hue }))
  } catch {
    // Private mode: hues fall back to what Hermes stores.
  }
}

// What Murmur means to write to a new agent's ui_meta, kept until Hermes has
// it. Profiles can't carry ui_meta at birth, so a list read mid-create (or
// after the tab closed mid-create) would otherwise show a slug and a stranger's
// colour. The next list read finishes the job.
const LOOK_KEY = scoped('murmur:pending-look')

function pendingLooks(): Record<string, Record<string, unknown>> {
  try {
    return JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function setPendingLook(id: string, meta?: Record<string, unknown>) {
  const all = pendingLooks()
  if (meta) all[id] = meta
  else delete all[id]
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(all))
  } catch {
    // Private mode: the agent shows its slug until it's edited.
  }
}

/** The orb's own colour (oklch 0.66 0.17 h) as hex, for Bot Mode's `color`. */
function hueHex(hue: number): string {
  const h = (hue * Math.PI) / 180
  const L = 0.66, A = 0.17 * Math.cos(h), B = 0.17 * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return `#${rgb
    .map((c) => {
      const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
      return Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
    })
    .join('')}`
}

// ── Reading ─────────────────────────────────────────────────────────────────

const record = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * One line a person would write: no `@file:` paths, `MEDIA:` tags or injected
 * context. Hermes titles chats from the expanded prompt, so titles need it too.
 */
export function readable(raw: string | null | undefined, { files = true } = {}) {
  if (!raw) return ''
  const { text, attachments } = parseUserMessage(raw)
  const line = text
    .replace(/MEDIA:\s*(`[^`\n]+`|"[^"\n]+"|\S+)/g, (_, path: string) => fileName(path))
    .split('\n')
    .find((l) => l.trim())
  return line?.trim() || (files && attachments[0]?.name) || ''
}

const fileName = (path: string) => path.replace(/^[`"']|[`"']$/g, '').split(/[\\/]/).pop() || path

export function toAgent(p: Profile, hues = storedHues(), pending = pendingLooks()): Agent {
  const meta = { ...pending[p.name], ...p.ui_meta }
  const bots = record(meta['hermes-bots'])
  const murmur = record(meta.murmur)
  const title = botTitle({ ...p, ui_meta: meta })
  const name = agentName({ ...p, ui_meta: meta })
  // Bot Mode writes "Title — description"; the role is what follows.
  const description = text(p.description)
  const role = title && description.startsWith(`${title} — `) ? description.slice(title.length + 3) : description
  return {
    id: p.name,
    name,
    hue: (typeof murmur?.hue === 'number' ? murmur.hue : undefined) ?? hexHue(bots?.color) ?? hues[p.name] ?? (p.is_default ? 278 : hueFor(p.name)),
    role,
    isDefault: p.is_default,
    model: p.model ?? undefined,
    provider: p.provider ?? undefined,
    lastChat: newestChat(p),
    mainChatAt: p.canonical_session?.id ? activeAt(p.canonical_session) || undefined : undefined,
    botMeta: bots,
    template: text(murmur?.template) || undefined,
    murmurMeta: murmur,
    sectionsMeta: meta['murmur-sections'],
    metaRevisions: record(p.ui_meta_revisions) as Record<string, number> | undefined,
  }
}

const activeAt = (s: LastSession) => (s.last_active || s.started_at || 0) * 1000

/** Hermes's newest listed chat, or the hidden main chat if that moved more recently. */
function newestChat(p: Profile): Agent['lastChat'] {
  const last = p.last_session?.id && !quietRun(p.last_session) ? p.last_session : undefined
  const main = p.canonical_session?.id && (p.canonical_session.message_count ?? 1) > 0 ? p.canonical_session : undefined
  if (main && (!last || activeAt(main) >= activeAt(last))) {
    // Its title is always "Bot Chat"; what was last said reads better.
    return { id: main.resolved_id || main.id, title: readable(main.preview) || MAIN_CHAT, at: activeAt(main), main: true }
  }
  if (!last) return undefined
  if (last.run) {
    // What the routine found, under its name.
    const name = runTitle(last.title ?? '') || 'Routine'
    return { id: last.id, title: [name, resultLine(last.preview ?? '', name)].filter(Boolean).join(' · '), at: activeAt(last), routine: true }
  }
  return { id: last.id, title: readable(last.title, { files: false }) || readable(last.preview) || 'New chat', at: activeAt(last) }
}

/**
 * A routine's run that had nothing to report, or is still going: its latest
 * words are then Hermes's brief, which opens "[IMPORTANT: …" (cut short here).
 */
const quietRun = (s: LastSession) =>
  !!s.run && (!s.preview || s.preview.startsWith('[IMPORTANT:') || isRunBrief(s.preview) || isQuietExcerpt(s.preview))

/**
 * Whether Hermes's newest chat is one of a routine's runs (asked once per
 * chat). A run with nothing to say gives way to the newest chat that did say
 * something: a conversation, or a run with a result. Each run is read once.
 */
export async function placeLastChats<P extends Profile>(profiles: P[]): Promise<P[]> {
  return Promise.all(
    profiles.map(async (p) => {
      if (!p.last_session?.id) return p
      const last = { ...p.last_session, run: Boolean(await runOf(p.name, p.last_session.id).catch(() => null)) }
      if (!quietRun(last)) return { ...p, last_session: last }
      try {
        const res = await api.get<{ sessions?: LastSession[] }>(
          `/api/sessions?profile=${encodeURIComponent(p.name)}&limit=8&order=recent&min_messages=1`,
        )
        for (const row of res.sessions ?? []) {
          // Only Hermes's scheduler makes chats from "cron".
          if (row.source !== 'cron') return { ...p, last_session: row }
          const said = await runSaid(p.name, row)
          if (said) return { ...p, last_session: { ...row, run: true, preview: said } }
        }
        return { ...p, last_session: null }
      } catch {
        return { ...p, last_session: last }
      }
    }),
  )
}

const runWords = new Map<string, Promise<string>>()

/** What a run had to say: '' when nothing to report, or nothing yet. A run that moves is read again. */
function runSaid(profile: string, run: LastSession) {
  const key = `${profile}:${run.id}@${run.last_active ?? 0}`
  let out = runWords.get(key)
  if (!out) {
    out = fetchRunResult(profile, run.id).then((r) => (r.quiet ? '' : r.text))
    out.catch(() => runWords.delete(key))
    runWords.set(key, out)
  }
  return out
}

export const speakerOf = (a: Agent): Speaker => ({ id: a.id, name: a.name, hue: a.hue })

// In development, builders' throwaway agents (murmur-test…) are hidden, except
// the ones whose names start with the prefix in localStorage['murmur:test-prefix'].
// Production builds never hide anyone, so a person's own "Murmur Test…" agent
// (slug murmur-test-…) can't vanish the moment it's made.
const TEST_PREFIX = 'murmur-test'
function devPrefix(): string {
  if (!import.meta.env.DEV) return ''
  try {
    return localStorage.getItem('murmur:test-prefix') ?? ''
  } catch {
    return ''
  }
}

export const agentsKey = ['agents'] as const

/** Agents still being made here: they join the roster when their creator says so. */
const hatching = new Set<string>()

export function useAgents() {
  return useQuery({
    queryKey: agentsKey,
    queryFn: async () => {
      const res = {
        profiles: await placeLastChats(await listProfiles<Profile & { [key: string]: unknown }>({ include_sessions: true })),
      }
      const hues = storedHues()
      const pending = pendingLooks()
      const prefix = devPrefix()
      for (const p of res.profiles) if (pending[p.name] && !hatching.has(p.name)) void finishLook(p, pending[p.name])
      // Main agent first, then everyone else alphabetically.
      return res.profiles
        .filter((p) => !import.meta.env.DEV || !p.name.startsWith(TEST_PREFIX) || (prefix && p.name.startsWith(prefix)))
        .filter((p) => !hatching.has(p.name))
        .map((p) => toAgent(p, hues, pending))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    },
    staleTime: 30_000,
  })
}

export function useAgent(id: string | undefined) {
  const { data } = useAgents()
  return data?.find((a) => a.id === id)
}

export function useInvalidateAgents() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: agentsKey })
}

/** Latest chats move as they happen: Hermes says when any chat list changes. Mount once. */
export function useFreshAgents() {
  const qc = useQueryClient()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = gateway.onEvent((ev) => {
      if (ev.type !== 'sessions.changed') return
      clearTimeout(timer)
      // After hearing who's mid-turn, so the roster holds a busy agent in place (state/status.ts).
      timer = setTimeout(() => refreshActivity().then(() => qc.invalidateQueries({ queryKey: agentsKey })), 700)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [qc])
}

// ── Personality (SOUL.md) ───────────────────────────────────────────────────

const PRESETS: Personality[] = ['warm', 'concise', 'playful', 'thoughtful', 'direct']

/** The SOUL Murmur writes: who the agent is, what it's for, how it talks. */
export function composeSoul(name: string, role: string, personality: Personality, custom = '') {
  const focus = role.replace(/[.\s]+$/, '')
  const intro = `You are ${name}.${focus ? ` You help with ${/^[A-Z][a-z]/.test(focus) ? focus[0].toLowerCase() + focus.slice(1) : focus}.` : ''}`
  return [`# ${name}`, intro, personalityPrompt(personality, custom)].filter(Boolean).join('\n\n') + '\n'
}

/** Recover the editor's personality from a SOUL (ours, or anyone else's as custom). */
export function readSoul(soul: string): { personality: Personality; custom: string } {
  const preset = PRESETS.find((p) => soul.includes(personalityPrompt(p)))
  if (preset) return { personality: preset, custom: '' }
  // Drop the header Murmur writes; anything else is the person's own words.
  const body = soul.replace(/^# [^\n]*\n\nYou are [^\n]*\n\n/, '').trim()
  return { personality: 'custom', custom: body }
}

export async function fetchSoul(id: string) {
  const res = await api.get<{ content?: string }>(`/api/profiles/${encodeURIComponent(id)}/soul`)
  return res.content ?? ''
}

// ── Creating, editing, deleting ─────────────────────────────────────────────

const RESERVED = new Set(['hermes', 'default', 'test', 'tmp', 'root', 'sudo'])

/** A profile name from a display name: "Zoë's Helper" → "zoes-helper". */
export function slugFor(name: string, taken: Iterable<string>) {
  const used = new Set(taken)
  const base =
    devPrefix() +
    (name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'agent')
  let slug = base
  for (let n = 2; RESERVED.has(slug) || used.has(slug); n++) slug = `${base}-${n}`
  return slug
}

export type AgentInput = {
  name: string
  hue: number
  role: string
  /** Full SOUL.md; omitted on edits that didn't touch the personality. */
  soul?: string
  /** The template it starts from (see features/templates); kept on edits. */
  template?: string
}

const look = (input: AgentInput, botMeta?: Record<string, unknown>, murmurMeta?: Record<string, unknown>) => ({
  murmur: { ...murmurMeta, hue: input.hue, ...(input.template ? { template: input.template } : {}) },
  'hermes-bots': { imageKind: 'shape', created: Date.now(), ...botMeta, title: input.name, color: hueHex(input.hue) },
})

/** Write a look that didn't make it (the tab closed mid-create), once. */
const finishing = new Set<string>()
async function finishLook(p: Profile, meta: Record<string, unknown>) {
  if (finishing.has(p.name)) return
  if (record(p.ui_meta?.murmur)) return setPendingLook(p.name)
  finishing.add(p.name)
  try {
    // Only the records Hermes lacks: one it has was written since, on top of this look
    // (the agent filed on a section, say), and is newer than it.
    const missing = Object.fromEntries(Object.entries(meta).filter(([key]) => !record(p.ui_meta?.[key])))
    await rpc('profiles.configure', { name: p.name, ui_meta: missing })
    setPendingLook(p.name)
  } catch {
    // Try again on the next read.
  } finally {
    finishing.delete(p.name)
  }
}

/**
 * Create an agent and return its id. It shares the main agent's model accounts.
 * It stays out of the roster until `revealAgent(id)`, so its arrival can be
 * staged; call that even if the caller doesn't stage anything.
 */
export async function createAgent(input: AgentInput) {
  const id = slugFor(input.name, await listProfileNames())
  const meta = look(input)
  // Its look is known before Hermes knows the agent, so no read ever shows a slug.
  rememberHue(id, input.hue)
  setPendingLook(id, meta)
  hatching.add(id)
  try {
    // The socket twin of POST /api/profiles: unlike REST it also carries over
    // API keys, so the new agent can think straight away.
    await rpc('profiles.create', { name: id, description: input.role, soul: input.soul, share_auth: true }, 120_000)
  } catch (e) {
    hatching.delete(id)
    setPendingLook(id)
    throw e
  }
  // Set before Hermes's scheduler first reads it, so no restart is needed. It
  // can take Hermes a while and the agent doesn't need it to talk: no waiting.
  void ensureAgentTimezone(id, { restart: false }).catch(() => {})
  // Its chats from Murmur shouldn't reach for tools only Hermes Desktop can show.
  void hideDesktopToolsets(id).catch(() => {})
  // On an Umbrel, what the main agent knows about running there (Umbrel's Hermes only gives it to the main agent).
  void ensureUmbrelContext(id).catch(() => {})
  void ensureUmbrelMcp(id).catch(() => {})
  // Hermes copies the main agent's .env into a new agent, its email password included: not this agent's to keep.
  void forgetInheritedMail(id).catch(() => {})
  await rpc('profiles.configure', { name: id, ui_meta: meta }).then(
    () => setPendingLook(id),
    () => {}, // Left pending: the next read retries it.
  )
  return id
}

/** Let a just-made agent into the roster (see createAgent). */
export function revealAgent(id: string) {
  hatching.delete(id)
}

export async function updateAgent(agent: Agent, input: AgentInput) {
  rememberHue(agent.id, input.hue)
  // The look goes on top of what the agent holds when it's saved, not when the editor opened:
  // Hermes Desktop, or Murmur on another device, may have filed it on a section since.
  await writeMeta(agent.id, agent, (now) => look(input, now.botMeta, now.murmurMeta), {
    rest: { description: input.role, ...(input.soul !== undefined ? { soul: input.soul } : {}) },
  })
}

/** An agent as Hermes holds it now (without its chats, which take longer to read). */
export async function readAgent(id: string) {
  const p = (await listProfiles<Profile>({ include_sessions: false })).find((x) => x.name === id)
  return p && toAgent(p)
}

type Configured = {
  applied?: { ui_meta?: boolean; ui_meta_revisions?: Record<string, number>; ui_meta_conflicts?: Record<string, unknown> }
}

const TRIES = 3

/**
 * Write some of an agent's ui_meta records, as `make` builds them from the
 * agent. Each is a change to what's there, not a copy of what was last seen:
 * Hermes takes the write only if nobody else (Hermes Desktop, Murmur on another
 * device) has written those records since `agent` was read, and when somebody
 * has, the agent is read again (through `fresh`, which can fold it into what
 * the caller keeps) and `make` runs on top of theirs. An older Hermes keeps no
 * revisions and takes the write as it comes. `rest` (a description, a soul)
 * goes with the first try. Returns the records' new revisions.
 */
export async function writeMeta(
  id: string,
  agent: Agent | undefined,
  make: (agent: Agent) => Record<string, unknown>,
  {
    rest = {},
    fresh = (a) => a,
  }: { rest?: Record<string, unknown>; fresh?: (agent: Agent) => Agent | undefined } = {},
): Promise<Record<string, number> | undefined> {
  for (let tries = 1; agent; tries++) {
    const records = make(agent)
    const revisions = agent.metaRevisions
    const res = await rpc<Configured>('profiles.configure', {
      name: id,
      ...(tries === 1 && rest),
      ui_meta: records,
      ...(revisions && {
        ui_meta_expected_revisions: Object.fromEntries(Object.keys(records).map((key) => [key, revisions[key] ?? 0])),
      }),
    })
    if (res.applied?.ui_meta !== false) return res.applied?.ui_meta_revisions
    if (!res.applied.ui_meta_conflicts || tries === TRIES) throw new Error('Hermes didn’t save the change.')
    const now = await readAgent(id)
    agent = now && fresh(now)
  }
}

/** Remove an agent with its chats and memory. The main agent can't be deleted. */
export async function deleteAgent(agent: Agent) {
  if (agent.isDefault) throw new Error('The main agent can’t be deleted.')
  await api.delete(`/api/profiles/${encodeURIComponent(agent.id)}`)
  setPendingLook(agent.id)
}

// ── Chats per agent ─────────────────────────────────────────────────────────

export type ChatSummary = {
  id: string
  title: string
  preview: string
  startedAt: number
  messageCount: number
  source: string
  /** The agent's main chat (Hermes Desktop's "Bot Chat"). */
  main?: boolean
}

/** Hermes Desktop keeps each agent's main conversation in a hidden chat with this exact title. */
export const BOT_CHAT = 'Bot Chat'
export const MAIN_CHAT = 'Main chat'

export type SessionRow = {
  id: string
  resolved_id?: string
  title?: string
  preview?: string
  started_at?: number
  message_count?: number
  source?: string
}

export const toSummary = (s: SessionRow): ChatSummary => ({
  id: s.id,
  // Titles cut off mid-path name a fragment of a file; the preview reads better.
  title: readable(s.title, { files: false }) || readable(s.preview) || 'New chat',
  preview: readable(s.preview),
  startedAt: (s.started_at ?? 0) * 1000,
  messageCount: s.message_count ?? 0,
  source: s.source ?? '',
})

/**
 * An agent's chats, most recent first. Hermes hides the main chat that Hermes
 * Desktop keeps ("Bot Chat") from its lists, so it's looked up by title and
 * slotted in by recency; other hidden chats (group plumbing) stay out.
 */
export async function fetchAgentChats(profile: string, limit = 60): Promise<ChatSummary[]> {
  const [shown, all, main] = await Promise.all([
    rpc<{ sessions: SessionRow[] }>('session.list', { profile, limit }),
    // Only for where the main chat sits: this list is in order of last activity.
    rpc<{ sessions: SessionRow[] }>('session.list', { profile, limit, include_hidden: true }).catch(() => ({ sessions: [] })),
    rpc<{ sessions: SessionRow[] }>('session.list', { profile, title: BOT_CHAT, include_hidden: true }).catch(() => ({ sessions: [] })),
  ])
  // These aren't routines' runs, so opening one needn't ask.
  for (const s of shown.sessions) if (s.source !== 'cron') knowRun(profile, s.id, null)
  const chats = shown.sessions.filter((s) => s.source !== 'cron' && (s.message_count ?? 0) > 0).map(toSummary)
  const row = main.sessions.find((s) => s.title === BOT_CHAT && (s.message_count ?? 0) > 0)
  if (!row) return chats
  const id = row.resolved_id || row.id
  const ids = new Set([row.id, id])
  const rest = chats.filter((c) => !ids.has(c.id))
  const order = all.sessions.map((s) => s.id)
  const at = order.findIndex((x) => ids.has(x))
  // Everything listed before it in activity order is newer; unknown means older than the window.
  const index = at < 0 ? rest.length : rest.filter((c) => order.indexOf(c.id) !== -1 && order.indexOf(c.id) < at).length
  const summary: ChatSummary = { ...toSummary({ ...row, id }), title: MAIN_CHAT, main: true }
  return [...rest.slice(0, index), summary, ...rest.slice(index)]
}

export function useAgentChats(profile: string | undefined) {
  return useQuery({
    queryKey: ['chats', profile],
    enabled: Boolean(profile),
    queryFn: () => fetchAgentChats(profile!),
    staleTime: 10_000,
  })
}

/** Where a chat came from, when it wasn't Murmur or the Hermes apps. */
export function sourceLabel(source: string) {
  const map: Record<string, string> = {
    telegram: 'Telegram',
    discord: 'Discord',
    slack: 'Slack',
    whatsapp: 'WhatsApp',
    signal: 'Signal',
    email: 'Email',
    sms: 'SMS',
    matrix: 'Matrix',
    routine: 'Routine',
  }
  return map[source.toLowerCase()]
}
