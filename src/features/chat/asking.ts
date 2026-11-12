// Whether an agent asks for your OK before anything risky, as Hermes tells it for one chat.

/**
 * Going ahead without asking: in this chat, because you said so, or
 * everywhere, because asking is off in Hermes itself. False while it asks.
 */
export type Unasked = 'chat' | 'everywhere' | false

/**
 * What Hermes says about asking first, for a chat. Its one flag is on when
 * the chat's own switch is, and when asking is off for the whole of Hermes
 * (which the chat's switch can't undo). A Hermes that doesn't say leaves it unset.
 */
export const unaskedOf = (info: { yolo?: unknown; approval_mode?: unknown } | null | undefined): Unasked | undefined =>
  typeof info?.yolo !== 'boolean' ? undefined : !info.yolo ? false : info.approval_mode === 'off' ? 'everywhere' : 'chat'
