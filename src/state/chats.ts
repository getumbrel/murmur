// Live chats. Hermes streams events for every session over one socket; this
// store folds them into ChatItems that the UI renders.
//
// Ids: Hermes gives each chat a stored id (permanent, e.g. "20261013_122615_…")
// and a runtime id while it's live in memory (8 hex chars, reaped ~20s after
// the last viewer leaves). Everything here is keyed by the stored id; the
// runtime id is only used to talk to Hermes and to route its events.

import { create } from 'zustand'
import { gateway, rpc, useConnection, whenOpen, type GatewayEvent, type ServerRequest } from '@/hermes/gateway'
import { api, HermesError, on } from '@/hermes/rest'
import { isMissingMethod } from '@/hermes/compat'
import { attachmentsDir, fitPhoto, isPhoto, upload } from '@/features/media/upload'
import { restoreChatConnect } from '@/state/hosted-apps-chat'
import type { ConnectionRequestPayload } from '@/hermes/vendor/gateway-contract.generated'
import { foundSubjects, readingLabel, resultLabel, toolLabel, tookFor } from '@/features/chat/tool-labels'
import { approvalText, detailOf, isCallTo, toolAsked, type ToolCall } from '@/features/chat/approval-text'
import { explainError } from '@/features/chat/errors'
import { holdsSummary } from '@/features/chat/compaction'
import type { ApprovalChoice, ChatItem, ChatStatus, ClarifyQuestion, Reaction, SecretAsk, Speaker } from '@/features/chat/types'
import { fileRef, parseUserMessage, picturesIn, rememberUpload, type UserAttachment } from '@/features/media/parse'
import { toolMedia } from '@/features/media/tool-media'
import { shotOf } from '@/features/machine/shots'
import { foundIn, pendingIn } from '@/features/umbrel/finds'
import { firstHermes, hermesIds, hermesOf, homeOf, mainOn, noteHome, scoped } from '@/hermes/instance'
import { forgetFrames } from '@/state/browser-frames'
import { held, hold, release, type Held } from '@/state/outbox'
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
import { sameRunning, stillRunning, type Kept, type Running } from '@/features/chat/running'
import { along, madeRoutine, soundsScheduled, toldIn, type Carried } from '@shared/routines.ts'
import { reportHere } from '@/state/routines'
import { forgetKeptChat, keepChat, keptChat } from '@/state/kept'
import { awayOn, useReach } from '@/state/reach'

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
  /**
   * Hermes hasn't been read yet, and can't be right now: these are the messages
   * as this device last saw them, then (state/kept.ts). Gone once it's read.
   */
  asOf?: number
  /** This device kept no copy of it to show meanwhile. */
  unkept?: boolean
  /** It couldn't be read or opened for a while: it's still being tried, and you can ask for it now. */
  stalled?: boolean
  /** Hermes has older history than what's been read: loadOlder brings it in. */
  older?: boolean
  /** Its own row has been read, so `title` is what Hermes has (none, if it's unset). */
  named?: boolean
  /** Speaker for one-to-one chats; group chats tag items individually. */
  speaker?: Speaker
  /** Counts finished replies, so widgets know to re-read files the agent may have rewritten. */
  turns?: number
  /** Hermes said it summarized the chat just now, a summary you asked for included; its history says so afterwards. */
  summarized?: boolean
  /** What the agent is working toward (/goal), while one is set. */
  goal?: Goal
  /** Counts the times you've been sweet to the agent (thanks, <3), so its face can show it. */
  vibes?: number
  /** A turn begun elsewhere (a helper back, say) that this page hasn't shown yet: working, for lists. */
  starting?: boolean
  /** The agent has been told how routines report in this chat (shared/routines.ts). */
  told?: boolean
  /**
   * The chat this one was carried on from (Continue in a new chat, or a copy
   * Hermes made itself): which, what Hermes calls it, and when the copy was
   * made. Everything said before then came over with it.
   */
  from?: { id: string; title: string; at: number }
  /** Commands the agent started and left going, past the end of its reply (features/chat/running.ts). */
  running?: Running
  /** You asked for them to be stopped; Hermes hasn't said they have yet. */
  stopping?: boolean
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
  noteHome(id, hermesOf(profile))
  if (!useChats.getState().chats[id]) {
    useChats.setState((s) => ({
      chats: { ...s.chats, [id]: { id, profile, items: [], status: 'idle', ready: false } },
    }))
  }
}

/** The Hermes a chat is on: its agent's. */
const hermesOfChat = (id: string) => {
  const chat = getChat(id)
  return chat ? hermesOf(chat.profile) : (homeOf(id) ?? firstHermes())
}

function bindRuntime(id: string, runtimeId: string) {
  runtimeToStored.set(runtimeId, id)
  // Calls that name only the live chat go to its Hermes (hermes/route.ts).
  noteHome(runtimeId, hermesOfChat(id))
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

export type Row = {
  id?: number
  role: string
  content?: string | null
  /** The pictures saved in your message itself, when Hermes saved it in parts. */
  pictures?: string[]
  tool_calls?: { id?: string; call_id?: string; function?: { name: string; arguments?: string } }[] | null
  tool_call_id?: string | null
  tool_name?: string | null
  reasoning?: string | null
  display_kind?: string | null
  /** `submission_id`: what the request was sent as (a group's turn names its room task there). */
  display_metadata?: { reactions?: unknown; submission_id?: unknown } | null
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
  const argsOf = new Map<Extract<ChatItem, { kind: 'tool' }>, unknown>()
  const plans = new Set<string>()
  // What the agent's email searches found, so a read says which email.
  const subjects = new Map<string, string>()
  for (const [n, row] of rows.entries()) {
    const at = (row.timestamp ?? 0) * 1000
    const key = `h${row.id ?? items.length}`
    // Where Hermes summarized the chat so far, the step says so. (A summary
    // folded into a message is shown with that message, below.)
    const summary = (row.role === 'user' || row.role === 'assistant') && holdsSummary(row)
    const shown = typeof row.display_content === 'string' ? row.display_content : undefined
    if (summary && shown == null) {
      if (items.at(-1)?.kind !== 'compaction') items.push({ kind: 'compaction', id: key, status: 'done', speaker })
      continue
    }
    // Hidden turns aren't for the person at all.
    if (row.display_kind === 'hidden') continue
    // Hermes writing in the person's name: waking the agent (a helper back, say) or a note to the model.
    if (row.role === 'user' && !isYours(row)) {
      items.push(...wakeItems(row, key, errands, rows[n + 1]?.role === 'assistant'))
      continue
    }
    if (row.role === 'user') {
      const raw = shown ?? row.content ?? ''
      // A message sent mid-reply is stored wrapped in Hermes's steering markers (an older Hermes shows them).
      const { text, attachments } = parseUserMessage(
        row.display_kind === 'steer' && shown == null ? (STEER.exec(raw)?.[1] ?? raw) : raw,
        row.pictures,
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
      // Its reply begins where Hermes summarized what came before.
      if (summary) items.push({ kind: 'compaction', id: `${key}-sum`, status: 'done', speaker })
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
      if (summary) items.push({ kind: 'compaction', id: `${key}-sum`, status: 'done', speaker })
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
      const text = (shown ?? row.content)?.trim()
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
            page: label.page,
            // Done once its result row turns up; one still waiting (on your OK, say) is still going.
            status: 'running',
            startedAt: at,
            speaker,
          }
          argsOf.set(tool, args)
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
        tool.took = tookFor(tool.name, row.content)
        for (const [id, subject] of foundSubjects(tool.name, row.content)) subjects.set(id, subject)
        const media = toolMedia(tool.name, row.content)
        if (media.length) tool.media = media
        const shot = tool.status === 'done' ? shotOf(tool.name, argsOf.get(tool), row.content) : null
        if (shot) tool.shot = shot
        const found = tool.status === 'done' ? foundIn(tool.name, argsOf.get(tool), row.content) : undefined
        if (found) tool.found = found
        const made = tool.status === 'done' ? madeRoutine(tool.name, row.content) : undefined
        if (made) tool.routineId = made
      }
    }
  }
  return items
}

