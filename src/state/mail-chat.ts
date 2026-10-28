// Email in a chat (state/mail.ts has the account): the agent's email tools,
// the approval Hermes asks for before a send, and the tools' results. Pure,
// so chat labels and approval cards can use it anywhere.

export const MAIL_TOOLS = ['email_search', 'email_read', 'email_draft', 'email_send'] as const
export type MailTool = (typeof MAIL_TOOLS)[number]
export const isMailTool = (name: string): name is MailTool => (MAIL_TOOLS as readonly string[]).includes(name)

/** Approvals for a send carry this pattern key (the rest names the message). */
export const SEND_APPROVAL_PREFIX = 'plugin_rule:murmur-mail-send:'

export const isSendApproval = (patternKeys: readonly string[] | undefined) =>
  !!patternKeys?.some((k) => k.startsWith(SEND_APPROVAL_PREFIX))

export type SendApproval = { from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; body: string }

const list = (line: string | undefined) => (line ? line.split(/,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => s.trim()).filter(Boolean) : [])

/**
 * The email an approval asks to send, from its description (the plugin
 * writes it as "Send an email from …", then To:, Cc:, Bcc: and Subject: lines,
 * a blank line, and the text). Null when it isn't one.
 */
export function readSendApproval(description: string | undefined): SendApproval | null {
  const text = description ?? ''
  const head = text.match(/^Send an email from (.+)\n/)
  if (!head) return null
  const [top, ...rest] = text.split('\n\n')
  const field = (name: string) => top.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1]
  const subject = field('Subject') ?? ''
  const body = rest.join('\n\n')
  return {
    from: head[1].trim(),
    to: list(field('To')),
    cc: list(field('Cc')),
    bcc: list(field('Bcc')),
    subject: subject === '(no subject)' ? '' : subject,
    body: body === '(no text)' ? '' : body,
  }
}

/**
 * A mail tool's result as data. Search and read results arrive inside the
 * boundary Hermes puts around outside content (the mail was written by its
 * sender); this takes the JSON out of it. Null when there's nothing to read.
 */
export function readMailResult<T = Record<string, unknown>>(result: unknown): T | null {
  if (result && typeof result === 'object') return result as T
  if (typeof result !== 'string') return null
  const inner = result.match(/^<untrusted_tool_result[^>]*>\n[^\n]*\n\n([\s\S]*)\n<\/untrusted_tool_result>\s*$/)
  try {
    return JSON.parse(inner ? inner[1] : result) as T
  } catch {
    return null
  }
}
