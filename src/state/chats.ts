// Live chats. Hermes streams events for every session over one socket; this
// store folds them into ChatItems that the UI renders.
//
// Ids: Hermes gives each chat a stored id (permanent, e.g. "20261013_122615_…")
// and a runtime id while it's live in memory (8 hex chars, reaped ~20s after
// the last viewer leaves). Everything here is keyed by the stored id; the
// runtime id is only used to talk to Hermes and to route its events.

import { create } from 'zustand'
import { gateway, rpc, type GatewayEvent, type ServerRequest } from '@/hermes/gateway'
import { api, HermesError } from '@/hermes/rest'
import { isMissingMethod } from '@/hermes/compat'
import { restoreChatConnect } from '@/state/hosted-apps-chat'
import type { ConnectionRequestPayload } from '@/hermes/vendor/gateway-contract.generated'
import { foundSubjects, readingLabel, resultLabel, toolLabel } from '@/features/chat/tool-labels'
import { approvalText, detailOf, isCallTo, toolAsked, type ToolCall } from '@/features/chat/approval-text'
import { explainError } from '@/features/chat/errors'
import type { ApprovalChoice, ChatItem, ChatStatus, ClarifyQuestion, Reaction, SecretAsk, Speaker } from '@/features/chat/types'
import { fileRef, parseUserMessage, rememberUpload, type UserAttachment } from '@/features/media/parse'
import { toolMedia } from '@/features/media/tool-media'
import { scoped } from '@/hermes/instance'
import {
  isTodoTool,
  planFromResult,
  reactionsOf,
  settleHelpers,
  startsTurn,
  errandOf,
  todosOf,
  toggled,
  withErrand,
  withHelper,
  withPlan,
  withPreview,
  withReactions,
} from '@/features/chat/live'
import { errandsOf, isYours, sentItems, wakeItems, withSeenHelpers, type Errand } from '@/features/chat/wake'

export type Chat = {
  id: string
  profile: string
  runtimeId?: string
  items: ChatItem[]
  status: ChatStatus
  title?: string
  model?: string
  provider?: string
  reasoning?: string
  /** History has been loaded (or the chat is brand new). */
  ready: boolean
  /** History couldn't be read for a while: it's still being tried, and you can ask for it now. */
  stalled?: boolean
  /** Hermes has older history than what's been read: loadOlder brings it in. */
  older?: boolean
  /** Speaker for one-to-one chats; group chats tag items individually. */
  speaker?: Speaker
  /** Counts finished replies, so widgets know to re-read files the agent may have rewritten. */
  turns?: number
  /** What the agent is working toward (/goal), while one is set. */
  goal?: Goal
  /** Counts the times you've been sweet to the agent (thanks, <3), so its face can show it. */
  vibes?: number
  /** A turn begun elsewhere (a helper back, say) that this page hasn't shown yet: working, for lists. */
  starting?: boolean
}

export type Goal = { title: string; status: string }

type State = { chats: Record<string, Chat> }

export const useChats = create<State>(() => ({ chats: {} }))

const runtimeToStored = new Map<string, string>()
const requests = new Map<string, ServerRequest>()
/** Requests for a runtime id we haven't bound yet: `session.resume` delivers
 *  its open_requests just before its own result, so they wait for the bind. */
const parked = new Map<string, ServerRequest[]>()
let attaching = 0
/** Reasoning that may just echo the answer (a Codex quirk) — held until complete. */
const pendingReasoning = new Map<string, string>()
/** Each chat's tool calls still running, so an approval about one can say what it will act on. */
const runningCalls = new Map<string, Map<string, ToolCall>>()

