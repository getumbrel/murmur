// Connecting an app from a chat. Once the person agreed to apps through Nous,
// agents have Hermes's manage_connections (state/toolsets.ts), and one can start
// a connect itself ("connect my Slack", or after an app's tool said it isn't
// connected). Murmur's chats say they're from a desktop app, so Hermes then
// asks the app to show a card (connection.request) and holds the agent's turn
// until each app is connected or let go, or five minutes pass. This keeps
// those cards for the chat screen, and answers them.
//
// A card is one operation: its targets are apps through Nous (kind
// 'connector'), or, for an agent asked to add one of Hermes's own apps, those
// (kind 'mcp'), which Murmur's Apps sheet adds instead. With no targets, it's
// a directory ("which apps?"), with the ones the agent suggests.
//
// Hermes owns every state; Murmur only shows the sign-in, lets a target go,
// or says the person is done (connection.respond). Frames can cross, so an
// older one (by seq) never moves a card back.

import { create } from 'zustand'
import type { QueryClient } from '@tanstack/react-query'
import { gateway, rpc } from '@/hermes/gateway'
import type {
  ConnectionOperationStatus,
  ConnectionOperationTarget,
  ConnectionRequestPayload,
  ConnectionTargetKind,
  ConnectionTargetState,
  ConnectionUpdatePayload,
  ConnectorsConnectResult,
} from '@/hermes/vendor/gateway-contract.generated'
import { showSignIn } from './apps'
import { hostedAccountsKey } from './hosted-apps'

export type ChatConnectTarget = {
  /** Nous's slug for an app through Nous; the app's name in Hermes's catalog for one of its own. */
  name: string
  kind: ConnectionTargetKind
  state: ConnectionTargetState
  /** The sign-in, while there is one. */
  url: string | null
  /** Hermes's or the app's words about the last attempt: not for showing as they are. */
  detail: string
}

export type ChatConnect = {
  /** The chat's live id (the events' session_id). */
  sessionId: string
  opId: string
  /** The agent's tool call the card belongs under. */
  toolCallId: string | null
  seq: number
  /** Hermes stops waiting then (ms). */
  deadline: number
  settled: boolean
  /** A directory card: the apps the agent suggests (Nous's slugs). Null on a connect card. */
  suggested: string[] | null
  targets: ChatConnectTarget[]
}

const targetFrom = (t: ConnectionOperationTarget, held?: ChatConnectTarget): ChatConnectTarget => {
  // The link rides only some frames; keep it until a new attempt starts.
  const reissued = t.state === 'initiated' && held?.state !== 'initiated'
  return {
    name: t.name,
    kind: t.kind,
    state: t.state,
    url: t.connect_url ?? (reissued ? null : (held?.url ?? null)),
    detail: t.detail ?? '',
  }
}

/** A card from Hermes's connection.request (or a resumed chat's pending_connection); null when it carries none. */
export function chatConnectFrom(
  payload: ConnectionRequestPayload | null | undefined,
  sessionId: string,
): ChatConnect | null {
  if (!payload?.op_id || !(payload.deadline_at > 0)) return null
  const targets = payload.targets.filter((t) => t.name.trim()).map((t) => targetFrom(t))
  if (!targets.length && !payload.display) return null
  return {
    sessionId,
    opId: payload.op_id,
    toolCallId: payload.tool_call_id ?? null,
    seq: payload.seq,
    deadline: payload.deadline_at * 1000,
    settled: false,
    suggested: payload.display ? [...payload.display.suggested] : null,
    targets,
  }
}

/** The card with one of Hermes's frames applied; the same card for another operation's frame or an older one. */
export function applyChatFrame(
  card: ChatConnect,
  frame: Pick<ConnectionOperationStatus, 'op_id' | 'seq' | 'deadline_at' | 'settled' | 'targets'>,
): ChatConnect {
  if (frame.op_id !== card.opId || frame.seq <= card.seq || card.settled) return card
  const live = new Map(frame.targets.map((t) => [t.name, t]))
  return {
    ...card,
    seq: frame.seq,
    deadline: frame.deadline_at * 1000,
    settled: frame.settled,
    targets: card.targets.map((t) => {
      const next = live.get(t.name)
      return next ? targetFrom(next, t) : t
    }),
  }
}

