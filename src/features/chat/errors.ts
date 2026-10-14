// Hermes errors are written for terminals (and often pass a model service's
// raw reply straight through). The common ones get a plain sentence and, where
// there's something to do about it, a way to go and do it.

/** What an error offers besides "Try again". */
export type ErrorAction = 'models' | 'new-chat' | 'continue-here'

export const ERROR_ACTION_LABEL: Record<ErrorAction, string> = {
  models: 'Open Models',
  'new-chat': 'New chat',
  'continue-here': 'Continue here',
}

type Rule = { test: RegExp; text: string; action?: ErrorAction }

// Order matters: a service that's out of credit often says so with a 429 or a
// "quota", so billing is checked before the rate limit.
const RULES: Rule[] = [
  // Hermes lets one program drive a chat at a time; its message ends with
  // "Details: session … opened by <surface>", which says where.
  {
    test: /open in another Hermes window[\s\S]*opened by (telegram|discord|slack|whatsapp|signal|matrix|sms|email)/i,
    text: 'This chat is running in a messaging app right now. Continue it here as a copy, or try again later.',
    action: 'continue-here',
  },
  {
    test: /open in another Hermes window[\s\S]*opened by (tui|cli|terminal)/i,
    text: 'This chat is open in the Hermes terminal. Continue it here as a copy, or close it there and try again.',
    action: 'continue-here',
  },
  {
    test: /open in another Hermes window/i,
    text: 'This chat is open in another Hermes app. Continue it here as a copy, or close it there and try again.',
    action: 'continue-here',
  },
  {
    test: /no llm provider|not connected to any ai provider|no usable credentials/i,
    text: 'This agent isn’t connected to a model yet. Pick one in Models, then try again.',
    action: 'models',
  },
  {
    test: /\b402\b|insufficient[_ ]quota|insufficient[_ ](credit|funds|balance)|credit balance|out of credits?|exceeded your current quota|billing|payment required/i,
    text: 'Your AI account is out of credit. Add some with the service, or pick another model.',
    action: 'models',
  },
  {
    test: /\b401\b|unauthori[sz]ed|authentication[_ ]?(error|failed)|invalid[_ ]api[_ ]key|incorrect api key|invalid x-api-key|api[_ ]?key.{0,40}\b(invalid|incorrect|revoked|expired|not valid|disabled)\b|\b(invalid|revoked|expired)\b.{0,20}\b(api[_ ]?key|token|credentials?)\b/i,
    text: 'Your AI service turned down its key. It may be mistyped, expired or revoked.',
    action: 'models',
  },
  {
    test: /rate.?limit|\b429\b|usage limit|quota|overloaded/i,
    text: 'The model is busy or you’ve hit your plan’s limit. Try again in a moment.',
  },
  {
    test: /context.?(length|window)|maximum context|too many tokens|prompt is too long|input is too long|reduce the length of the messages/i,
    text: 'This chat is now too long for the model to read in one go. Start a new chat to carry on.',
    action: 'new-chat',
  },
  {
    test: /could not start the assistant|failed to start (the )?agent/i,
    text: 'Hermes couldn’t get this agent started. Try again in a moment.',
  },
  {
    test: /not connected|lost connection|websocket/i,
    text: 'Lost the connection to Hermes. Reconnecting…',
  },
]

/** Say it like a person would. Unknown errors keep their own first line, tidied up. */
export function explainError(raw: string): { text: string; action?: ErrorAction } {
  const rule = RULES.find((r) => r.test.test(raw))
  if (rule) return { text: rule.text, action: rule.action }
  const firstLine = raw
    .split('\n')[0]
    .replace(/^Details:\s*/i, '')
    .trim()
  return { text: firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine || 'Something went wrong.' }
}

/** The action for a message `explainError` wrote (chat items keep only the words). */
export function errorActionOf(message: string): ErrorAction | undefined {
  return RULES.find((r) => r.text === message)?.action
}