let n = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(n++).toString(36)}`

// ── Store helpers ───────────────────────────────────────────────────────────

function patch(id: string, fn: (c: Chat) => Partial<Chat> | void) {
  useChats.setState((s) => {
    const chat = s.chats[id]
    if (!chat) return s
    const next = fn(chat)
    return next ? { chats: { ...s.chats, [id]: { ...chat, ...next } } } : s
  })
}

function ensure(id: string, profile: string) {
  if (!useChats.getState().chats[id]) {
    useChats.setState((s) => ({
      chats: { ...s.chats, [id]: { id, profile, items: [], status: 'idle', ready: false } },
    }))
  }
}

function bindRuntime(id: string, runtimeId: string) {
  runtimeToStored.set(runtimeId, id)
  patch(id, () => ({ runtimeId }))
  const waiting = parked.get(runtimeId)
  parked.delete(runtimeId)
  waiting?.forEach(onServerRequest)
}

/**
 * Resume a runtime that another store routes (a group member's copy of a
 * room). What it re-delivers waits with ours, and is handed back with it.
 */
export async function resumeHolding<T extends { session_id: string }>(call: () => Promise<T>) {
  attaching++
  try {
    const res = await call()
    const held = parked.get(res.session_id) ?? []
    parked.delete(res.session_id)
    return { res, held }
  } finally {
    attaching--
  }
}

export const getChat = (id: string) => useChats.getState().chats[id]

// ── History ─────────────────────────────────────────────────────────────────

type Row = {
  id?: number
  role: string
  content?: string | null
  tool_calls?: { id?: string; call_id?: string; function?: { name: string; arguments?: string } }[] | null
  tool_call_id?: string | null
  tool_name?: string | null
  reasoning?: string | null
  display_kind?: string | null
  display_metadata?: { reactions?: unknown } | null
  /** What Hermes shows for your message when that isn't its content: a request carried inside a chat's summary, say. */
  display_content?: string | null
  timestamp?: number
}

/** The agent's tapbacks land on the message itself; a step saying so would narrate it. */
const QUIET_TOOLS = new Set(['react_to_message'])
const INTERRUPTED = /^\s*Operation interrupted\b/
const STEER = /^\s*\[OUT-OF-BAND USER MESSAGE[^\]]*\]\s*([\s\S]*?)\s*\[\/OUT-OF-BAND USER MESSAGE\]\s*$/

/** A stored call, or the calls a "tool_call" made: `{"calls":[{"name":"mcp__umbrel__…","arguments":{…}}]}`. */
function viaToolCall(name = 'tool', args?: unknown): { name: string; args?: unknown }[] {
  if (name !== 'tool_call') return [{ name, args }]
  try {
    const parsed = (typeof args === 'string' ? JSON.parse(args) : args) as { calls?: unknown }
    const calls = Array.isArray(parsed?.calls) ? (parsed.calls as { name?: unknown; arguments?: unknown }[]) : []
    const named = calls.filter((c) => typeof c?.name === 'string')
    if (named.length) return named.map((c) => ({ name: String(c.name), args: c.arguments }))
  } catch {
    /* not the shape we know: keep the call as it was */
  }
  return [{ name, args }]
}

/** Reading an email the agent found earlier in the chat: "Reading ‘<its subject>’" from the start. */
function mailRead(name: string, args: unknown, subjects: Map<string, string> | undefined) {
  if (name !== 'email_read' || !subjects) return undefined
  let parsed = args
  try {
    if (typeof args === 'string') parsed = JSON.parse(args)
  } catch {
    return undefined
  }
  const id = (parsed as { id?: unknown } | null)?.id
  const subject = typeof id === 'string' ? subjects.get(id) : undefined
  return subject ? readingLabel(subject) : undefined
}

/** Per live chat: what its email searches found (message id → subject). */
const mailSubjects = new Map<string, Map<string, string>>()

/** `errands`: the helpers the agent sent off, from these rows or a wider look at the chat. */
function rowsToItems(rows: Row[], speaker?: Speaker, errands: Map<string, Errand> = errandsOf(rows)): ChatItem[] {
  const items: ChatItem[] = []
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>[]>()
  const plans = new Set<string>()
  // What the agent's email searches found, so a read says which email.
  const subjects = new Map<string, string>()
  for (const [n, row] of rows.entries()) {
    const at = (row.timestamp ?? 0) * 1000
    const key = `h${row.id ?? items.length}`
    // Hidden turns aren't for the person at all.
    if (row.display_kind === 'hidden') continue
    // Hermes writing in the person's name: waking the agent (a helper back, say) or a note to the model.
    if (row.role === 'user' && !isYours(row)) {
      items.push(...wakeItems(row, key, errands, rows[n + 1]?.role === 'assistant'))
      continue
    }
    if (row.role === 'user') {
      const shown = typeof row.display_content === 'string' ? row.display_content : undefined
      const raw = shown ?? row.content ?? ''
      // A message sent mid-reply is stored wrapped in Hermes's steering markers (an older Hermes shows them).
      const { text, attachments } = parseUserMessage(
        row.display_kind === 'steer' && shown == null ? (STEER.exec(raw)?.[1] ?? raw) : raw,
      )
      if (text || attachments.length) {
        items.push({
          kind: 'user',
          id: key,
          text,
          at,
          attachments: attachments.length ? attachments : undefined,
          rowId: row.id,
          reactions: reactionsOf(row.display_metadata?.reactions),
        })
      }
    } else if (row.role === 'assistant') {
      if (row.display_kind === 'failed_turn') {
        items.push({ kind: 'notice', id: key, text: 'This reply was stopped before it finished.' })
        continue
      }
      // Stop pressed mid-reply: Hermes saves its own note as the reply. Say what it said live.
      if (INTERRUPTED.test(row.content ?? '') && !row.tool_calls?.length) {
        if (items.at(-1)?.kind !== 'notice') items.push({ kind: 'notice', id: key, text: 'Stopped' })
        continue
      }
      if (row.reasoning?.trim()) {
        items.push({
          kind: 'thinking',
          id: `${key}-r`,
          text: row.reasoning.trim(),
          streaming: false,
          startedAt: at,
          endedAt: at,
          speaker,
        })
      }
      // The model writes before it calls tools: its words go first.
      const text = row.content?.trim()
      if (text) {
        const reactions = reactionsOf(row.display_metadata?.reactions)
        items.push({ kind: 'assistant', id: key, text, streaming: false, at, speaker, rowId: row.id, reactions })
      }
      for (const call of row.tool_calls ?? []) {
        const callId = call.id ?? call.call_id
        // Tools reached through Hermes's tool search are stored as one "tool_call" wrapping the real calls.
        const calls = viaToolCall(call.function?.name, call.function?.arguments)
        // The checklist (and the agent's tapbacks) show as themselves, not as steps.
        if (calls.every((c) => isTodoTool(c.name) || QUIET_TOOLS.has(c.name))) {
          if (calls.some((c) => isTodoTool(c.name))) for (const id of [call.id, call.call_id]) if (id) plans.add(id)
          continue
        }
        const steps = calls.map(({ name, args }, n) => {
          const label = toolLabel(name, args)
          const tool: Extract<ChatItem, { kind: 'tool' }> = {
            kind: 'tool',
            id: `${key}-${callId}${n ? `-${n}` : ''}`,
            callId: n ? undefined : callId,
            name,
            label: mailRead(name, args, subjects) ?? label.label,
            detail: label.detail,
            app: label.app,
            // Done once its result row turns up; one still waiting (on your OK, say) is still going.
            status: 'running',
            startedAt: at,
            speaker,
          }
          return tool
        })
        items.push(...steps)
        if (call.id) tools.set(call.id, steps)
        if (call.call_id) tools.set(call.call_id, steps)
      }
    } else if (row.role === 'tool' && row.tool_call_id && plans.has(row.tool_call_id)) {
      const plan = planFromResult(row.content)
      if (plan) items.splice(0, items.length, ...withPlan(items, plan.todos, plan.revision, `${key}-plan`))
    } else if (row.role === 'tool' && row.tool_call_id) {
      const steps = tools.get(row.tool_call_id) ?? []
      // Helpers sent off to work in the background: their card takes the place of the step that sent them.
      const sent = sentItems(row, errands)
      if (sent.length) {
        const gone = new Set<ChatItem>(steps)
        items.splice(0, items.length, ...items.filter((i) => !gone.has(i)), ...sent)
        continue
      }
      for (const tool of steps) {
        tool.status = /"exit_code":\s*-1|BLOCKED:|"error":\s*"/.test(row.content ?? '') ? 'error' : 'done'
        tool.endedAt = (row.timestamp ?? 0) * 1000
        tool.label = resultLabel(tool.name, row.content) ?? tool.label
        for (const [id, subject] of foundSubjects(tool.name, row.content)) subjects.set(id, subject)
        const media = toolMedia(tool.name, row.content)
        if (media.length) tool.media = media
      }
    }
  }
  return items
}

/** The most rows Hermes sends at once. A page that full may have older rows behind it. */
const PAGE = 500

/** A chat's saved rows, oldest first: its newest page, or the one `offset` rows back from its end. */
async function readRows(id: string, profile: string, offset = 0) {
  type Res = { messages?: Row[]; data?: Row[] }
  const res = await api.get<Res>(
    `/api/sessions/${encodeURIComponent(id)}/messages?profile=${encodeURIComponent(profile)}&order=latest&limit=${PAGE}${offset ? `&offset=${offset}` : ''}`,
  )
  const rows = res.messages ?? res.data ?? []
  // "latest" pages from the end; put them back in reading order.
  if (rows.length > 1 && (rows[0].id ?? 0) > (rows.at(-1)!.id ?? 0)) rows.reverse()
  return rows
}

/** How far back each chat's history has been read: the oldest rows read, and how many rows from the end they reach. */
const reach = new Map<string, { rows: Row[]; offset: number }>()

const reading = new Map<string, Promise<void>>()

/** Bring in the page of a chat's history before the oldest one read. */
export function loadOlder(id: string) {
  let task = reading.get(id)
  if (!task) {
    task = readOlder(id).finally(() => reading.delete(id))
    reading.set(id, task)
  }
  return task
}

async function readOlder(id: string) {
  const chat = getChat(id)
  const read = reach.get(id)
  if (!chat?.older || !read) return
  const page = await readRows(id, chat.profile, read.offset)
  // Rows saved since push every page back a little: what's already read is left out.
  const first = read.rows[0]?.id ?? Infinity
  const rows = page.filter((r) => (r.id ?? 0) < first)
  reach.set(id, { rows: rows.length ? rows : read.rows, offset: read.offset + page.length })
  // Read with the rows after them, so a step whose result is on the newer page shows as done.
  const items = rowsToItems([...rows, ...read.rows], chat.speaker)
  patch(id, (c) => {
    const shown = new Set(c.items.map((i) => i.id))
    const at = items.findIndex((i) => shown.has(i.id))
    return { items: [...items.slice(0, at < 0 ? items.length : at), ...c.items], older: page.length >= PAGE }
  })
}

const rowOf = (i: ChatItem) => (i.kind === 'user' || i.kind === 'assistant' || i.kind === 'wake' ? i.rowId : undefined)

/**
 * A turn this page didn't start: sent from another device, or an edit, retry
 * or queued turn begun elsewhere. Its message never came through here, but
 * Hermes saved it before the turn began, so take the chat as saved up to that
 * message and keep what has streamed in since. With `live` false the turn is
 * over (we were away for it) and the whole saved chat is taken. Messages
 * already on screen stay as they are; `before` is what was on screen when
 * the turn began, so what has come in since stays too. Says whether anything
 * was missing.
 */
async function catchUp(id: string, live: boolean, before = new Set(getChat(id)?.items.map((i) => i.id))) {
  const chat = getChat(id)
  if (!chat?.ready) return false
  const shown = new Map(chat.items.flatMap((i) => (rowOf(i) != null ? [[rowOf(i)!, i] as const] : [])))
  const rows = await readRows(id, chat.profile).catch(() => [] as Row[])
  // The turn ended while we read: its end takes the whole saved chat instead.
  if (live && !begunElsewhere.has(id)) return false
  // The turn's own message (yours or Hermes's), hidden ones included. Rows
  // after it are the turn's steps so far, which are already streaming in.
  const at = rows.findLastIndex((r) => r.role === 'user')
  // Compared with what started a turn on screen: a reply this page saw can be saved after that message.
  const opened = chat.items.flatMap((i) => (startsTurn(i) && rowOf(i) != null ? [rowOf(i)!] : []))
  if (at < 0 || (rows[at].id ?? 0) <= Math.max(0, ...opened)) return false
  const errands = errandsOf(rows)
  const earlier = rowsToItems(rows.slice(0, live ? at : rows.length), chat.speaker, errands).map(
    (i) => shown.get(rowOf(i) ?? -1) ?? i,
  )
  const prompt = live ? rowsToItems([rows[at]], chat.speaker, errands) : []
  patch(id, (c) => {
    // Pages read from further back stay ahead of the newest one.
    const ids = new Set(earlier.map((i) => i.id))
    const from = c.items.findIndex((i) => ids.has(i.id))
    const back = c.items.slice(0, Math.max(0, from))
    const items = [
      ...(back.some((i) => (rowOf(i) ?? Infinity) < (rows[0].id ?? 0)) ? back : []),
      ...earlier,
      // Side questions and commands live only on this page.
      ...c.items.filter((i) => before.has(i.id) && isSide(i)),
      ...prompt,
      ...c.items.filter((i) => !before.has(i.id)),
    ]
    // A read that overlapped another brings in what that one already did: each item once.
    const seen = new Set<string>()
    const once = items.filter((i) => !seen.has(i.id) && seen.add(i.id))
    // Helpers this page watched keep what it saw of them (what each said, how long it took).
    return { items: withSeenHelpers(once, c.items) }
  })
  return true
}

/**
 * A turn begun elsewhere, brought in as it starts. Hermes saves a wake's
 * message just after it starts the turn, so look again a few times, keeping
 * what streams in meanwhile; the turn's end catches up on anything still missing.
 */
async function catchUpTurn(id: string) {
  const before = new Set(getChat(id)?.items.map((i) => i.id))
  for (const wait of [0, 250, 500, 1000, 2000]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    if (!begunElsewhere.has(id) || (await catchUp(id, true, before))) return
  }
}

// ── Opening and creating chats ──────────────────────────────────────────────

type ResumeResult = {
  session_id: string
  running?: boolean
  status?: string
  inflight?: { assistant?: string; streaming?: boolean }
  info?: { model?: string; provider?: string; reasoning_effort?: string; title?: string }
  todo_state?: { todos?: unknown; revision?: number } | null
  /** An app the agent asked to connect, still waiting on the person (state/hosted-apps-chat.ts). */
  pending_connection?: ConnectionRequestPayload | null
}

const opening = new Map<string, Promise<void>>()
/** Chats on screen. A reconnect re-attaches these (and anything busy); the rest wait until they're needed. */
const viewing = new Set<string>()
/** When each chat last started a turn here, so a resume answered from before it can't call it idle. */
const asked = new Map<string, number>()
/** Chats in a turn this page didn't start (sent elsewhere, or Hermes waking the agent). */
const begunElsewhere = new Set<string>()

/** Load a stored chat and attach to it so its live events reach us. */
export function openChat(id: string, profile: string, speaker?: Speaker): Promise<void> {
  ensure(id, profile)
  patch(id, () => ({ speaker }))
  viewing.add(id)
  const chat = getChat(id)!
  if (chat.ready && chat.runtimeId) return Promise.resolve()
  const existing = opening.get(id)
  if (existing) return existing
  const task = (async () => {
    try {
      if (!chat.ready && !(await readHistory(id, profile, speaker))) return
      await attach(id, true)
    } finally {
      opening.delete(id)
    }
  })()
  opening.set(id, task)
  return task
}

/**
 * Read a chat's history until it's read: a read that fails is tried again,
 * soon and then less often, and at once when the app or Hermes comes back or
 * you ask. Only a chat Hermes doesn't have yet opens empty; one that can't be
 * read never does. False if the chat was left first.
 */
async function readHistory(id: string, profile: string, speaker?: Speaker) {
  for (let tries = 0; ; tries++) {
    let rows: Row[]
    try {
      rows = await readRows(id, profile)
    } catch (e) {
      if (!(e instanceof HermesError && e.status === 404)) {
        // A few seconds of trying, then it says so.
        if (tries === 2) patch(id, () => ({ stalled: true }))
        await nextTry(id, Math.min(30_000, 1000 * 2 ** tries))
        if (!viewing.has(id)) return false
        continue
      }
      rows = []
    }
    const items = rowsToItems(rows, speaker)
    reach.set(id, { rows, offset: rows.length })
    // Anything sent while it loaded comes after the history, once: a message
    // Hermes saved meanwhile is in the history already.
    const saved = new Set(items.map(rowOf))
    patch(id, (c) => ({
      items: [...items, ...c.items.filter((i) => rowOf(i) == null || !saved.has(rowOf(i)))],
      ready: true,
      stalled: undefined,
      older: rows.length >= PAGE,
    }))
    return true
  }
}

/** Chats waiting to try their history again, and how to stop the wait. */
const unread = new Map<string, () => void>()

function nextTry(id: string, ms: number) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(go, ms)
    function go() {
      window.clearTimeout(timer)
      unread.delete(id)
      resolve()
    }
    unread.set(id, go)
  })
}

/** Read any history that couldn't be read, now. */
export function readUnread() {
  for (const go of [...unread.values()]) go()
}

/** The chat is off screen. Hermes lets it go once nothing holds it (see the reconnect below). */
export function leaveChat(id: string) {
  viewing.delete(id)
  // Its history stops being tried; coming back tries at once.
  unread.get(id)?.()
}

const resuming = new Map<string, Promise<void>>()

/** `first`: this page has never seen the chat live, so adopt any in-flight reply. */
function attach(id: string, first = false) {
  let task = resuming.get(id)
  if (!task) {
    task = resume(id, first).finally(() => resuming.delete(id))
    resuming.set(id, task)
  }
  return task
}

async function resume(id: string, first: boolean) {
  const chat = getChat(id)
  if (!chat) return
  const since = Date.now()
  // Mid-turn when the connection dropped: if the turn is over now, this page never saw it end.
  const wasBusy = isBusy(chat)
  const turns = chat.turns ?? 0
  attaching++
  let res: ResumeResult
  try {
    res = await rpc<ResumeResult>('session.resume', {
      session_id: id,
      profile: chat.profile,
      // The agent is rebuilt on resume, and its sense of where it is comes from
      // this, not the stored chat. Unsaid, Hermes assumes its terminal ("no
      // attachments here") and the agent stops sending files.
      source: 'desktop',
      omit_messages: true,
      lazy: true,
    })
  } finally {
    attaching--
  }
  bindRuntime(id, res.session_id)
  restoreChatConnect(res.session_id, res.pending_connection)
  if (!attaching) parked.clear()
  const busy = res.running || ['working', 'streaming', 'starting'].includes(res.status ?? '')
  // A message sent while we asked started a turn this answer doesn't know about.
  const fresher = (asked.get(id) ?? 0) >= since
  patch(id, (c) => {
    // Steps from history with no result are still going only if the turn is.
    let items = busy
      ? c.items
      : c.items.map((i): ChatItem => (i.kind === 'tool' && i.status === 'running' ? { ...i, status: 'done' } : i))
    // A reply was mid-stream when we arrived: show what it has so far.
    // (On a reconnect, the replayed events carry it instead.)
    const partial = first ? res.inflight?.assistant?.trim() : undefined
    if (busy && partial && flowTail(items).item?.kind !== 'assistant' && !saidSinceAsked(items, partial)) {
      items = [
        ...items,
        { kind: 'assistant', id: uid('a'), text: partial, streaming: true, at: Date.now(), speaker: c.speaker },
      ]
    }
    // Mid-reply: its checklist as it stands now.
    const todos = busy ? todosOf(res.todo_state?.todos) : null
    if (todos) items = withPlan(items, todos, Number(res.todo_state?.revision) || 0, uid('plan'))
    return {
      items,
      status: hasPending(items) ? 'waiting' : busy ? 'working' : fresher && isBusy(c) ? c.status : 'idle',
      model: res.info?.model ?? c.model,
      provider: res.info?.provider ?? c.provider,
      reasoning: res.info?.reasoning_effort ?? c.reasoning,
    }
  })
  // Finished while we were away: give any replay a moment, then catch up on
  // turns it couldn't bring back. The turn this page was in counts as ended
  // only once its end arrives, which bumps `turns`.
  if (!busy && !fresher && !first) {
    window.setTimeout(() => {
      const c = getChat(id)
      if (!c || isBusy(c) || (asked.get(id) ?? 0) >= since) return
      void catchUp(id, false).then((caught) => {
        if (!caught && wasBusy && (getChat(id)?.turns ?? 0) === turns) return takeSavedTurn(id, since)
      })
    }, 1500)
  }
  if (first) void restorePick(id, res.info)
  void readGoal(id)
}

/**
 * The turn this page was in when the connection dropped has ended, and
 * nothing replayed its end: a long turn outruns Hermes's replay window (512
 * events), or Hermes restarted. Settle what was still live, then show the
 * turn as Hermes saved it, everything after the message that started it.
 */
async function takeSavedTurn(id: string, since: number) {
  const chat = getChat(id)
  if (!chat || (asked.get(id) ?? 0) >= since || chat.status === 'waiting') return
  patch(id, (c) => ({ items: settle(c.items), status: 'idle' }))
  const start = chat.items.findLast(startsTurn)
  const row = start && rowOf(start)
  if (!start || row == null) return
  const rows = await readRows(id, chat.profile).catch(() => [] as Row[])
  const at = rows.findIndex((r) => r.id === row)
  const saved = at < 0 ? [] : rowsToItems(rows.slice(at + 1), chat.speaker, errandsOf(rows))
  if (!saved.length) return
  patch(id, (c) => {
    const from = c.items.findIndex((i) => i.id === start.id)
    if (from < 0 || (asked.get(id) ?? 0) >= since) return
    // Side questions and commands live only on this page.
    const items = [...c.items.slice(0, from + 1), ...saved, ...c.items.slice(from + 1).filter(isSide)]
    // Helpers this page watched keep what it saw of them.
    return { items: withSeenHelpers(items, c.items) }
  })
}

// ── Per-chat model choices ──────────────────────────────────────────────────
// Hermes forgets a chat's model once it lets the chat go (thinking survives,
// but isn't reported back), so this browser remembers both and puts them back.

type Pick = { model?: string; provider?: string; reasoning?: string }
const PICK = scoped('murmur:chat-pick:')

function readPick(id: string): Pick | null {
  try {
    return JSON.parse(localStorage.getItem(PICK + id) ?? 'null') as Pick | null
  } catch {
    return null
  }
}

function savePick(id: string, next: Pick | null) {
  try {
    const merged = next && { ...readPick(id), ...next }
    if (merged && Object.values(merged).some(Boolean)) localStorage.setItem(PICK + id, JSON.stringify(merged))
    else localStorage.removeItem(PICK + id)
  } catch {
    /* private mode: the choice lasts as long as the chat stays live */
  }
}

async function restorePick(id: string, info: ResumeResult['info']) {
  const saved = readPick(id)
  if (!saved) return
  try {
    if (saved.reasoning) patch(id, () => ({ reasoning: saved.reasoning }))
    if (saved.model && saved.provider && saved.model !== info?.model) {
      // (Switching models re-applies the thinking level too.)
      await setChatModel(id, saved.model, saved.provider)
    } else if (saved.reasoning && saved.reasoning !== info?.reasoning_effort) {
      await setChatReasoning(id, saved.reasoning)
    }
  } catch {
    /* it shows what Hermes is really using */
  }
}

type ControlSnapshot = { goal?: { title?: string; status?: string } | null }

function goalOf(control?: ControlSnapshot): Goal | undefined {
  const goal = control?.goal
  return goal?.title && goal.status !== 'cleared' && goal.status !== 'done' ? { title: goal.title, status: goal.status ?? 'active' } : undefined
}

/** Any goal (/goal) the chat is working toward. */
async function readGoal(id: string) {
  const chat = getChat(id)
  if (!chat?.runtimeId) return
  try {
    const res = await rpc<{ control?: ControlSnapshot }>('session.control.read', {
      session_id: chat.runtimeId,
      profile: chat.profile,
    })
    patch(id, () => ({ goal: goalOf(res.control) }))
  } catch {
    /* older Hermes, or no stored chat yet: no goal to show */
  }
}

type CreateResult = { session_id: string; stored_session_id: string; info?: { model?: string; provider?: string } }

/** Start a fresh chat with an agent. Hermes only saves it once the first message is sent. */
export async function createChat(
  profile: string,
  opts: { speaker?: Speaker; model?: string; provider?: string; reasoning?: string; title?: string } = {},
) {
  const res = await rpc<CreateResult>('session.create', {
    profile,
    // Murmur is a graphical chat, so it runs as Hermes's desktop surface: the
    // agent learns it can deliver files (MEDIA:) and inline widgets
    // (::preview). Its pane-driving tools (terminal, preview, tours) ask for
    // things Murmur doesn't have; those requests are answered "not supported"
    // and the agent moves on.
    source: 'desktop',
    ...(opts.model && opts.provider ? { model: opts.model, provider: opts.provider } : {}),
    ...(opts.reasoning ? { reasoning_effort: opts.reasoning } : {}),
    ...(opts.title ? { title: opts.title } : {}),
  })
  const id = res.stored_session_id
  useChats.setState((s) => ({
    chats: {
      ...s.chats,
      [id]: {
        id,
        profile,
        items: [],
        status: 'idle',
        ready: true,
        speaker: opts.speaker,
        model: res.info?.model,
        provider: res.info?.provider,
        reasoning: opts.reasoning,
      },
    },
  }))
  bindRuntime(id, res.session_id)
  if (opts.model || opts.reasoning) savePick(id, { model: opts.model, provider: opts.provider, reasoning: opts.reasoning })
  return id
}

/** Make sure the chat is live in Hermes, re-attaching if it was reaped. */
async function live(id: string) {
  const chat = getChat(id)
  if (!chat) throw new Error('Unknown chat')
  if (!chat.runtimeId) await attach(id)
  return getChat(id)!.runtimeId!
}

/** Run an RPC on a chat, re-attaching once if Hermes forgot the runtime id. */
async function onChat<T>(id: string, method: string, params: Record<string, unknown> = {}) {
  const call = async () => rpc<T>(method, { session_id: await live(id), ...params })
  try {
    return await call()
  } catch (e) {
    if ((e as { code?: number }).code === 4001) {
      patch(id, () => ({ runtimeId: undefined }))
      return call()
    }
    throw e
  }
}

// ── Sending ─────────────────────────────────────────────────────────────────

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const isImage = (f: File) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(f.type)

/** The full prompt each message went out with (refs included), for Try again. */
const prompts = new Map<string, string>()

/** A message Hermes doesn't have yet: its words and files, so Try again can finish sending it. */
const unsent = new Map<string, { text: string; files: File[] }>()

/** Pictures you sent, shown from memory until their chat goes away. */
const pictures = new Map<string, string[]>()

/** What a message shows for its files: thumbnails for pictures, chips for the rest. */
export function attachmentsOf(files: File[]): UserAttachment[] {
  return files.map((f) =>
    isImage(f)
      ? { kind: 'image', name: f.name || 'Image', url: URL.createObjectURL(f) }
      : { kind: 'file', name: f.name || 'File', size: f.size },
  )
}

type SendOptions = {
  /** A caller that already showed the message keeps its id (and its thumbnails, from attachmentsOf(files)). */
  itemId?: string
  attachments?: UserAttachment[]
  /** What the bubble says, when it differs from what's sent (a command's message). */
  shown?: string
}

/**
 * Send a message, with any files. Images go to the model natively; other
 * files are staged in the chat's folder and referenced as `@file:` so Hermes
 * inlines them.
 */
export async function send(id: string, text: string, files: File[] = [], opts: SendOptions = {}) {
  const chat = getChat(id)
  if (!chat) return
  const { itemId = uid('u'), shown = text } = opts
  const busy = isBusy(chat)
  const attachments = opts.attachments ?? attachmentsOf(files)
  const urls = attachments.flatMap((a) => (a.kind === 'image' && a.url ? [a.url] : []))
  if (urls.length) pictures.set(id, [...(pictures.get(id) ?? []), ...urls])
  const item: ChatItem = {
    kind: 'user',
    id: itemId,
    text: shown,
    attachments: attachments.length ? attachments : undefined,
    at: Date.now(),
  }
  asked.set(id, Date.now())
  patch(id, (c) => ({ items: [...c.items, item], status: busy ? c.status : 'thinking' }))
  unsent.set(itemId, { text, files })
  await deliver(id, itemId, busy)
}

/**
 * Get a message to Hermes: its files up, then its words. Run again by Try
 * again, it sends only what didn't get there; a picture already up is queued
 * once more by where it is (still queued if Hermes kept the chat, gone if it
 * didn't: once either way).
 */
async function deliver(id: string, itemId: string, steer = false) {
  const chat = getChat(id)
  const message = unsent.get(itemId)
  if (!chat || !message) return
  const { text, files } = message
  try {
    const refs: string[] = []
    for (const [i, file] of files.entries()) {
      const up = attachmentOf(id, itemId, i)?.path
      if (isImage(file)) {
        if (up) {
          await onChat(id, 'image.detach', { path: up })
          await onChat(id, 'image.attach', { path: up })
          continue
        }
        const data = await readDataUrl(file)
        const res = await onChat<{ path?: string }>(id, 'image.attach_bytes', {
          content_base64: data.split(',')[1] ?? '',
          filename: file.name || 'image.png',
        })
        if (res.path) {
          placeAttachment(id, itemId, i, res.path)
          if (file.name) rememberUpload(res.path, file.name)
        }
      } else {
        if (up) {
          refs.push(fileRef(up))
          continue
        }
        // (PDFs too: pdf.attach needs poppler, which Hermes may not have.)
        const data = await readDataUrl(file)
        const res = await onChat<{ ref_text?: string; ref_path?: string }>(id, 'file.attach', {
          name: file.name || 'file',
          data_url: data.startsWith('data:;') ? data.replace('data:;', 'data:application/octet-stream;') : data,
        })
        if (res.ref_text) refs.push(res.ref_text)
        if (res.ref_path) placeAttachment(id, itemId, i, res.ref_path)
      }
    }
    const prompt = promptOf(refs, text)
    prompts.set(itemId, prompt)
    // While it's working, a new message steers the current reply instead of
    // waiting its turn — the way you'd interrupt a person mid-thought. (Before
    // the agent is up it can't be steered yet; then it waits its turn.)
    const steered =
      steer && !files.length && (await onChat(id, 'session.steer', { text: prompt }).then(() => true, () => false))
    if (!steered) {
      const res = await onChat<SubmitResult>(id, 'prompt.submit', { text: prompt, profile: chat.profile })
      if (res.user_row_id != null) setRowId(id, itemId, res.user_row_id)
    }
    unsent.delete(itemId)
  } catch (e) {
    patch(id, (c) => ({
      status: 'error',
      items: [...c.items, { kind: 'error', id: uid('e'), message: attachError(e), retryable: true }],
    }))
  }
}

/** A message's words with its files' refs ahead of them, the way it goes to Hermes. */
const promptOf = (refs: string[], text: string) =>
  [refs.join('\n'), text].filter(Boolean).join('\n\n') || 'What do you see in this image?'

function attachmentOf(id: string, itemId: string, index: number) {
  const item = getChat(id)?.items.find((i) => i.id === itemId)
  return item?.kind === 'user' ? item.attachments?.[index] : undefined
}

/** Where one of a message's files landed on Hermes: what lets it be sent again without sending it twice. */
function placeAttachment(id: string, itemId: string, index: number, path: string) {
  patch(id, (c) => ({
    items: c.items.map((i) =>
      i.id === itemId && i.kind === 'user' && i.attachments?.[index]
        ? { ...i, attachments: i.attachments.map((a, at) => (at === index ? { ...a, path } : a)) }
        : i,
    ),
  }))
}

type SubmitResult = { status?: string; user_row_id?: number | null }

function setRowId(id: string, itemId: string, rowId: number) {
  patch(id, (c) => ({ items: c.items.map((i) => (i.id === itemId && i.kind === 'user' ? { ...i, rowId } : i)) }))
}

const isBusy = (c?: Chat) => !!c && c.status !== 'idle' && c.status !== 'error'

/** Your last message, if Hermes has it and nothing's running: it can be asked again in its place. */
function savedMessage(c?: Chat) {
  if (!c || isBusy(c)) return undefined
  const last = c.items.findLast((i) => i.kind === 'user')
  return last?.kind === 'user' && last.rowId != null ? last : undefined
}

/** Your last message, if it can be edited and sent again: saved, text only, and nothing running. */
export function editableMessage(c?: Chat) {
  const last = savedMessage(c)
  return last && !last.attachments?.length && !last.images?.length ? last : undefined
}

/**
 * Change your last message and ask again: Hermes forgets everything from that
 * message on and answers the new text. Throws (with the thread restored) if
 * it couldn't.
 */
export async function resend(id: string, itemId: string, text: string) {
  const target = editableMessage(getChat(id))
  if (!target || target.id !== itemId) throw new Error('That message can’t be edited now.')
  return askAgain(id, target, text, text)
}

/**
 * Send a saved message again in its own place: Hermes forgets it and what came
 * after, and takes `prompt` instead. Its pictures go again from where they
 * are on Hermes; its files ride in the prompt as refs. Throws (with the
 * thread restored) if it couldn't.
 */
async function askAgain(id: string, target: Extract<ChatItem, { kind: 'user' }>, prompt: string, shown: string) {
  const chat = getChat(id)
  if (!chat) return
  const before = chat.items
  const index = before.findIndex((i) => i.id === target.id)
  // A new id, so the old reply leaves and the new one arrives; the bubble stays put.
  const next: ChatItem = {
    kind: 'user',
    id: uid('u'),
    text: shown,
    attachments: target.attachments,
    at: Date.now(),
    was: target.was ?? target.id,
  }
  asked.set(id, Date.now())
  patch(id, () => ({ items: [...before.slice(0, index), next], status: 'thinking' }))
  prompts.set(next.id, prompt)
  const queued = (target.attachments ?? []).flatMap((a) => (a.kind === 'image' && a.path ? [a.path] : []))
  try {
    for (const path of queued) await onChat(id, 'image.attach', { path })
    const res = await onChat<SubmitResult>(id, 'prompt.submit', {
      text: prompt,
      profile: chat.profile,
      truncate_before_row_id: target.rowId,
      confirm_truncate: true,
      // Asking the very first message again empties the chat before it's answered.
      confirm_empty_truncate: true,
    })
    if (res.user_row_id != null) setRowId(id, next.id, res.user_row_id)
  } catch (e) {
    // A picture queued for this try mustn't ride along with your next message.
    for (const path of queued) void onChat(id, 'image.detach', { path }).catch(() => {})
    patch(id, () => ({ items: before, status: chat.status }))
    throw e
  }
}

/**
 * Ask for a fresh reply to your last message: in its place if Hermes saved
 * it (files and pictures too), or by sending what didn't get there if not.
 */
export async function regenerate(id: string) {
  const last = savedMessage(getChat(id))
  if (!last) return retry(id)
  const refs = (last.attachments ?? []).flatMap((a) => (a.kind === 'file' && a.path ? [fileRef(a.path)] : []))
  return askAgain(id, last, prompts.get(last.id) ?? promptOf(refs, last.text), last.text)
}

/**
 * Take back your last message and its reply. Returns what you'd written, so
 * it can go back in the composer, or undefined if there was nothing to undo.
 */
export async function undo(id: string) {
  const chat = getChat(id)
  if (!chat) return undefined
  if (isBusy(chat)) throw new Error('Wait for the reply to finish, then try again.')
  const res = await onChat<{ removed?: number }>(id, 'session.undo')
  if (!res.removed) return undefined
  let text: string | undefined
  patch(id, (c) => {
    const at = c.items.findLastIndex((i) => i.kind === 'user')
    if (at < 0) return
    const last = c.items[at]
    text = last.kind === 'user' ? last.text : undefined
    return { items: c.items.slice(0, at), status: 'idle' }
  })
  return text ?? ''
}

// ── Side questions and commands ─────────────────────────────────────────────

/** Put away a side answer or command card. */
export function dismissItem(id: string, itemId: string) {
  patch(id, (c) => ({ items: c.items.filter((i) => i.id !== itemId) }))
}

/** Ask something on the side (/btw): answered from what the chat knows so far, without interrupting it. */
export async function askAside(id: string, question: string) {
  const itemId = uid('b')
  patch(id, (c) => ({ items: [...c.items, { kind: 'aside', id: itemId, question, status: 'pending' }] }))
  try {
    const res = await onChat<{ task_id: string }>(id, 'prompt.btw', { text: question })
    // (The answer can land before this does; then it's already filled in.)
    patch(id, (c) => ({
      items: c.items.map((i) => (i.id === itemId && i.kind === 'aside' && !i.taskId ? { ...i, taskId: res.task_id } : i)),
    }))
  } catch (e) {
    patch(id, (c) => ({
      items: c.items.map((i) =>
        i.id === itemId && i.kind === 'aside' ? { ...i, status: 'error', answer: errorText(e) } : i,
      ),
    }))
  }
}

type SlashResult = {
  output?: string | null
  warning?: string | null
  type?: 'exec' | 'alias' | 'plugin' | 'send' | 'skill' | 'prefill' | null
  target?: string | null
  message?: string | null
  notice?: string | null
  display?: string | null
}

/**
 * Run any other slash command in this chat. Its printout lands in the thread
 * as a card; commands that turn into a message (a goal, a skill) send it.
 * Returns text to put back in the composer, if the command asks for that.
 */
export async function runSlash(
  id: string,
  command: string,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<{ prefill?: string; output?: string }> {
  const itemId = uid('c')
  let printed: string | undefined
  const card = (next: Partial<Extract<ChatItem, { kind: 'command' }>> | null) => {
    printed = next?.output
    if (quiet) return
    patch(id, (c) => ({
      items: next
        ? c.items.map((i) => (i.id === itemId && i.kind === 'command' ? { ...i, ...next } : i))
        : c.items.filter((i) => i.id !== itemId),
    }))
  }
  if (!quiet) patch(id, (c) => ({ items: [...c.items, { kind: 'command', id: itemId, command, status: 'running' }] }))

  const [, name = '', arg = ''] = /^\/(\S+)\s*([\s\S]*)$/.exec(command.trim()) ?? []
  try {
    let res: SlashResult
    try {
      res = await onChat<SlashResult>(id, 'slash.exec', { command, profile: getChat(id)?.profile })
    } catch (e) {
      // Skills (and a few others) only run through command.dispatch.
      if ((e as { code?: number }).code !== 4018) throw e
      res = await onChat<SlashResult>(id, 'command.dispatch', { name, arg, profile: getChat(id)?.profile })
    }
    if (res.type === 'alias' && res.target) {
      card(null)
      return runSlash(id, `/${res.target.replace(/^\//, '')}${arg ? ` ${arg}` : ''}`, { quiet })
    }
    if (res.type === 'send' || res.type === 'skill') {
      const notice = res.notice?.trim()
      card(notice ? { status: 'done', output: notice } : null)
      if (res.message) void send(id, res.message, [], { shown: res.display?.trim() || command })
      return { output: printed }
    }
    if (res.type === 'prefill') {
      const notice = res.notice?.trim()
      card(notice ? { status: 'done', output: notice } : null)
      return { prefill: res.message ?? undefined, output: printed }
    }
    const output = [res.output?.trim(), res.warning?.trim()].filter(Boolean).join('\n\n')
    card({ status: 'done', output: output || 'Done.' })
    return { output: printed }
  } catch (e) {
    card({ status: 'error', output: errorText(e) })
    if (quiet) throw e
    return {}
  }
}

