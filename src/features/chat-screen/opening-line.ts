// A question to open a new chat with, asked from somewhere else (the Apps
// sheet's "What needs me in my inbox today?"). The asker queues it and opens
// /chat/:agent/new; the chat screen takes it once, when that blank chat
// shows, and sends it as if typed. Held for a moment only, so one that never
// got taken can't surface in some later chat.

const HOLD_MS = 15_000

let queued: { agentId: string; text: string; at: number } | null = null

/** Opens the agent's next blank chat with `text`, sent as the person's first message. */
export function queueOpeningLine(agentId: string, text: string) {
  queued = { agentId, text, at: Date.now() }
}

/** The line queued for this agent's blank chat, once: a second call has nothing. */
export function takeOpeningLine(agentId: string): string | undefined {
  const line = queued
  if (!line || line.agentId !== agentId) return undefined
  queued = null
  return Date.now() - line.at <= HOLD_MS ? line.text : undefined
}
