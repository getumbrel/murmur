// What an approval card says. Hermes asks before risky commands, and it also
// relays requests from connected tools (umbrelOS and other MCP servers): either
// Hermes asking before it uses a tool on a server it doesn't fully trust, or
// the tool itself asking you to confirm. Both arrive with pattern_key
// "mcp_elicitation" and worded for developers ("MCP tool 'delete_files' on
// UNTRUSTED server 'umbrel' wants to run…"), so they're retold here. Checks
// that aren't about a command (a plugin's rule, a write to a file that steers
// SSH or agents) put a stand-in like "<terminal> (plugin approval rule)" where
// the command goes; that's never shown, only what it stands for.

import { isSendApproval, readSendApproval, type SendApproval } from '@/state/mail-chat'
import { peopleOf, toolLabel } from './tool-labels'
import type { ApprovalChoice } from './types'

export type ApprovalText = {
  title: string
  /** The exact command, or what the tool will act on. */
  command?: string
  /** `command` is a sentence to read, not code. */
  prose?: boolean
  choices: ApprovalChoice[]
  /** The connected tool it's about, so its details can fill in once the call shows up. */
  tool?: string
  /** An email the agent wants to send: the card shows it whole, and asks Send or Don't send. */
  email?: SendApproval
}

/** A tool call: Hermes's name for it, its arguments and its own one-line preview. */
export type ToolCall = { name: string; args?: unknown; context?: string }

type Request = {
  /** The agent's name, when there is one. */
  who?: string
  command?: string
  description?: string
  choices?: ApprovalChoice[]
  patternKeys?: string[]
  /** The tool call waiting on this, when it has already started. */
  call?: ToolCall
}

const UNTRUSTED = /^MCP tool '([^']+)' on UNTRUSTED server '([^']+)'/
// What Hermes says when a plugin asks without giving a reason.
const NO_REASON = /^Plugin requires approval for (\S+)$/
// Writes Hermes asks about, by their pattern key.
const WRITES: Record<string, string> = {
  ssh_config_write: 'edit SSH settings',
  protected_instruction_file: 'edit agent instructions',
}
// A stand-in, not a command: "<terminal> (plugin approval rule)", "<write to ~/.ssh/config>".
const STAND_IN = /^<[^<>]+>(?: \([^()]*\))?$/
// Each of these is for one call: Hermes doesn't remember a yes for later.
const ONCE: ApprovalChoice[] = ['once', 'deny']

/** The connected tool an approval is about, if it's Hermes asking before using one. */
export const toolAsked = (command?: string) => UNTRUSTED.exec(command ?? '')?.[1]

export function approvalText({
  who = 'Your agent',
  command,
  description,
  choices,
  patternKeys = [],
  call,
}: Request): ApprovalText {
  // An email (the murmur-mail plugin): every send is its own yes, never "always".
  const email = isSendApproval(patternKeys) ? readSendApproval(description) : null
  if (email) {
    const to = peopleOf(email.to)
    return {
      title: to ? `Send this email to ${to}?` : 'Send this email?',
      command: email.subject || 'No subject',
      prose: true,
      choices: ONCE,
      tool: 'email_send',
      email,
    }
  }
  const untrusted = UNTRUSTED.exec(command ?? '')
  if (untrusted) {
    const [, tool, server] = untrusted
    return {
      title: `${who} wants to ${words(tool)} ${placeOf(server)}`,
      command: call && detailOf(call),
      choices: ONCE,
      tool,
    }
  }
  if (patternKeys.includes('mcp_elicitation')) {
    return { title: `${who} needs your OK`, command: command || description, prose: true, choices: ONCE }
  }
  const asked = choices?.length ? choices : (['once', 'always', 'deny'] as ApprovalChoice[])
  const write = patternKeys.map((key) => WRITES[key]).find(Boolean)
  if (write) {
    return { title: `${who} wants to ${write}`, command: /^<write to (.+)>$/.exec(command ?? '')?.[1], choices: asked }
  }
  // A plugin's rule, or any other check that isn't a command: its own words.
  if (patternKeys.some((key) => key.startsWith('plugin_rule:')) || STAND_IN.test(command ?? '')) {
    const tool = NO_REASON.exec(description ?? '')?.[1]
    return {
      title: `${who} needs your OK`,
      command: tool ? toolLabel(tool).label : description || undefined,
      prose: true,
      choices: asked,
    }
  }
  return {
    title: command
      ? `${who} wants to run a command`
      : description
        ? `${who} wants to ${description}`
        : `${who} needs your OK`,
    command,
    choices: asked,
  }
}

/** Whether a tool call is the one an approval names (calls carry a server prefix: "mcp__umbrel__delete_files"). */
export const isCallTo = (name: string, tool: string) => name === tool || name.endsWith(`__${tool}`)

/** What a call will act on: its arguments, or Hermes's own preview of it. */
export const detailOf = (call: ToolCall) => summarize(call.args) ?? (call.context?.trim() || undefined)

/** "umbrel" → "on your Umbrel"; any other server by its name. */
function placeOf(server: string) {
  if (/^umbrel(os)?$/i.test(server)) return 'on your Umbrel'
  return `in ${words(server).replace(/^./, (c) => c.toUpperCase())}`
}

/** "delete_files" / "deleteFiles" → "delete files". */
function words(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\-.:\s]+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** What a tool call will act on, briefly: its paths, names or values. */
export function summarize(args: unknown): string | undefined {
  let a = args
  if (typeof args === 'string') {
    try {
      a = JSON.parse(args)
    } catch {
      return args.trim() || undefined
    }
  }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return undefined
  const parts: string[] = []
  for (const [key, value] of Object.entries(a as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) parts.push(value.trim())
    else if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === 'string')
      if (items.length)
        parts.push(items.length > 3 ? `${items.slice(0, 3).join(', ')} and ${items.length - 3} more` : items.join(', '))
    } else if (typeof value === 'number' || typeof value === 'boolean') parts.push(`${words(key)}: ${value}`)
    if (parts.length === 2) break
  }
  return parts.join(' · ') || undefined
}