function attachError(e: unknown) {
  const raw = e instanceof Error ? e.message : String(e)
  if (/too large/i.test(raw)) return 'That file is too large to send. Try a smaller one.'
  if (/unsupported image|not an image|image type/i.test(raw))
    return 'That image type isn’t supported. Try a PNG or JPEG.'
  return errorText(e)
}

/**
 * A prompt from a widget (window.hermes.send). It goes to the agent as a
 * hidden turn: nothing appears in the thread, and the agent answers by
 * updating the widget. Returns false when the chat is busy.
 */
/**
 * Carry a chat on here when another Hermes app holds it (Hermes lets one
 * program drive a chat at a time, by design). The conversation is copied into
 * a new chat, the message that couldn't be sent goes there, and its id comes
 * back so the screen can move to it. Hermes 0.21.5+ copies everything, tool
 * steps included; older ones get the words of the conversation.
 */
export async function continueHere(id: string) {
  const chat = getChat(id)
  if (!chat) return undefined
  const { profile, speaker } = chat
  const last = chat.items.findLast((i) => i.kind === 'user')
  const pending = last?.kind === 'user' ? last.text : ''

  let copy: string
  try {
    copy = (await rpc<{ stored_session_id: string }>('session.branch_stored', {
      profile,
      parent_session_id: id,
      source: 'desktop',
    })).stored_session_id
  } catch (error) {
    if (!isMissingMethod(error)) throw error
    const res = await api.get<{ messages?: Row[]; data?: Row[] }>(
      `/api/sessions/${encodeURIComponent(id)}/messages?profile=${encodeURIComponent(profile)}&order=oldest&limit=500`,
    )
    const messages = (res.messages ?? res.data ?? []).flatMap((r) => {
      const content = r.role === 'user' ? parseUserMessage(r.content ?? '').text : (r.content ?? '').trim()
      return (isYours(r) || r.role === 'assistant') && content && r.display_kind !== 'hidden'
        ? [{ role: r.role, content }]
        : []
    })
    copy = (await rpc<CreateResult>('session.create', { profile, source: 'desktop', messages, title: chat.title }))
      .stored_session_id
  }
  await openChat(copy, profile, speaker)
  if (pending) await send(copy, pending)
  return copy
}