type Store = Record<string, ChatConnect>
export const useChatConnects = create<Store>(() => ({}))

/** The connect card open in a chat (by its live id), if any. */
export const useChatConnect = (sessionId: string | undefined) =>
  useChatConnects((all) => (sessionId ? all[sessionId] : undefined))

const put = (card: ChatConnect | null, sessionId: string) =>
  useChatConnects.setState((all) => {
    const copy = { ...all }
    if (card) copy[sessionId] = card
    else delete copy[sessionId]
    return copy
  }, true)

/** A resumed chat's open card (session.resume's pending_connection). */
export function restoreChatConnect(sessionId: string, pending: ConnectionRequestPayload | null | undefined) {
  const card = chatConnectFrom(pending, sessionId)
  if (card) put(card, sessionId)
}

let wired = false

/** Keeps chats' connect cards as Hermes sends them. Mount once; idempotent. */
export function wireChatConnects(qc: QueryClient) {
  if (wired) return
  wired = true
  gateway.onEvent((event) => {
    const sessionId = event.session_id
    if (!sessionId) return
    if (event.type === 'connection.request') {
      const card = chatConnectFrom(event.payload as ConnectionRequestPayload, sessionId)
      if (card) put(card, sessionId)
      return
    }
    if (event.type !== 'connection.update') return
    const update = event.payload as ConnectionUpdatePayload | undefined
    if (update?.owner?.type !== 'session') return
    const card = useChatConnects.getState()[sessionId]
    if (!card) return
    const next = applyChatFrame(card, update)
    if (next === card) return
    put(next, sessionId)
    // An app connected from a chat is connected for every agent: the Apps sheet lists it.
    if (
      next.targets.some(
        (t, i) => t.kind === 'connector' && t.state === 'connected' && card.targets[i]?.state !== 'connected',
      )
    )
      void qc.invalidateQueries({ queryKey: hostedAccountsKey })
  })
}

const owner = (sessionId: string) => ({ type: 'session' as const, session_id: sessionId })

/**
 * Shows a card's sign-in for one app, in `tab` (opened in the tap). A link
 * that failed or ran out is made again first. False when there's nothing to
 * open, or the browser blocked it.
 */
export async function openChatSignIn(sessionId: string, name: string, tab?: Window | null): Promise<boolean> {
  const url = await signInFor(sessionId, name)
  if (url) return showSignIn(url, tab)
  tab?.close()
  return false
}

async function signInFor(sessionId: string, name: string): Promise<string | null> {
  const card = useChatConnects.getState()[sessionId]
  const target = card?.targets.find((t) => t.name === name)
  if (!card || card.settled || !target) return null
  if (target.state !== 'failed' && target.state !== 'expired') return target.url
  // Hermes makes a new link on the card's own operation.
  const again = await rpc<ConnectorsConnectResult>('connectors.connect', {
    owner: owner(sessionId),
    connectors: [name],
  }).catch(() => null)
  const now = useChatConnects.getState()[sessionId]
  if (!again || !now) return null
  const next = applyChatFrame(now, again)
  put(next, sessionId)
  return next.targets.find((t) => t.name === name)?.url ?? null
}

/** Lets apps on a card go ("Not now"): all of its unfinished ones, or those named. */
export async function skipChatConnect(sessionId: string, names?: readonly string[]) {
  const card = useChatConnects.getState()[sessionId]
  if (!card || card.settled) return
  const skipped = card.targets.filter((t) =>
    names ? names.includes(t.name) : t.state !== 'connected' && t.state !== 'skipped',
  )
  if (!skipped.length) return finishChatConnect(sessionId)
  await rpc('connection.respond', {
    owner: owner(sessionId),
    op_id: card.opId,
    result: { targets: skipped.map((t) => ({ name: t.name, status: 'skipped' })) },
  }).catch(() => {})
}

/** The person is done with a card (a directory card's Done): the agent carries on with what's connected. */
export async function finishChatConnect(sessionId: string) {
  const card = useChatConnects.getState()[sessionId]
  if (!card || card.settled) return
  await rpc('connection.respond', {
    owner: owner(sessionId),
    op_id: card.opId,
    result: { settled_by: 'continue' },
  }).catch(() => {})
}

/** Forgets a chat's card, once it's settled and seen (or the chat is gone). */
export const clearChatConnect = (sessionId: string) => put(null, sessionId)