/**
 * The steps in a stretch of saved rows, named for their calls as the live
 * stream names them, so a step keeps its place from when it starts to after
 * it's read back. How a group finds its agents' steps (state/group-steps.ts).
 */
export function stepsIn(rows: Row[]): Extract<ChatItem, { kind: 'tool' }>[] {
  return rowsToItems(rows).flatMap((item) =>
    item.kind === 'tool' ? [{ ...item, id: `tool-${item.id.replace(/^h\d+-/, '')}` }] : [],
  )
}

/** A message's words, when Hermes saved it in parts (text beside a picture): the text, without the rest (picturesIn reads your pictures). */
function words(content: unknown): string | null {
  if (typeof content === 'string' || content == null) return content ?? null
  const parts = Array.isArray(content) ? content : [content]
  return parts
    .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
    .join('')
}

/** A saved row as this page reads it: whatever shape Hermes kept its words in, they're text here, and your pictures beside them. */
function plain(row: Row): Row {
  const calls = Array.isArray(row.tool_calls) ? row.tool_calls.filter((c) => c && typeof c === 'object') : null
  const pictures = row.role === 'user' ? picturesIn(row.content) : []
  return {
    ...row,
    content: words(row.content),
    pictures: pictures.length ? pictures : undefined,
    reasoning: typeof row.reasoning === 'string' ? row.reasoning : null,
    tool_calls: calls,
  }
}

/** The most rows Hermes sends at once. A page that full may have older rows behind it. */
const PAGE = 500

/**
 * A chat's saved rows, oldest first: its newest page, or the one `offset`
 * rows back from its end. Every message, including the ones Hermes has
 * since summarized for the model (its own clients read them the same way).
 * `pictures: false` leaves the pictures in messages out, for a read that's
 * only after the steps.
 */