export async function sendHidden(id: string, text: string) {
  const chat = getChat(id)
  if (!chat || (chat.status !== 'idle' && chat.status !== 'error')) return false
  asked.set(id, Date.now())
  patch(id, () => ({ status: 'thinking' }))
  try {
    await onChat(id, 'prompt.submit', { text, profile: chat.profile, display_kind: 'hidden' })
    return true
  } catch {
    patch(id, () => ({ status: 'idle' }))
    return false
  }
}

export async function stop(id: string) {
  await onChat(id, 'session.interrupt').catch(() => {})
}

/** Call back a helper the agent sent off; the rest of the reply carries on. */
export async function stopHelper(id: string, subagentId: string) {
  const line = (text?: string) =>
    patch(id, (c) => ({
      items: c.items.map((i) => (i.kind === 'helper' && i.subagentId === subagentId && i.status === 'running' ? { ...i, line: text } : i)),
    }))
  line('Stopping')
  try {
    await onChat(id, 'subagent.interrupt', { subagent_id: subagentId })
  } catch (e) {
    line(undefined)
    throw e
  }
}

/**
 * Tapback on a message, or take yours back (the same emoji again). It shows at
 * once; Hermes keeps it with the message, so it's there after a reload.
 */
export async function react(id: string, itemId: string, emoji: string) {
  const chat = getChat(id)
  const item = chat?.items.find((i) => i.id === itemId)
  if (!chat || (item?.kind !== 'user' && item?.kind !== 'assistant')) return
  // Not saved yet: Hermes can still find it as the newest of its kind.
  const newest = chat.items.findLast((i) => i.kind === item.kind) === item
  if (item.rowId == null && !newest) throw new Error('That message can’t take a reaction yet.')
  const set = (next: { rowId?: number; reactions?: Reaction[] }) =>
    patch(id, (c) => ({
      items: c.items.map((i): ChatItem => (i.id === itemId && (i.kind === 'user' || i.kind === 'assistant') ? { ...i, ...next } : i)),
    }))
  const before = item.reactions
  set({ reactions: toggled(before, emoji, 'user') })
  try {
    const res = await onChat<{ row_id: number; reactions?: unknown }>(id, 'message.react', {
      ...(item.rowId != null ? { row_id: item.rowId } : { newest_role: item.kind }),
      emoji,
    })
    set({ rowId: res.row_id, reactions: reactionsOf(res.reactions) })
  } catch (e) {
    set({ reactions: before })
    throw e
  }
}

