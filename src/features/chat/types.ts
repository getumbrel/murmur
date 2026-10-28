// View model for a conversation. The Hermes event stream is folded into this
// shape by the chat store; components render it and never see wire types.

import type { SendApproval } from '@/state/mail-chat'

export type Speaker = { id: string; name: string; hue: number }

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'

export type SecretAsk = 'login' | 'code' | 'key'

export type ClarifyQuestion = {
  qid: string
  question: string
  choices?: string[]
  multi?: boolean
}

/** A file the person sent: an image (shown as a thumbnail) or any other file (a chip). */
export type UserAttachment =
  | {
      kind: 'image'
      name: string
      /** On the Hermes host. */ path?: string
      /** Already in the browser. */ url?: string
    }
  | { kind: 'file'; name: string; path?: string; size?: number }

export type ChatItem =
  | {
      kind: 'user'
      id: string
      text: string
      /** Image URLs (older shape; prefer `attachments`). */
      images?: string[]
      attachments?: UserAttachment[]
      at: number
      pending?: boolean
      /** Hermes's row id for this message once it's saved: lets you edit and resend it. */
      rowId?: number
      /** The message this one rewrote (edit and resend): it takes that one's place. */
      was?: string
      reactions?: Reaction[]
    }
  | {
      kind: 'assistant'
      id: string
      text: string
      streaming: boolean
      at: number
      speaker?: Speaker
      /** Hermes's row id once it's saved: what a reaction is pinned to. */
      rowId?: number
      reactions?: Reaction[]
    }
  | {
      kind: 'thinking'
      id: string
      text: string
      streaming: boolean
      startedAt: number
      endedAt?: number
      speaker?: Speaker
    }
  | {
      kind: 'tool'
      id: string
      /** Raw tool name, e.g. "web_search". Never shown to people. */
      name: string
      /** Human, present-tense label: "Searching the web". */
      label: string
      /** Short supporting detail: a query, a file name, a domain. */
      detail?: string
      status: 'running' | 'done' | 'error'
      startedAt: number
      endedAt?: number
      speaker?: Speaker
      /** Images the tool produced (paths on the Hermes host, or URLs). */
      media?: string[]
      /** Hermes's id for the call, so a live result finds a step loaded from history. */
      callId?: string
      /** The mark of the app the step uses (an app through Nous), drawn in place of its kind's icon. */
      app?: string
    }
  | {
      kind: 'approval'
      id: string
      requestId: string
      /** Hermes's own id for the approval (params.request_id), which approval.cancelled names. */
      approvalId?: string
      /** What the agent wants to do, in plain words. */
      title: string
      /** The exact command or action, shown on request. */
      command?: string
      /** `command` is a sentence from a connected tool, not code. */
      prose?: boolean
      /** The connected tool it's about (Hermes asking before using it). */
      tool?: string
      /** An email to send, shown whole on the card. */
      email?: SendApproval
      choices: ApprovalChoice[]
      status: 'pending' | 'approved' | 'denied' | 'expired'
      /** What the person picked, once resolved. */
      choice?: ApprovalChoice
      speaker?: Speaker
    }
  | {
      kind: 'clarify'
      id: string
      requestId: string
      questions: ClarifyQuestion[]
      status: 'pending' | 'answered'
      answers?: Record<string, string>
      speaker?: Speaker
    }
  | {
      kind: 'secret'
      id: string
      requestId: string
      /** A login to keep in Hermes's vault, a one-time code, or a key a skill needs. */
      ask: SecretAsk
      /** The site, by host (a login or a code). */
      site?: string
      /** Hermes's own words for it: the code's hint, or what the key is. */
      prompt?: string
      /** The skill a key is for, and where to get one. */
      skill?: string
      help?: string
      /** The value itself is never kept: it goes straight back to Hermes. */
      status: 'pending' | 'sent' | 'skipped' | 'expired'
      speaker?: Speaker
    }
  | { kind: 'error'; id: string; message: string; retryable?: boolean }
  | { kind: 'notice'; id: string; text: string }
  /**
   * Hermes woke the agent itself: helpers it sent off are back, a command it
   * left running has finished, or a reply a restart cut off picks up again.
   * It starts a turn the way your message would, but it isn't yours.
   */
  | {
      kind: 'wake'
      id: string
      reason: WakeReason
      at: number
      /** Hermes's row id for it, once it's saved. */
      rowId?: number
      /** The helpers' errand (reason "helpers"), as delegate_task named it. */
      delegationId?: string
      /** How many helpers came back, and how many of those didn't finish. */
      helpers?: number
      failed?: number
      /** How long they were away (ms), as Hermes timed them. */
      took?: number
      /** Who went, by Hermes's ids: their cards are in the turn that sent them. */
      subagentIds?: string[]
    }
  /** A slash command you ran, and what it printed. */
  | { kind: 'command'; id: string; command: string; output?: string; status: 'running' | 'done' | 'error' }
  /** A side question (/btw): answered off to the side, without interrupting the conversation. */
  | { kind: 'aside'; id: string; taskId?: string; question: string; answer?: string; status: 'pending' | 'done' | 'error' }
  /** The agent's checklist for this turn (its todo list), ticking itself off as it works. */
  | { kind: 'plan'; id: string; todos: Todo[]; revision: number }
  /** A helper the agent sent off with part of the work (delegate_task). */
  | {
      kind: 'helper'
      id: string
      subagentId: string
      goal: string
      /** `back`: home, but how it went isn't known (read back later, one of several that didn't all finish). */
      status: 'running' | 'done' | 'error' | 'stopped' | 'back'
      /** What it's doing right now, in a few words. */
      line?: string
      tools: number
      startedAt: number
      endedAt?: number
      /** What it came back with. */
      summary?: string
      /** The errand it's part of (one delegate_task call), which its return names. */
      delegationId?: string
      /** Still working after the turn that sent it ended: Hermes wakes the agent when it's back. */
      background?: boolean
    }

export type WakeReason = 'helpers' | 'command' | 'resume' | 'update'

/** A tapback: one per author per message, the way Messages does it. */
export type Reaction = { emoji: string; author: 'user' | 'agent' }

export type Todo = {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  /** Nests it under another item. */
  parent?: string
}

export type ChatStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'error'