export async function readRows(id: string, profile: string, offset = 0, { limit = PAGE, pictures = true } = {}) {
  type Res = { messages?: Row[]; data?: Row[] }
  const query =
    `profile=${encodeURIComponent(profile)}&order=latest&limit=${limit}&include_compacted=true` +
    (pictures ? '' : '&inline_images=false')
  const res = await api.get<Res>(
    `/api/sessions/${encodeURIComponent(id)}/messages?${query}${offset ? `&offset=${offset}` : ''}`,
    // A server that has gone out of reach can leave a request hanging for minutes: give up, and try again.
    { signal: AbortSignal.timeout(30_000) },
  )
  const rows = (res.messages ?? res.data ?? []).map(plain)
  // An older Hermes gave a "latest" page newest first; put it back in reading order. (A row
  // copied forward when Hermes summarized keeps its place but not its id: both have to say so.)
  const first = rows[0]
  const end = rows.at(-1)
  if (first && end && (first.id ?? 0) > (end.id ?? 0) && (first.timestamp ?? 0) > (end.timestamp ?? 0)) rows.reverse()
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

/**
 * Read a chat back to its first message, for what needs all of it: finding
 * something said in it, or handing the whole of it over. Nothing to do for a
 * chat that fits in one page, which is most of them.
 */
export async function loadWhole(id: string) {
  while (getChat(id)?.older) {
    const before = reach.get(id)?.offset
    await loadOlder(id)
    // (A read that got nowhere would be asked again for ever.)
    if (reach.get(id)?.offset === before) break
  }
}

async function readOlder(id: string) {
  const chat = getChat(id)
  const read = reach.get(id)
  if (!chat?.older || !read) return
  const page = await readRows(id, chat.profile, read.offset)
  // Rows saved since push every page back a little: what's already read is left out.
  const have = new Set(read.rows.map((r) => r.id))
  const overlap = page.findIndex((r) => r.id != null && have.has(r.id))
  const rows = overlap < 0 ? page : page.slice(0, overlap)
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
 * Not `live`: a turn joined part-way on a new connection, whose steps so far are read too.
 */
async function catchUpTurn(id: string, live = true, before = new Set(getChat(id)?.items.map((i) => i.id))) {
  for (const wait of [0, 250, 500, 1000, 2000]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    if (!begunElsewhere.has(id) || (await catchUp(id, live, before))) return
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
  if (!chat.named) void readTitle(id, profile)
  if (!chat.ready) void findKept(id, profile)
  const task = (async () => {
    try {
      if (!chat.ready && !(await readHistory(id, profile, speaker))) return
      await open(id)
    } finally {
      opening.delete(id)
    }
  })()
  opening.set(id, task)
  return task
}

/**
 * Read a chat's history until it's read: a read that fails, or rows this page
 * can't make sense of, is tried again, soon and then less often, and at once
 * when the app or Hermes comes back or you ask. Only a chat Hermes doesn't
 * have yet opens empty; one that can't be read never does. False if the chat
 * was left first.
 */
async function readHistory(id: string, profile: string, speaker?: Speaker) {
  for (let tries = 0; ; tries++) {
    let rows: Row[]
    let items: ChatItem[]
    try {
      // Hermes doesn't have it: new, or gone. Opening it says which.
      let missing = false
      rows = await readRows(id, profile).catch((e): Row[] => {
        if (!(e instanceof HermesError && e.status === 404)) throw e
        missing = true
        return []
      })
      if (missing) absent.add(id)
      else absent.delete(id)
      items = rowsToItems(rows, speaker)
    } catch {
      // It can't be read right now: as it was last seen here, meanwhile.
      showKept(id)
      // A few seconds of trying, then it says so.
      if (tries === 2) patch(id, () => ({ stalled: true }))
      await nextTry(id, Math.min(30_000, 1000 * 2 ** tries))
      if (!viewing.has(id)) return false
      continue
    }
    reach.set(id, { rows, offset: rows.length })
    // Anything sent while it loaded comes after the history, once: a message
    // Hermes saved meanwhile is in the history already.
    const saved = new Set(items.map(rowOf))
    // What stood in for it meanwhile (state/kept.ts) gives way to it.
    const stoodIn = new Set(lastSeen.get(id)?.items.map((i) => i.id))
    lastSeen.delete(id)
    patch(id, (c) => ({
      items: [...items, ...c.items.filter((i) => !stoodIn.has(i.id) && (rowOf(i) == null || !saved.has(rowOf(i))))],
      ready: true,
      asOf: undefined,
      unkept: undefined,
      stalled: undefined,
      older: rows.length >= PAGE,
      told: c.told || rows.some((r) => r.role === 'user' && toldIn(r.content ?? '')),
    }))
    return true
  }
}

/** Chats being opened that this device kept a copy of, to show if Hermes can't be read. */
const lastSeen = new Map<string, { items: ChatItem[]; title?: string; at: number }>()

/** Looks for this device's copy of a chat being opened, and shows it at once when its agent can't be reached. */
async function findKept(id: string, profile: string) {
  const kept = await keptChat(id, profile)
  const chat = getChat(id)
  if (!chat || chat.ready || !viewing.has(id)) return
  if (!kept) return patch(id, () => ({ unkept: true }))
  lastSeen.set(id, kept)
  if (awayOn(hermesOf(profile))) showKept(id)
}

/** The chat as it was last seen here, while it can't be read. Nothing to do once anything of it is on screen. */
function showKept(id: string) {
  const kept = lastSeen.get(id)
  if (!kept) return
  patch(id, (c) => (c.ready || c.items.length ? undefined : { items: kept.items, asOf: kept.at, title: c.title ?? kept.title }))
}

/** Chats Hermes had no history for when asked: new ones, and ones that are gone. */
const absent = new Set<string>()

/** Hermes saying a chat doesn't exist, as opposed to refusing to open one it has. */
const saysGone = (e: unknown) => {
  const { code, message } = e as { code?: number; message?: string }
  return code === 4007 && /\bnot found\b/i.test(message ?? '')
}

/**
 * Attach a chat being opened, until it's attached. Hermes can turn an open
 * away for a moment (it's letting the chat go for another app, or settling a
 * reply that was cut off) or for longer; either way it's tried again like
 * history is, quietly at first, and then the chat says it can't be opened and
 * keeps trying. Only a chat Hermes has neither history nor a place for is
 * gone: that one throws.
 */
async function open(id: string) {
  for (let tries = 0; ; tries++) {
    try {
      await attach(id, true)
      patch(id, (c) => (c.stalled ? { stalled: undefined } : undefined))
      return
    } catch (e) {
      if (absent.has(id) && saysGone(e)) throw e
      if (tries === 2) patch(id, () => ({ stalled: true }))
      await nextTry(id, Math.min(30_000, 1000 * 2 ** tries))
      if (!viewing.has(id)) return
    }
  }
}

/**
 * A chat's name, from its own row: the lists hold only an agent's newest
 * chats, so an older one isn't in them. One said live since is newer.
 */
async function readTitle(id: string, profile: string) {
  const row = await readSession(id, profile)
  patch(id, (c) => ({ named: true, ...(c.title === undefined && row?.title ? { title: row.title } : {}) }))
  // Carried on from another chat: Hermes keeps which on the copy. One that's gone leaves nothing to go back to.
  const parent = configOf(row)._branched_from
  if (typeof parent !== 'string' || !parent || parent === id || getChat(id)?.from) return
  const origin = await readSession(parent, profile)
  if (origin) patch(id, (c) => (c.from ? undefined : { from: { id: parent, title: origin.title ?? '', at: (row?.started_at ?? 0) * 1000 } }))
}

type SessionRow = { title?: string | null; model_config?: unknown; started_at?: number }

/** A chat's own row, or null when Hermes doesn't have it (or can't be asked). */
const readSession = (id: string, profile: string) =>
  api.get<SessionRow>(`/api/sessions/${encodeURIComponent(id)}?profile=${encodeURIComponent(profile)}`).catch(() => null)

/** What Hermes keeps beside a chat's model (it's stored as text), as an object. */
function configOf(row: { model_config?: unknown } | null | undefined): Record<string, unknown> {
  let config = row?.model_config
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config)
    } catch {
      return {}
    }
  }
  return config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>) : {}
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
  if (!getChat(id)?.asOf) lastSeen.delete(id)
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
  // Hermes replays what a page missed only on the live connection it was on, from the last thing
  // it heard there. On another one (Hermes let that one go while no page was on it), nothing is.
  const anew = res.session_id !== chat.runtimeId
  bindRuntime(id, res.session_id)
  restoreChatConnect(res.session_id, res.pending_connection)
  if (!attaching) parked.clear()
  const busy = res.running || ['working', 'streaming', 'starting'].includes(res.status ?? '')
  // A message sent while we asked started a turn this answer doesn't know about.
  const fresher = (asked.get(id) ?? 0) >= since
  const before = new Set(getChat(id)?.items.map((i) => i.id))
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
  // Back on with a reply under way that this page wasn't in: it began while the page was off, and
  // its start may never get here. Bring in what was asked, and on a new connection the steps so
  // far too (on the same one they're replayed). Its end brings in what started it if that isn't
  // saved yet.
  if (busy && !first && !fresher && (anew || !wasBusy)) {
    begunElsewhere.add(id)
    void catchUpTurn(id, !anew, before).catch(() => {})
  }
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
// Kept with the Hermes the chat is on.
const pickKey = (id: string) => scoped('murmur:chat-pick:', hermesOfChat(id)) + id

function readPick(id: string): Pick | null {
  try {
    return JSON.parse(localStorage.getItem(pickKey(id)) ?? 'null') as Pick | null
  } catch {
    return null
  }
}