/** Send your last message again when Hermes never got it whole: what's missing goes, and nothing twice. */
async function retry(id: string) {
  const chat = getChat(id)
  const lastUser = chat?.items.findLast((i) => i.kind === 'user')
  if (!chat || !lastUser || lastUser.kind !== 'user') return
  asked.set(id, Date.now())
  patch(id, (c) => ({ items: c.items.filter((i) => i.kind !== 'error'), status: 'thinking' }))
  if (unsent.has(lastUser.id)) return deliver(id, lastUser.id)
  const text = prompts.get(lastUser.id) ?? lastUser.text
  await onChat(id, 'prompt.submit', { text, profile: chat.profile }).catch((e) =>
    patch(id, (c) => ({
      status: 'error',
      items: [...c.items, { kind: 'error', id: uid('e'), message: errorText(e), retryable: true }],
    })),
  )
}

export async function setChatModel(id: string, model: string, provider: string) {
  const was = getChat(id)
  // The check moves the moment you pick; it moves back if Hermes says no.
  patch(id, () => ({ model, provider }))
  try {
    const params = { key: 'model', value: `${model} --provider ${provider} --session` }
    const res = await onChat<{ confirm_required?: boolean }>(id, 'config.set', params)
    // Picking it in the sheet was the confirmation.
    if (res.confirm_required) await onChat(id, 'config.set', { ...params, confirm_expensive_model: true })
  } catch (e) {
    patch(id, (c) => (c.model === model ? { model: was?.model, provider: was?.provider } : undefined))
    throw e
  }
  savePick(id, { model, provider })
  // Switching models resets thinking to the agent's default; keep the choice
  // (read now, in case it changed while the switch was in flight).
  const reasoning = getChat(id)?.reasoning
  if (reasoning) await onChat(id, 'config.set', { key: 'reasoning', value: reasoning }).catch(() => {})
}

export async function setChatReasoning(id: string, value: string, remember = true) {
  await onChat(id, 'config.set', { key: 'reasoning', value })
  patch(id, () => ({ reasoning: value }))
  savePick(id, { reasoning: remember ? value : undefined })
}

/** Back to the agent's own default thinking level (a live chat has no "unset"). */
export async function resetChatReasoning(id: string) {
  const chat = getChat(id)
  if (!chat) return
  const { value } = await rpc<{ value: string }>('config.get', { profile: chat.profile, key: 'reasoning' })
  await setChatReasoning(id, value, false)
}

export async function renameChat(id: string, title: string) {
  await updateChat(id, getChat(id)?.profile ?? 'default', { title })
}

/** What Murmur and Hermes Desktop both keep on a stored chat. */
export type ChatChange = { title?: string; archived?: boolean; pinned?: boolean }

/**
 * Renames, archives or pins a stored chat, open here or not, the way Hermes
 * Desktop does, so the two always agree. An agent's chats each have their own
 * name: a title another one has is refused (see `titleTaken`).
 */
export async function updateChat(id: string, profile: string, change: ChatChange) {
  const { title } = change
  try {
    await patchSession(id, profile, change, 'edit')
  } catch (e) {
    if (title !== undefined && (saysTitleTaken(e) || (await titleHolder(id, profile, title)))) throw new TitleTaken()
    throw e
  }
  if (title !== undefined) patch(id, () => ({ title }))
}

class TitleTaken extends Error {}

/** Hermes refused a title because another of the agent's chats has it. */
export const titleTaken = (e: unknown) => e instanceof TitleTaken

/** Older Hermes refuses a taken title in so many words. */
const saysTitleTaken = (e: unknown) => e instanceof HermesError && e.status === 400 && /already in use/i.test(e.message)

/**
 * Newer Hermes (0.22.5 here) refuses it with a bare 409 `request_failed`, so,
 * like Hermes's own CLI, this asks whether another of the agent's chats,
 * archived ones too, already has it.
 */
async function titleHolder(id: string, profile: string, title: string) {
  type Page = { sessions?: { id: string; title?: string | null }[]; total?: number }
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await api
      .get<Page>(`/api/sessions?profile=${encodeURIComponent(profile)}&archived=include&limit=100&offset=${offset}`)
      .catch(() => null)
    const rows = page?.sessions ?? []
    const holder = rows.find((r) => r.title === title && r.id !== id)
    if (holder) return holder.id
    if (rows.length < 100 || offset + 100 >= (page?.total ?? 0)) return null
  }
  return null
}

/** Clears the unread mark Hermes Desktop keeps on a stored chat. */
export function clearUnread(id: string, profile: string) {
  return patchSession(id, profile, { unread: false }, 'read')
}

/**
 * A change to a stored chat's row. From Hermes 0.22.3 such a change carries
 * the chat's revision, and an id of its own so a retry can't apply it twice;
 * older Hermes has neither and takes it bare.
 */