function savePick(id: string, next: Pick | null) {
  try {
    const merged = next && { ...readPick(id), ...next }
    if (merged && Object.values(merged).some(Boolean)) localStorage.setItem(pickKey(id), JSON.stringify(merged))
    else localStorage.removeItem(pickKey(id))
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
  noteHome(id, hermesOf(profile))
  useChats.setState((s) => ({
    chats: {
      ...s.chats,
      [id]: {
        id,
        profile,
        items: [],
        status: 'idle',
        ready: true,
        // Brand new: any name it gets arrives live.
        named: true,
        ...(opts.title ? { title: opts.title } : {}),
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
  const call = async () => rpc<T>(method, { session_id: await live(id), ...params }, undefined, hermesOfChat(id))
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

/** The full prompt each message went out with (refs included), for Try again. */
const prompts = new Map<string, string>()

/** A message Hermes doesn't have yet: its words and files, so Try again can finish sending it. */
const unsent = new Map<string, { text: string; files: File[] }>()

/** Pictures you sent, shown from memory until their chat goes away. */
const pictures = new Map<string, string[]>()

/** What a message shows for its files: thumbnails for pictures, chips for the rest. */
export function attachmentsOf(files: File[]): UserAttachment[] {
  return files.map((f) =>
    isPhoto(f)
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
  /**
   * Said out loud on a call: Hermes answers it as a voice turn (fast, brief,
   * speakable), with the recent spoken exchange for context and whether you
   * cut the last answer off.
   */
  voice?: { interrupted?: boolean; context?: string }
}

/**
 * Send a message, with any files. Photos go to the model natively; other
 * files go to the agent's attachments on Hermes and are referenced as
 * `@file:`, which Hermes reads into the prompt when they're small enough.
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
    pending: true,
  }
  asked.set(id, Date.now())
  const after = Math.max(-1, ...chat.items.map((i) => rowOf(i) ?? -1))
  // Waiting for the connection, it isn't thinking yet: that starts once Hermes is there to take it.
  const now = busy || useConnection.getState(hermesOf(chat.profile)).state !== 'open' ? undefined : 'thinking'
  patch(id, (c) => ({ items: [...c.items, item], status: now ?? c.status }))
  unsent.set(itemId, { text, files })
  hold(id, { id: itemId, text: shown, ...(files.length ? { files: files.map((f) => f.name) } : {}), after })
  // (A copy's first message: Hermes names the chat from it.)
  await releaseStandIn(id)
  await deliver(id, itemId, busy, opts.voice)
}

/**
 * Messages that were still waiting on Hermes when this chat's page last
 * closed, and never reached it: out of the outbox, for their words to go back
 * in the box. One Hermes saved after all (its answer was lost) stays out.
 */
export function heldBack(id: string): Held[] {
  const items = getChat(id)?.items ?? []
  const here = new Set(items.map((i) => i.id))
  const gone = held(id).filter((m) => !here.has(m.id))
  release(id, gone.map((m) => m.id))
  const saved = (m: Held) => items.some((i) => i.kind === 'user' && (i.rowId ?? -1) > (m.after ?? -1) && i.text === m.text)
  return gone.filter((m) => !saved(m))
}

/**
 * Get a message to Hermes: its files up, then its words. Run again by Try
 * again, it sends only what didn't get there; a picture already up is queued
 * once more by where it is (still queued if Hermes kept the chat, gone if it
 * didn't: once either way).
 */
async function deliver(id: string, itemId: string, steer = false, voice?: SendOptions['voice']) {
  const chat = getChat(id)
  const message = unsent.get(itemId)
  if (!chat || !message) return
  const { text, files } = message
  try {
    // Held while the connection's down; it's thinking from when it goes.
    await whenOpen(hermesOf(chat.profile))
    asked.set(id, Date.now())
    patch(id, (c) => (isBusy(c) ? undefined : { status: 'thinking' }))
    const refs: string[] = []
    let dir: string | undefined
    for (const [i, file] of files.entries()) {
      const up = attachmentOf(id, itemId, i)?.path
      if (isPhoto(file)) {
        if (up) {
          await onChat(id, 'image.detach', { path: up })
          await onChat(id, 'image.attach', { path: up })
          continue
        }
        const photo = await fitPhoto(file)
        const data = await readDataUrl(photo)
        const res = await onChat<{ path?: string }>(id, 'image.attach_bytes', {
          content_base64: data.split(',')[1] ?? '',
          filename: photo.name || 'image.png',
        })
        if (res.path) {
          patchAttachment(id, itemId, i, { path: res.path })
          if (photo.name) rememberUpload(res.path, photo.name)
        }
      } else {
        if (up) {
          refs.push(fileRef(up))
          continue
        }
        // Onto Hermes's disk, then attached from there. (PDFs too: pdf.attach
        // needs poppler, which Hermes may not have.)
        dir ??= await attachmentsDir(chat.profile)
        const path = await upload(file, dir, (progress) => patchAttachment(id, itemId, i, { progress }), hermesOf(chat.profile)).finally(() =>
          patchAttachment(id, itemId, i, { progress: undefined }),
        )
        const res = await onChat<{ path?: string; ref_path?: string; uploaded?: boolean }>(id, 'file.attach', { path })
        // Outside the chat's folder, Hermes copies it to where it already is, under a second name: ours will do.
        if (res.uploaded && res.path) void api.delete('/api/files', { path: res.path }, on(hermesOf(chat.profile))).catch(() => {})
        const ref = res.uploaded ? path : res.ref_path
        if (ref) {
          refs.push(fileRef(ref))
          patchAttachment(id, itemId, i, { path: ref })
        }
      }
    }
    // What the chat's routines reported since your last message goes along, and once, how they report here.
    const found = reports.get(id)?.(lastAsked(getChat(id)?.items ?? [], itemId)) ?? []
    const routines = found.length > 0 || chat.items.some((i) => i.kind === 'tool' && !!i.routineId)
    const note = !getChat(id)?.told && (routines || soundsScheduled(text))
    const extra = along({ found, note })
    if (note) patch(id, () => ({ told: true }))
    const prompt = [promptOf(refs, text), extra].filter(Boolean).join('\n\n')
    prompts.set(itemId, prompt)
    // Written while the agent waits on a question, it's the reply: Hermes would hold it behind the
    // question until the wait ran out, so the wait ends and it goes in as a message of its own.
    const question = steer ? waitingOn(getChat(id)) : undefined
    if (question) await replyInstead(id, question)
    // While it's working, a new message steers the current reply instead of
    // waiting its turn — the way you'd interrupt a person mid-thought. (Before
    // the agent is up it can't be steered yet; then it waits its turn.)
    const steered =
      !question &&
      steer &&
      !files.length &&
      (await onChat(id, 'session.steer', { text: prompt }).then(() => true, () => false))
    if (!steered) {
      const spoken = voice
        ? {
            voice_turn: true,
            surface: 'voice-live',
            // What you said, for Hermes's titler, which would otherwise see mostly its note for the model.
            title_preview: text,
            ...(voice.context ? { voice_context: voice.context } : {}),
            ...(voice.interrupted ? { interrupted: true } : {}),
          }
        : {}
      const submit = () => onChat<SubmitResult>(id, 'prompt.submit', { text: prompt, profile: chat.profile, ...spoken })
      const res = question ? await whileSettling(submit) : await submit()
      if (res.user_row_id != null) setRowId(id, itemId, res.user_row_id)
    }
    unsent.delete(itemId)
    release(id, [itemId])
    taken(id, itemId)
  } catch (e) {
    taken(id, itemId)
    patch(id, (c) => ({
      status: 'error',
      items: [...c.items, { kind: 'error', id: uid('e'), message: attachError(e), retryable: true }],
    }))
  }
}

/**
 * An exchange the live voice answered by itself, into the chat as ordinary messages. It only ever
 * reached OpenAI, so Hermes files it through the image's plugin. Throws while a turn is running
 * (409): Hermes's history can't change under one.
 */
export async function keepSpoken(id: string, you: string, voice: string, itemId: string) {
  const chat = getChat(id)
  if (!chat) return
  const { rows } = await api.post<{ rows: [number, number] }>(
    `/api/plugins/murmur-voice/spoken?profile=${encodeURIComponent(chat.profile)}`,
    { chat: id, you, voice },
  )
  const at = Date.now()
  patch(id, (c) => ({
    items: [
      ...c.items,
      { kind: 'user', id: itemId, text: you, at, rowId: rows[0] },
      { kind: 'assistant', id: uid('a'), text: voice, streaming: false, at, speaker: c.speaker, rowId: rows[1] },
    ],
  }))
}

/** Hermes has the message, or answered it with an error: it's waiting on nothing now. */
function taken(id: string, itemId: string) {
  patch(id, (c) => ({ items: c.items.map((i) => (i.id === itemId && i.kind === 'user' ? { ...i, pending: undefined } : i)) }))
}

/** Each open chat's routines' reports since a time, for a message there to take along (state/findings.ts). */
const reports = new Map<string, (since: number) => Carried[]>()

/** Hear what a chat's routines report, or stop. */
export function hearReports(id: string, since?: (at: number) => Carried[]) {
  if (since) reports.set(id, since)
  else reports.delete(id)
}

/** When you last wrote in a chat, before this message. */
function lastAsked(items: ChatItem[], itemId: string) {
  const end = items.findIndex((i) => i.id === itemId)
  const before = items.slice(0, end < 0 ? items.length : end)
  return before.findLast((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user')?.at ?? 0
}

/** A message's words with its files' refs ahead of them, the way it goes to Hermes. */
const promptOf = (refs: string[], text: string) =>
  [refs.join('\n'), text].filter(Boolean).join('\n\n') || 'What do you see in this image?'

function attachmentOf(id: string, itemId: string, index: number) {
  const item = getChat(id)?.items.find((i) => i.id === itemId)
  return item?.kind === 'user' ? item.attachments?.[index] : undefined
}

/**
 * News of one of a message's files: how far along it is going up, or where it
 * landed on Hermes (what lets it be sent again without sending it twice).
 */
function patchAttachment(id: string, itemId: string, index: number, news: { path?: string; progress?: number }) {
  patch(id, (c) => ({
    items: c.items.map((i) =>
      i.id === itemId && i.kind === 'user' && i.attachments?.[index]
        ? { ...i, attachments: i.attachments.map((a, at) => (at === index ? { ...a, ...news } : a)) }
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
 * back so the screen can move to it. It's the words of the conversation that
 * are copied, on any Hermes: `session.branch_stored` takes your messages and
 * the agent's replies and leaves its steps behind (checked on 0.23.1), as the
 * fallback for a Hermes without it does. (continueFrom copies the steps too.)
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

// ── Carrying a chat on in a new one ─────────────────────────────────────────
// "Continue in a new chat" under a reply: the chat up to and including that
// reply becomes a chat of its own, steps and all, and the one it came from
// stays as it is.
//
// Hermes's own ways of copying a chat don't do it from here (checked on
// 0.23.1): `session.mutate`'s branch cuts at a row and keeps everything, but
// it lives on Hermes's session authority, which the dashboard's socket doesn't
// have ("unknown method"); `session.branch` and `session.branch_stored` copy
// only what was said, so the agent's steps are gone and it no longer knows
// what they found. What does keep everything is the dashboard's own export
// and import of a chat: the rows are read out whole, cut after the reply,
// and put back under a new id.

/** Why a chat couldn't be carried on: for the screen to say. */
export class ContinueError extends Error {
  why: 'summarized' | 'large' | 'failed'
  constructor(why: ContinueError['why']) {
    super(why)
    this.why = why
  }
}

export type ExportedRow = { id: number; role?: string; active?: unknown; compacted?: unknown; [key: string]: unknown }
type Exported = { title?: string | null; model_config?: unknown; messages?: ExportedRow[]; [key: string]: unknown }

/** What of a chat's own row its copy keeps: how it talks to its model, and where it works. The rest starts afresh. */
const CARRIED = ['model', 'system_prompt', 'user_id', 'cwd', 'git_branch', 'git_repo_root', 'billing_provider', 'billing_base_url', 'billing_mode']

const set = (flag: unknown) => flag === true || flag === 1 || flag === '1'
/** Still part of the conversation (rows from before these flags existed all are). */
const inPlay = (row: ExportedRow) => row.active == null || set(row.active)

/** An id shaped like the ones Hermes gives its chats: the date, the time, six hex digits. */
function newChatId() {
  const now = new Date().toISOString()
  const hex = Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0')
  return `${now.slice(0, 10).replace(/-/g, '')}_${now.slice(11, 19).replace(/:/g, '')}_${hex}`
}

/**
 * Whether a Hermes can carry a chat on in a new one: it has to be able to
 * take a chat in. Hermes has had that since 0.22.0, and nothing says so short
 * of trying; what it added in 0.22.3 for changing chats safely (a chat's
 * revision, read here for a chat that doesn't exist) can be asked for without
 * changing anything, and a Hermes that answers has both.
 */
export async function canContinue(hermes: string | null) {
  try {
    const snapshot = await api.get<{ exists?: boolean } | null>('/api/sessions/murmur-can-continue/mutation-snapshot', on(hermes))
    return typeof snapshot?.exists === 'boolean'
  } catch {
    return false
  }
}

/**
 * The rows a copy keeps when it's cut after the row `rowId`: every row up to
 * it that's still part of the conversation, and the earlier ones Hermes has
 * summarized (they stay, as history). Rows taken back by an edit or an undo
 * don't come. Null when that row isn't in the conversation any more: a reply
 * Hermes has since summarized away, which a chat can't pick up from (it would
 * open with the agent knowing none of it).
 */
export function carried(rows: ExportedRow[], rowId: number): ExportedRow[] | null {
  // (Ids run in the order the agent reads the conversation.)
  const at = rows.findIndex((r) => r.id === rowId)
  if (at < 0 || !inPlay(rows[at])) return null
  // The results of any calls that row made answer it, so they go with it: Hermes's own cut does the same.
  let through = rowId
  for (const row of rows.slice(at + 1)) {
    if (!inPlay(row)) continue
    if (row.role !== 'tool') break
    through = row.id
  }
  return rows.filter((r) => r.id <= through && (inPlay(r) || set(r.compacted)))
}

/**
 * Copies a chat in Hermes, up to and including the row `rowId`: your
 * messages, the agent's replies, every step and what it found. Gives back the
 * copy's id, when it was made, and what the chat it came from is called. The
 * chat it came from isn't touched. Throws a ContinueError, with nothing made,
 * if it couldn't.
 */
export async function copyChat(id: string, profile: string, rowId: number) {
  const q = `profile=${encodeURIComponent(profile)}`
  const exported = await api.get<Exported>(`/api/sessions/${encodeURIComponent(id)}/export?${q}`)
  const messages = carried((exported.messages ?? []).filter((r) => typeof r?.id === 'number'), rowId)
  if (!messages) throw new ContinueError('summarized')

  const copy = newChatId()
  const startedAt = Date.now() / 1000
  const config: Record<string, unknown> = { ...configOf(exported), _branched_from: id }
  // (How full the original was is its own count; the copy's is taken on its first turn.)
  delete config._usage_anchor
  const session = {
    ...Object.fromEntries(CARRIED.map((key) => [key, exported[key] ?? null])),
    id: copy,
    source: 'desktop',
    // Unnamed, the first thing said in it names it (Hermes names a chat that has none).
    title: null,
    parent_session_id: id,
    started_at: startedAt,
    model_config: JSON.stringify(config),
    messages,
  }
  // From Hermes 0.22.3 a change to its chats carries a revision, and an id of its own so a retry can't apply twice.
  const snapshot = await api.get<{ runtime_revision?: number }>(`/api/sessions/${copy}/mutation-snapshot?${q}`).catch(() => null)
  let res: { imported?: number } | null
  try {
    res = await api.post<{ imported?: number } | null>('/api/sessions/import', {
      profile,
      request_id: `continue-${copy}`,
      expected_revision: snapshot?.runtime_revision ?? 0,
      sessions: [session],
    })
  } catch (e) {
    // Hermes takes a chat of up to 5 MB this way.
    if (e instanceof HermesError && (e.status === 413 || /size limit|too large|import limit/i.test(JSON.stringify(e.detail ?? e.message))))
      throw new ContinueError('large')
    throw e
  }
  if (res?.imported !== 1) throw new ContinueError('failed')
  return { id: copy, at: startedAt * 1000, from: exported.title ?? '' }
}

/**
 * Carry a chat on in a new one, from one of the agent's replies: everything
 * up to and including it is copied, the new chat is opened, and its id comes
 * back so the screen can move to it. Throws a ContinueError if it couldn't.
 */
export async function continueFrom(id: string, itemId: string) {
  const chat = getChat(id)
  const reply = chat?.items.find((i) => i.id === itemId)
  if (!chat || reply?.kind !== 'assistant' || reply.rowId == null) throw new ContinueError('failed')
  const { profile, speaker } = chat
  const made = await copyChat(id, profile, reply.rowId)
  const copy = made.id
  ensure(copy, profile)
  patch(copy, () => ({ from: { id, title: made.from, at: made.at } }))
  // The screen can move to it once it has a name and its messages are read; attaching to it carries on meanwhile.
  const opened = openChat(copy, profile, speaker)
  opened.catch(() => {})
  const [standIn] = await Promise.all([
    nameCopy(copy, profile, made.from).catch(() => undefined),
    Promise.race([opened, until(copy, (c) => c.ready, 10_000)]).catch(() => {}),
  ])
  if (standIn) patch(copy, () => ({ title: standIn }))
  return copy
}

// Until something is said in it, a copy goes by the name of the chat it came
// from, numbered the way Hermes numbers its own copies ("Lisbon in May #2"),
// so it has a name in every list at once. Hermes only renames a chat it named
// itself, and a name given this way reads as yours, so the copy's first
// message lets go of it first: Hermes then names the chat for what's said.

const standInKey = (id: string) => scoped('murmur:stand-in:', hermesOfChat(id)) + id
const NUMBERED = /^(.*?) #(\d+)$/

function standInOf(id: string) {
  try {
    return localStorage.getItem(standInKey(id)) ?? undefined
  } catch {
    return undefined
  }
}

function keepStandIn(id: string, title?: string) {
  try {
    if (title) localStorage.setItem(standInKey(id), title)
    else localStorage.removeItem(standInKey(id))
  } catch {
    /* storage unavailable: the name just stays */
  }
}

/** Names a copy after the chat it came from, with the next number nobody has. An unnamed chat's copy stays unnamed. */
export async function nameCopy(copy: string, profile: string, title: string | null | undefined) {
  // (An agent's main chat is "Bot Chat" to Hermes, hidden under that exact name: there's only ever one.)
  const from = title?.trim()
  if (!from || from === 'Bot Chat') return undefined
  const numbered = NUMBERED.exec(from)
  const stem = numbered ? numbered[1] : from
  const first = numbered ? Number(numbered[2]) + 1 : 2
  for (let n = first; n < first + 12; n++) {
    const name = `${stem} #${n}`
    try {
      await patchSession(copy, profile, { title: name }, 'continue')
      keepStandIn(copy, name)
      return name
    } catch (e) {
      // Taken: an older Hermes says so, a newer one (0.22.5 on) answers a bare 409. The next number, then.
      if (!saysTitleTaken(e) && !(e instanceof HermesError && e.status === 409)) throw e
    }
  }
  return undefined
}

/** Before the first message in a copy: lets go of the name it was lent, if it still has it, so Hermes names it. */
async function releaseStandIn(id: string) {
  const lent = standInOf(id)
  if (!lent) return
  keepStandIn(id)
  const chat = getChat(id)
  if (!chat) return
  try {
    if ((await readSession(id, chat.profile))?.title !== lent) return
    await patchSession(id, chat.profile, { title: '' }, 'continue')
    patch(id, (c) => (c.title === lent ? { title: undefined } : undefined))
  } catch {
    /* it keeps the name */
  }
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

// ── Still running ───────────────────────────────────────────────────────────

/**
 * Ask Hermes what this chat's agent has left running. Only a chat Hermes has
 * live is asked (the one on screen is): a chat isn't brought back for this.
 */
export async function readRunning(id: string) {
  const runtimeId = getChat(id)?.runtimeId
  if (!runtimeId) return
  let running: Running | undefined
  try {
    const res = await rpc<{ processes?: Kept[] }>('process.list', { session_id: runtimeId }, undefined, hermesOfChat(id))
    running = stillRunning(res.processes, Date.now())
  } catch (e) {
    // A blip leaves what was last known. An older Hermes can't say, and one that let the chat go has nothing to say.
    const code = (e as { code?: number } | null)?.code
    if (!isMissingMethod(e) && code !== 4001) return
  }
  patch(id, (c) => {
    if (c.runtimeId !== runtimeId) return
    if (!running) return c.running || c.stopping ? { running: undefined, stopping: false } : undefined
    return sameRunning(c.running, running) ? undefined : { running }
  })
}

/**
 * Keep what's still running in a chat current while it's on screen: read when
 * the chat opens and each time a reply ends, and looked at again every few
 * seconds while something is going, so it's gone soon after it finishes.
 */
export function watchRunning(id: string) {
  const read = () => void readRunning(id)
  const seen = (c?: Chat) => `${c?.runtimeId ?? ''}|${c?.turns ?? 0}|${c && isBusy(c) ? 1 : 0}`
  let last = seen(getChat(id))
  const offChats = useChats.subscribe(({ chats }) => {
    const now = seen(chats[id])
    if (now === last) return
    last = now
    read()
  })
  const visible = () => document.visibilityState === 'visible' && read()
  document.addEventListener('visibilitychange', visible)
  const timer = setInterval(() => document.visibilityState === 'visible' && getChat(id)?.running && read(), 4000)
  read()
  return () => {
    offChats()
    document.removeEventListener('visibilitychange', visible)
    clearInterval(timer)
  }
}

/** Stop what the agent left running in this chat: each command, one by one, and no other chat's. */
export async function stopRunning(id: string) {
  const ids = getChat(id)?.running?.ids ?? []
  if (!ids.length) return
  patch(id, () => ({ stopping: true }))
  try {
    await Promise.all(
      ids.map(async (process_id) => {
        const res = await onChat<{ status?: string }>(id, 'process.kill', { process_id }).catch((e) => {
          // Finished on its own in the meantime: that's stopped too.
          if ((e as { code?: number } | null)?.code === 4044) return { status: 'not_found' }
          throw e
        })
        if (res.status === 'error') throw new Error('Could not stop it')
      }),
    )
  } catch (e) {
    patch(id, () => ({ stopping: false }))
    throw e
  } finally {
    await readRunning(id)
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
  const status = useConnection.getState(hermesOf(chat.profile)).state === 'open' ? 'thinking' : 'idle'
  patch(id, (c) => ({ items: c.items.filter((i) => i.kind !== 'error'), status }))
  if (unsent.has(lastUser.id)) {
    patch(id, (c) => ({ items: c.items.map((i) => (i.id === lastUser.id ? { ...i, pending: true } : i)) }))
    return deliver(id, lastUser.id)
  }
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
  await updateChat(id, getChat(id)?.profile ?? mainOn(homeOf(id)), { title })
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
export async function deleteChat(id: string, profile = getChat(id)?.profile ?? mainOn(homeOf(id))) {
  const hermes = hermesOf(profile)
  const close = (runtimeId: string) => rpc('session.close', { session_id: runtimeId }, undefined, hermes).catch(() => {})
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
    const live = await rpc<{ sessions: { id: string; session_key?: string }[] }>('session.active_list', {}, undefined, hermes)
    const match = live.sessions.find((s) => s.session_key === id)
    if (match) await close(match.id)
    await rpc('session.delete', { session_id: id, profile })
  }
  forget(id)
  forgetKeptChat(id, profile)
  // The pictures of its agent's browser go with it.
  void forgetFrames(id)
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
  release(id, held(id).map((m) => m.id))
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

type Question = Extract<ChatItem, { kind: 'clarify' }>

/** The question the agent is waiting on in a chat, if any. */
const waitingOn = (c?: Chat) => c?.items.findLast((i): i is Question => i.kind === 'clarify' && i.status === 'pending')

/** Chats whose reply is being stopped for a message written instead of an answer: no "Stopped" for it. */
const replying = new Set<string>()

/**
 * A message written instead of answering the agent's question answers it: the card says so (the
 * message itself is right under it), the agent stops waiting, and the message goes in once the
 * reply has stopped.
 */
async function replyInstead(id: string, question: Question) {
  requests.delete(question.requestId)
  patch(id, (c) => ({ items: c.items.map((i) => (i === question ? { ...i, status: 'answered', answers: {} } : i)) }))
  replying.add(id)
  try {
    await onChat(id, 'session.interrupt').catch(() => {})
    await until(id, (c) => !isBusy(c), 8000)
  } finally {
    replying.delete(id)
  }
  // Thinking about the message from here, as any message sent to an idle chat is.
  patch(id, () => ({ status: 'thinking' }))
}

/** Resolves once `ready` holds for the chat, or after `ms` either way. */
function until(id: string, ready: (c: Chat) => boolean, ms: number) {
  return new Promise<void>((resolve) => {
    const check = () => {
      const c = getChat(id)
      if (c && !ready(c)) return
      stopWatching()
      clearTimeout(timer)
      resolve()
    }
    const stopWatching = useChats.subscribe(check)
    const timer = setTimeout(() => (stopWatching(), resolve()), ms)
    check()
  })
}

/** `send` again while Hermes is still wrapping up a stopped reply (it's busy for a moment), for up to 5s. */
async function whileSettling<T>(send: () => Promise<T>): Promise<T> {
  for (let tries = 0; ; tries++) {
    try {
      return await send()
    } catch (e) {
      if ((e as { code?: number }).code !== 4009 || tries >= 10) throw e
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
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
            ...closeThinking(c.items),
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
            ...endSummarizing(c.items),
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
          page: label.page,
          status: 'running',
          startedAt: Date.now(),
          speaker: c.speaker,
          looking: pendingIn(name, payload.args),
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
      const name = String(payload.name ?? '')
      const media = failed ? [] : toolMedia(name, payload.result)
      const shot = failed ? null : shotOf(name, payload.args, payload.result)
      const found = failed ? undefined : foundIn(name, payload.args, payload.result)
      const subjects = foundSubjects(name, payload.result)
      if (subjects.length) mailSubjects.set(id, new Map([...(mailSubjects.get(id) ?? []), ...subjects]))
      const read = failed ? undefined : resultLabel(name, payload.result)
      const took = failed ? undefined : tookFor(name, payload.result)
      const made = failed ? undefined : madeRoutine(name, payload.result)
      // A routine set up here reports here, from the moment it's made.
      const profile = getChat(id)?.profile
      if (made && profile) void reportHere(profile, made, id).catch(() => {})
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
                took,
                status: failed ? 'error' : 'done',
                endedAt: Date.now(),
                media: media.length ? media : i.media,
                shot: shot ?? i.shot,
                found: found ?? i.found,
                routineId: made ?? i.routineId,
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
        } else if (status === 'interrupted' && !replying.has(id)) {
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
      // A question the agent gave up waiting on stays, saying so; one withdrawn otherwise (stopped, or
      // answered with a message) goes.
      const missed = payload.reason === 'timeout'
      requests.delete(reqId)
      return patch(id, (c) => ({
        status: c.status === 'waiting' ? 'working' : c.status,
        items: c.items.flatMap((i) => {
          if ((i.kind === 'approval' || i.kind === 'secret') && i.requestId === reqId && i.status === 'pending')
            return [{ ...i, status: 'expired' as const }]
          if (i.kind === 'clarify' && i.requestId === reqId && i.status === 'pending')
            return missed ? [{ ...i, status: 'missed' as const }] : []
          return [i]
        }),
      }))
    }

    // Hermes summarizing the chat's earlier messages to keep going: a step of its own while it lasts.
    case 'status.update': {
      const kind = String(payload.kind ?? '')
      if (kind === 'compacted')
        return patch(id, (c) => ({ summarized: true, items: endSummarizing(c.items, true) }))
      if (kind !== 'compacting') return
      return patch(id, (c) => {
        // (A summary you asked for, with Tidy up, has its own card.)
        if (!isBusy(c) || c.items.some(summarizing)) return
        const step: ChatItem = {
          kind: 'compaction',
          id: uid('k'),
          status: 'running',
          startedAt: Date.now(),
          speaker: c.speaker,
        }
        return { items: [...closeThinking(sealAssistant(c.items)), step] }
      })
    }

    case 'error':
      return patch(id, (c) => ({
        status: 'error',
        items: [
          ...endSummarizing(c.items),
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

/** The agent carries on: its thinking is over, and so is any summarizing Hermes didn't finish. */
function closeThinking(items: ChatItem[]) {
  const { item: last, at } = flowTail(items)
  return last?.kind === 'thinking' && last.streaming
    ? replaceAt(items, at, { ...last, streaming: false, endedAt: Date.now() })
    : endSummarizing(items)
}

const summarizing = (i: ChatItem): i is Extract<ChatItem, { kind: 'compaction' }> =>
  i.kind === 'compaction' && i.status === 'running'

/**
 * Summarizing the chat is over. Only `compacted` makes it `done`: Hermes also gives up and
 * carries on (a summary that wouldn't be any shorter, say), and then nothing was summarized.
 */
function endSummarizing(items: ChatItem[], done = false) {
  if (!items.some(summarizing)) return items
  if (!done) return items.filter((i) => !summarizing(i))
  const now = Date.now()
  return items.map((i) => (summarizing(i) ? { ...i, status: 'done' as const, endedAt: now } : i))
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

/** Get a chat back on its live connection. One that can't be for now gets on when it's next used. */
const reattach = (id: string) => void attach(id).catch(() => patch(id, () => ({ runtimeId: undefined })))

/**
 * Hermes let a chat's live connection go: no page was on it for a while (every
 * one of them dropped off at once, say), or it sat unused. Hermes tells every
 * page, whenever it gets to it. The chat on screen, or one mid-reply, gets back
 * on at once, so the next reply reaches this page from its start; the rest wait
 * until they're used.
 */
function reclaimed(runtimeId: string) {
  const id = runtimeToStored.get(runtimeId)
  runtimeToStored.delete(runtimeId)
  const chat = id ? getChat(id) : undefined
  // Told after this page got back on: the connection it has now is another one, and stays.
  if (!chat || chat.runtimeId !== runtimeId) return
  patch(chat.id, () => ({ runtimeId: undefined }))
  if (viewing.has(chat.id) || isBusy(chat)) reattach(chat.id)
}

let wired = false

export function wireChats() {
  if (wired) return
  wired = true
  // Out of reach: chats waiting to be read show as they were last seen.
  useReach.subscribe((s) => s.away && [...lastSeen.keys()].forEach(showKept))
  // Each conversation is kept as it comes to rest, to show when it can't be read (state/kept.ts).
  const resting = new Map<string, ReturnType<typeof setTimeout>>()
  useChats.subscribe((now, before) => {
    for (const chat of Object.values(now.chats)) {
      if (chat === before.chats[chat.id] || !chat.ready || chat.status !== 'idle' || !chat.items.length) continue
      clearTimeout(resting.get(chat.id))
      resting.set(
        chat.id,
        setTimeout(() => {
          resting.delete(chat.id)
          const settled = getChat(chat.id)
          if (settled?.ready && settled.status === 'idle') void keepChat(settled)
        }, 1500),
      )
    }
  })
  gateway.onEvent(onEvent)
  gateway.onRequest(onServerRequest)
  gateway.onEvent((ev) => {
    if (ev.type === 'session.reclaimed') reclaimed(String((ev as { payload?: P }).payload?.session_id ?? ''))
    if (ev.type === 'approval.cancelled') cancelApprovals(((ev as { payload?: P }).payload ?? {}) as P)
  })
  // After a reconnect, re-attach the chat on screen and any that are busy, so
  // their events flow again (Hermes's client replays anything we missed). The
  // rest are let go: Hermes reaps them, and they re-attach when next used.
  // Back in the foreground, online again, or Hermes back: history that couldn't be read is read now.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && readUnread())
  window.addEventListener('online', readUnread)
  gateway.onState((state, hermes) => {
    if (state !== 'open') return
    readUnread()
    for (const chat of Object.values(useChats.getState().chats)) {
      if (!chat.runtimeId) continue
      // Only that Hermes's chats: the others' sockets never dropped.
      if (hermesIds().length > 1 && hermesOf(chat.profile) !== hermes) continue
      if (viewing.has(chat.id) || isBusy(chat)) {
        reattach(chat.id)
      } else {
        runtimeToStored.delete(chat.runtimeId)
        patch(chat.id, () => ({ runtimeId: undefined }))
      }
    }
  })
}