async function patchSession(id: string, profile: string, change: ChatChange & { unread?: boolean }, tag: string) {
  const path = `/api/sessions/${encodeURIComponent(id)}`
  const snapshot = await api
    .get<{ runtime_revision?: number }>(`${path}/mutation-snapshot?profile=${encodeURIComponent(profile)}`)
    .catch(() => null)
  const revision = snapshot?.runtime_revision
  await api.patch(path, {
    ...change,
    profile,
    ...(revision !== undefined && {
      request_id: `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      expected_revision: revision,
    }),
  })
}

/** Delete a stored chat, whether or not it is open here. */
export async function deleteChat(id: string, profile = getChat(id)?.profile ?? 'default') {
  const close = (runtimeId: string) => rpc('session.close', { session_id: runtimeId }).catch(() => {})
  const chat = getChat(id)
  if (chat?.runtimeId) {
    await close(chat.runtimeId)
    runtimeToStored.delete(chat.runtimeId)
  }
  try {
    await rpc('session.delete', { session_id: id, profile })
  } catch (e) {
    // Live somewhere else (another tab, a reply still running): close it there first.
    if ((e as { code?: number }).code !== 4023) throw e
    const live = await rpc<{ sessions: { id: string; session_key?: string }[] }>('session.active_list', {})
    const match = live.sessions.find((s) => s.session_key === id)
    if (match) await close(match.id)
    await rpc('session.delete', { session_id: id, profile })
  }
  forget(id)
  useChats.setState((s) => {
    const chats = { ...s.chats }
    delete chats[id]
    return { chats }
  })
}

/** Let go of everything kept for a chat that's gone. */
function forget(id: string) {
  for (const item of getChat(id)?.items ?? []) {
    if (item.kind !== 'user') continue
    prompts.delete(item.id)
    unsent.delete(item.id)
  }
  pictures.get(id)?.forEach((url) => URL.revokeObjectURL(url))
  pictures.delete(id)
  pendingReasoning.delete(id)
  asked.delete(id)
  viewing.delete(id)
  reach.delete(id)
  savePick(id, null)
}

// ── Approvals and questions ─────────────────────────────────────────────────

export function answerApproval(id: string, requestId: string, choice: ApprovalChoice) {
  requests.get(requestId)?.respond({ choice })
  requests.delete(requestId)
  patch(id, (c) => ({
    items: c.items.map((i) =>
      i.kind === 'approval' && i.requestId === requestId
        ? { ...i, status: choice === 'deny' ? 'denied' : 'approved', choice }
        : i,
    ),
    status: 'working',
  }))
}

export function answerQuestion(id: string, requestId: string, answers: Record<string, string>) {
  requests.get(requestId)?.respond({ answers })
  requests.delete(requestId)
  patch(id, (c) => ({
    items: c.items.map((i) =>
      i.kind === 'clarify' && i.requestId === requestId ? { ...i, status: 'answered', answers } : i,
    ),
    status: 'working',
  }))
}

/**
 * A login, a code or a key, answered in a masked field. The value goes
 * straight back on the socket: it's never put in the store, so it can't reach
 * the transcript, a notification or a reload. An empty value is "not now".
 */
export function answerSecret(id: string, requestId: string, value: string) {
  requests.get(requestId)?.respond({ value })
  requests.delete(requestId)
  patch(id, (c) => ({
    items: c.items.map((i) =>
      i.kind === 'secret' && i.requestId === requestId ? { ...i, status: value ? 'sent' : 'skipped' } : i,
    ),
    status: 'working',
  }))
}

/** Hermes's masked prompts, by what each asks you for. */
const SECRET_ASKS: Record<string, SecretAsk> = { 'vault.save_login': 'login', 'vault.code': 'code', secret: 'key' }

const trimmed = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

function onServerRequest(req: ServerRequest) {
  const params = req.params as Record<string, unknown>
  const secret = SECRET_ASKS[req.method]
  if (req.method !== 'approval' && req.method !== 'clarify' && !secret) return false
  const runtimeId = String(params.session_id ?? '')
  const id = runtimeToStored.get(runtimeId)
  // Only re-deliveries wait: a live request for an id we don't know is
  // someone else's (a group member's), so let the next handler have it.
  if (!id && attaching && req.replayed) {
    parked.set(runtimeId, [...(parked.get(runtimeId) ?? []), req])
    return true
  }
  if (!id) return false
  // A re-delivery after reconnect (or a pending card from before a reload):
  // answer through the newest copy, and don't add a second card.
  const shown = getChat(id)?.items.some(
    (i) => (i.kind === 'approval' || i.kind === 'clarify' || i.kind === 'secret') && i.requestId === req.id,
  )
  if (requests.has(req.id) || shown) {
    requests.set(req.id, req)
    return true
  }
  requests.set(req.id, req)
  const speaker = getChat(id)?.speaker
  if (secret) {
    const meta = (params.metadata ?? {}) as Record<string, unknown>
    patch(id, (c) => ({
      status: 'waiting',
      items: [
        ...c.items,
        {
          kind: 'secret',
          id: uid('s'),
          requestId: req.id,
          ask: secret,
          site: trimmed(params.site),
          prompt: trimmed(secret === 'code' ? params.hint : params.prompt),
          skill: trimmed(meta.skill_name),
          help: trimmed(meta.help),
          status: 'pending',
          speaker,
        },
      ],
    }))
  } else if (req.method === 'approval') {
    const command = typeof params.command === 'string' ? params.command : undefined
    const tool = toolAsked(command)
    const text = approvalText({
      who: speaker?.name,
      command,
      description: typeof params.description === 'string' ? params.description : '',
      choices: Array.isArray(params.choices) ? (params.choices as ApprovalChoice[]) : undefined,
      patternKeys: Array.isArray(params.pattern_keys)
        ? params.pattern_keys.map(String)
        : typeof params.pattern_key === 'string'
          ? [params.pattern_key]
          : [],
      // (It can arrive a moment before the call itself; then tool.start fills it in.)
      call: tool ? callFor(id, tool) : undefined,
      payment: params.payment,
    })
    patch(id, (c) => ({
      status: 'waiting',
      items: [
        ...c.items,
        {
          kind: 'approval',
          id: uid('ap'),
          requestId: req.id,
          ...(typeof params.request_id === 'string' && params.request_id && { approvalId: params.request_id }),
          ...text,
          status: 'pending',
          speaker,
        },
      ],
    }))
  } else {
    const raw = Array.isArray(params.questions)
      ? (params.questions as Record<string, unknown>[])
      : [{ qid: 'q0', question: params.question, choices: params.choices, multi_select: params.multi_select }]
    const questions: ClarifyQuestion[] = raw.map((q, i) => ({
      qid: String(q.qid ?? `q${i}`),
      question: String(q.question ?? ''),
      choices: Array.isArray(q.choices) ? q.choices.map(String) : undefined,
      multi: Boolean(q.multi_select),
    }))
    patch(id, (c) => ({
      status: 'waiting',
      items: [...c.items, { kind: 'clarify', id: uid('q'), requestId: req.id, questions, status: 'pending', speaker }],
    }))
  }
  return true
}

/** The newest call to a tool an approval names: running now, or its step from history (opened while it waits). */
function callFor(id: string, tool: string): ToolCall | undefined {
  const live = [...(runningCalls.get(id)?.values() ?? [])].reverse().find((c) => isCallTo(c.name, tool))
  if (live) return live
  const step = getChat(id)?.items.findLast((i) => i.kind === 'tool' && isCallTo(i.name, tool))
  return step?.kind === 'tool' ? { name: step.name, context: step.detail } : undefined
}

// ── The event stream ────────────────────────────────────────────────────────

type P = Record<string, unknown>

function onEvent(ev: GatewayEvent) {
  const runtimeId = (ev as { session_id?: string }).session_id ?? ''
  // Most events name the live session; the agent's own tapback names the stored chat.
  const id =
    runtimeToStored.get(runtimeId) ?? (ev.type === 'message.reaction' && getChat(runtimeId) ? runtimeId : undefined)
  if (!id) return
  const payload = ((ev as { payload?: P }).payload ?? {}) as P
  const text = typeof payload.text === 'string' ? payload.text : ''

  switch (ev.type) {
    case 'message.start': {
      // Everything sent from here shows as busy first, so an idle chat means it came from elsewhere.
      const chat = getChat(id)
      if (isBusy(chat)) return patch(id, (c) => ({ status: c.status === 'waiting' ? 'waiting' : 'thinking' }))
      // Hermes can announce a turn twice; the first is already bringing it in.
      if (chat?.starting) return
      begunElsewhere.add(id)
      patch(id, () => ({ starting: true }))
      // Busy once what started it is in (or after a moment), so the last turn doesn't come alive first.
      const caughtUp = catchUpTurn(id).catch(() => {})
      void Promise.race([caughtUp, new Promise((resolve) => setTimeout(resolve, 1000))]).then(() =>
        patch(id, (c) => ({ starting: false, status: begunElsewhere.has(id) && !isBusy(c) ? 'thinking' : c.status })),
      )
      return
    }

    case 'message.delta':
      return patch(id, (c) => {
        const { item: last, at } = flowTail(c.items)
        if (last?.kind === 'assistant' && last.streaming) {
          const next = last.text ? last.text + text : text.trimStart()
          return { status: 'working', items: replaceAt(c.items, at, { ...last, text: next }) }
        }
        const items = closeThinking(c.items)
        return {
          status: 'working',
          items: [
            ...items,
            {
              kind: 'assistant',
              id: uid('a'),
              text: text.trimStart(),
              streaming: true,
              at: Date.now(),
              speaker: c.speaker,
            },
          ],
        }
      })

    case 'message.interim':
      return patch(id, (c) => {
        const { item: last, at } = flowTail(c.items)
        if (last?.kind === 'assistant' && last.streaming) {
          return { items: replaceAt(c.items, at, { ...last, text: text.trim(), streaming: false }) }
        }
        if (payload.already_streamed || !text.trim()) return
        return {
          items: [
            ...c.items,
            {
              kind: 'assistant',
              id: uid('a'),
              text: text.trim(),
              streaming: false,
              at: Date.now(),
              speaker: c.speaker,
            },
          ],
        }
      })

    case 'reasoning.delta':
      return patch(id, (c) => {
        const { item: last, at } = flowTail(c.items)
        if (last?.kind === 'thinking' && last.streaming) {
          return { status: 'thinking', items: replaceAt(c.items, at, { ...last, text: last.text + text }) }
        }
        return {
          status: 'thinking',
          items: [
            ...c.items,
            { kind: 'thinking', id: uid('t'), text, streaming: true, startedAt: Date.now(), speaker: c.speaker },
          ],
        }
      })

    case 'reasoning.available':
      pendingReasoning.set(id, text)
      return

    case 'tool.start': {
      const name = String(payload.name ?? 'tool')
      // The checklist and tapbacks show themselves (todo.updated, message.reaction).
      const calls = viaToolCall(name, payload.args)
      if (calls.every((c) => isTodoTool(c.name) || QUIET_TOOLS.has(c.name)))
        return patch(id, (c) => ({ status: c.status === 'waiting' ? 'waiting' : 'working' }))
      const label = toolLabel(name, payload.args, typeof payload.context === 'string' ? payload.context : undefined)
      const toolId = payload.tool_id == null ? '' : String(payload.tool_id)
      const context = typeof payload.context === 'string' ? payload.context : undefined
      if (toolId) {
        const calls = runningCalls.get(id) ?? new Map<string, ToolCall>()
        runningCalls.set(id, calls.set(toolId, { name, args: payload.args, context }))
      }
      // Already here from history (a reload mid-reply, then a replay): it carries on in place.
      const loaded = toolId ? getChat(id)?.items.findIndex((i) => i.kind === 'tool' && i.callId === toolId) : -1
      if (loaded !== undefined && loaded >= 0)
        return patch(id, (c) => ({
          status: c.status === 'waiting' ? 'waiting' : 'working',
          items: c.items.map((i, at) => (at === loaded && i.kind === 'tool' ? { ...i, status: 'running', endedAt: undefined } : i)),
        }))
      return patch(id, (c) => {
        const step: ChatItem = {
          kind: 'tool',
          id: `tool-${String(payload.tool_id ?? uid('x'))}`,
          // One call through the bridge (an app through Nous) is that call, as history has it.
          name: calls.length === 1 ? calls[0].name : name,
          label: mailRead(name, payload.args, mailSubjects.get(id)) ?? label.label,
          detail: label.detail,
          app: label.app,
          status: 'running',
          startedAt: Date.now(),
          speaker: c.speaker,
        }
        // Its approval got here first: the step goes above the card, and the card learns what it's about.
        const asked = c.items.findIndex(
          (i) => i.kind === 'approval' && i.status === 'pending' && !!i.tool && isCallTo(name, i.tool),
        )
        if (asked >= 0) {
          const card = c.items[asked] as Extract<ChatItem, { kind: 'approval' }>
          const items = [...c.items]
          items.splice(asked, 1, step, {
            ...card,
            command: card.command ?? detailOf({ name, args: payload.args, context }),
          })
          return { status: c.status, items }
        }
        return {
          status: c.status === 'waiting' ? 'waiting' : 'working',
          items: [...closeThinking(sealAssistant(c.items)), step],
        }
      })
    }

    case 'tool.complete': {
      const toolId = String(payload.tool_id ?? '')
      runningCalls.get(id)?.delete(toolId)
      const key = `tool-${toolId}`
      // (A step loaded from history, after a reload mid-reply, is known by its call id.)
      const isIt = (i: ChatItem) => i.kind === 'tool' && (i.id === key || (!!toolId && i.callId === toolId))
      const result = payload.result as P | undefined
      const failed = Boolean(
        result && (result.status === 'blocked' || result.exit_code === -1 || (result.error && result.error !== null)),
      )
      const media = failed ? [] : toolMedia(String(payload.name ?? ''), payload.result)
      const name = String(payload.name ?? '')
      const found = foundSubjects(name, payload.result)
      if (found.length) mailSubjects.set(id, new Map([...(mailSubjects.get(id) ?? []), ...found]))
      const read = failed ? undefined : resultLabel(name, payload.result)
      return patch(id, (c) => {
        // Helpers sent off to work in the background stay live after this turn,
        // and their card takes the place of the step that sent them.
        const handedOff = name === 'delegate_task' && !!errandOf(payload.result)
        const sent = handedOff ? withErrand(c.items, payload.result, Date.now()) : c.items
        const items = sent.flatMap((i): ChatItem[] => {
          if (i.kind === 'tool' && isIt(i))
            return handedOff ? [] : [
              {
                ...i,
                label: read ?? i.label,
                status: failed ? 'error' : 'done',
                endedAt: Date.now(),
                media: media.length ? media : i.media,
              },
            ]
          // Answered somewhere else (another window, Telegram): the step says how it went, so the card goes.
          if (i.kind === 'approval' && i.status === 'pending' && i.tool && name && isCallTo(name, i.tool)) {
            requests.delete(i.requestId)
            return []
          }
          return [i]
        })
        return { status: hasPending(items) ? 'waiting' : 'working', items }
      })
    }

    case 'message.complete': {
      const status = String(payload.status ?? 'complete')
      runningCalls.delete(id)
      const persisted = payload.persisted_turn as { user_row_id?: number; final_assistant_row_id?: number } | undefined
      const reasoning = pendingReasoning.get(id)
      pendingReasoning.delete(id)
      patch(id, (c) => {
        let items = closeThinking(c.items).map((i) =>
          i.kind === 'tool' && i.status === 'running' ? { ...i, status: 'done' as const, endedAt: Date.now() } : i,
        )
        const finalText = text.trim()
        const { item: last, at: lastAt } = flowTail(items)
        if (last?.kind === 'assistant' && last.streaming) {
          items = replaceAt(items, lastAt, { ...last, text: finalText || last.text.trim(), streaming: false })
        } else if (finalText && status === 'complete') {
          items = [
            ...items,
            { kind: 'assistant', id: uid('a'), text: finalText, streaming: false, at: Date.now(), speaker: c.speaker },
          ]
        }
        // Real reasoning (not the answer echoed back) goes before the reply.
        if (
          reasoning &&
          reasoning.trim() !== finalText &&
          !items.some((i) => i.kind === 'thinking' && i.text === reasoning)
        ) {
          const at = items.findLastIndex(startsTurn) + 1
          const now = Date.now()
          items.splice(at, 0, {
            kind: 'thinking',
            id: uid('t'),
            text: reasoning.trim(),
            streaming: false,
            startedAt: now,
            endedAt: now,
            speaker: c.speaker,
          })
        }
        if (status === 'error' && flowTail(items).item?.kind !== 'error') {
          const message =
            typeof payload.error === 'string' ? friendlyError(payload.error) : 'Something went wrong with that reply.'
          items = [...items, { kind: 'error', id: uid('e'), message, retryable: payload.recoverable !== false }]
        } else if (status === 'interrupted') {
          items = [...items, { kind: 'notice', id: uid('n'), text: 'Stopped' }]
        }
        items = settleHelpers(items, status === 'interrupted', Date.now())
        // The reply is saved now too: it can take a reaction.
        const final = persisted?.final_assistant_row_id
        const said = items.findLastIndex((i) => i.kind === 'assistant')
        const reply = items[said]
        if (final != null && reply?.kind === 'assistant' && reply.rowId == null && said > items.findLastIndex(startsTurn))
          items = replaceAt(items, said, { ...reply, rowId: final })
        // The message that started this reply is saved now: yours can be edited.
        const rowId = persisted?.user_row_id
        const at = items.findLastIndex(startsTurn)
        const asked = items[at]
        if (rowId != null && (asked?.kind === 'user' || asked?.kind === 'wake') && asked.rowId == null) {
          items = items.map((i, n) => (n === at ? { ...asked, rowId } : i))
        }
        return { items, status: status === 'error' ? 'error' : 'idle', turns: (c.turns ?? 0) + 1 }
      })
      // Begun elsewhere, before its message was saved (Hermes saves a wake as its turn starts):
      // now that it is, bring it in.
      const saved = persisted?.user_row_id
      if (begunElsewhere.delete(id) && saved != null && !getChat(id)?.items.some((i) => rowOf(i) === saved))
        void catchUp(id, false)
      return
    }

    case 'todo.updated': {
      const todos = todosOf(payload.todos)
      if (!todos) return
      const revision = Number(payload.revision) || 0
      return patch(id, (c) => ({ items: withPlan(closeThinking(sealAssistant(c.items)), todos, revision, uid('plan')) }))
    }

    case 'subagent.spawn_requested':
    case 'subagent.start':
    case 'subagent.progress':
    case 'subagent.tool':
    case 'subagent.thinking':
    case 'subagent.complete':
      return patch(id, (c) => ({ items: withHelper(c.items, ev.type, payload, Date.now()) }))

    case 'message.reaction':
      return patch(id, (c) => ({
        items: withReactions(c.items, {
          rowId: typeof payload.row_id === 'number' ? payload.row_id : undefined,
          role: typeof payload.role === 'string' ? payload.role : undefined,
          reactions: reactionsOf(payload.reactions),
        }),
      }))

    case 'reaction':
      if (payload.kind === 'vibe') patch(id, (c) => ({ vibes: (c.vibes ?? 0) + 1 }))
      return

    case 'preview.open':
      return patch(id, (c) => ({ items: withPreview(c.items, String(payload.url ?? '')) }))

    case 'btw.complete': {
      const taskId = String(payload.task_id ?? '')
      const answer = text.trim()
      const failed = /^error:/i.test(answer)
      return patch(id, (c) => {
        // Matched by task, or (if the answer beat the RPC reply) the oldest unanswered question.
        const match =
          c.items.find((i) => i.kind === 'aside' && i.taskId === taskId) ??
          c.items.find((i) => i.kind === 'aside' && !i.taskId && i.status === 'pending')
        if (!match) return
        return {
          items: c.items.map((i) =>
            i === match && i.kind === 'aside'
              ? {
                  ...i,
                  taskId,
                  status: failed ? 'error' : 'done',
                  answer: failed ? friendlyError(answer.replace(/^error:\s*/i, '')) : answer,
                }
              : i,
          ),
        }
      })
    }

    case 'session.control.update':
      return patch(id, () => ({ goal: goalOf(payload.control as ControlSnapshot | undefined) }))

    case 'session.title':
      if (typeof payload.title === 'string') patch(id, () => ({ title: payload.title as string }))
      return

    case 'session.info':
      return patch(id, (c) => ({
        model: (payload.model as string) ?? c.model,
        provider: (payload.provider as string) ?? c.provider,
        reasoning: (payload.reasoning_effort as string) ?? c.reasoning,
        title: (payload.title as string) || c.title,
      }))

    case 'request.cancel': {
      const reqId = String(payload.id ?? '')
      requests.delete(reqId)
      return patch(id, (c) => ({
        status: c.status === 'waiting' ? 'working' : c.status,
        items: c.items.flatMap((i) => {
          if ((i.kind === 'approval' || i.kind === 'secret') && i.requestId === reqId && i.status === 'pending')
            return [{ ...i, status: 'expired' as const }]
          if (i.kind === 'clarify' && i.requestId === reqId && i.status === 'pending') return []
          return [i]
        }),
      }))
    }

    case 'error':
      return patch(id, (c) => ({
        status: 'error',
        items: [
          ...c.items,
          {
            kind: 'error',
            id: uid('e'),
            message: friendlyError(text || String(payload.message ?? '')),
            retryable: true,
          },
        ],
      }))
  }
}

/** A card that's waiting for you: an approval, a question, or a masked field. */
const isAsking = (i: ChatItem) =>
  (i.kind === 'approval' || i.kind === 'clarify' || i.kind === 'secret') && i.status === 'pending'

const hasPending = (items: ChatItem[]) => items.some(isAsking)

/** Side questions and command cards sit beside the conversation: a reply carries on past them. */
const isSide = (i: ChatItem) => i.kind === 'aside' || i.kind === 'command'

/** This turn already shows the text: Hermes saved it before pausing (to ask you, say). */
function saidSinceAsked(items: ChatItem[], text: string) {
  const asked = items.findLastIndex(startsTurn)
  return items
    .slice(asked + 1)
    .some((i) => i.kind === 'assistant' && (text.startsWith(i.text) || i.text.startsWith(text)))
}

function flowTail(items: ChatItem[]) {
  const at = items.findLastIndex((i) => !isSide(i))
  return { item: at < 0 ? undefined : items[at], at }
}

const replaceAt = (items: ChatItem[], at: number, item: ChatItem) => items.map((i, n) => (n === at ? item : i))

function closeThinking(items: ChatItem[]) {
  const { item: last, at } = flowTail(items)
  return last?.kind === 'thinking' && last.streaming
    ? replaceAt(items, at, { ...last, streaming: false, endedAt: Date.now() })
    : items
}

function sealAssistant(items: ChatItem[]) {
  const { item: last, at } = flowTail(items)
  return last?.kind === 'assistant' && last.streaming
    ? replaceAt(items, at, { ...last, text: last.text.trim(), streaming: false })
    : items
}

/** Nothing is live anymore: seal the reply, close its thinking and tick off its steps. */
function settle(items: ChatItem[]) {
  return closeThinking(sealAssistant(items)).map((i) =>
    i.kind === 'tool' && i.status === 'running' ? { ...i, status: 'done' as const, endedAt: Date.now() } : i,
  )
}

function errorText(e: unknown) {
  return friendlyError(e instanceof Error ? e.message : String(e))
}

/** Hermes errors are written for terminals. Say it like a person would (src/features/chat/errors.ts). */
export function friendlyError(raw: string) {
  return explainError(raw).text
}

// ── Wiring ──────────────────────────────────────────────────────────────────

/**
 * Hermes dropped a chat's waiting approvals (Hermes 0.22: the turn was
 * stopped, or the chat let go) and treated them as a no. A tab still attached
 * also gets request.cancel; this catches cards brought back by a replay or a
 * reload. It names approvals by their own id, or none for all of the chat's.
 */
function cancelApprovals(payload: P) {
  const id = runtimeToStored.get(String(payload.session_id ?? '')) ?? (typeof payload.stored_session_id === 'string' ? payload.stored_session_id : '')
  if (!id || !getChat(id)) return
  const named = Array.isArray(payload.request_ids) ? payload.request_ids.map(String) : []
  const hit = (i: ChatItem): i is Extract<ChatItem, { kind: 'approval' }> =>
    i.kind === 'approval' && i.status === 'pending' && (!named.length || (!!i.approvalId && named.includes(i.approvalId)))
  const items = getChat(id)!.items
  if (!items.some(hit)) return
  for (const i of items) if (hit(i)) requests.delete(i.requestId)
  patch(id, (c) => {
    const next = c.items.map((i): ChatItem => (hit(i) ? { ...i, status: 'expired' } : i))
    const stillAsking = next.some(isAsking)
    return { status: c.status === 'waiting' && !stillAsking ? 'working' : c.status, items: next }
  })
}

let wired = false

export function wireChats() {
  if (wired) return
  wired = true
  gateway.onEvent(onEvent)
  gateway.onRequest(onServerRequest)
  gateway.onEvent((ev) => {
    if (ev.type === 'session.reclaimed') {
      const runtimeId = String((ev as { payload?: P }).payload?.session_id ?? '')
      const id = runtimeToStored.get(runtimeId)
      runtimeToStored.delete(runtimeId)
      if (id) patch(id, () => ({ runtimeId: undefined }))
    }
    if (ev.type === 'approval.cancelled') cancelApprovals(((ev as { payload?: P }).payload ?? {}) as P)
  })
  // After a reconnect, re-attach the chat on screen and any that are busy, so
  // their events flow again (Hermes's client replays anything we missed). The
  // rest are let go: Hermes reaps them, and they re-attach when next used.
  // Back in the foreground, online again, or Hermes back: history that couldn't be read is read now.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && readUnread())
  window.addEventListener('online', readUnread)
  gateway.onState((state) => {
    if (state !== 'open') return
    readUnread()
    for (const chat of Object.values(useChats.getState().chats)) {
      if (!chat.runtimeId) continue
      if (viewing.has(chat.id) || isBusy(chat)) {
        attach(chat.id).catch(() => patch(chat.id, () => ({ runtimeId: undefined })))
      } else {
        runtimeToStored.delete(chat.runtimeId)
        patch(chat.id, () => ({ runtimeId: undefined }))
      }
    }
  })
}
