// Reading a group's log the same way in the app (src/state/groups.ts) and on
// the server (server/watch.ts): whether a round is running, and the last
// thing said. Each group is a Hermes "hosted room" whose log is a list of events.

import { toNames, type Mentionable } from './mentions.ts'

type Actor = { kind: string; id: string; profile?: string; display_name?: string }

export type RoomEvent = {
  seq: number
  event_id: string
  kind: string
  actor: Actor
  payload: Record<string, unknown>
  created_at: number
}

/** "Atlas & Nova", "Atlas, Nova & Sol", "Atlas, Nova & 2 more": a group without a name of its own. */
export function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('')
  if (names.length > 3) return `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`
  return `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`
}

/** What ends a round: Hermes wrapped it up, it was stopped, or the room is gone. */
export const TERMINAL = new Set(['room.activity', 'room.stop_requested', 'room.disbanded'])

/** The member an event is from. */
export const memberOf = (ev: RoomEvent) => String(ev.payload.member_id ?? ev.actor.id ?? '')

/** Hide a reply while it's still on its way to being "(pass)". */
export function visibleText(text: string) {
  const t = text.trim()
  if (!t) return ''
  if ('(pass)'.startsWith(t.toLowerCase()) || /^\(pass\)\.?$/i.test(t)) return ''
  return t
}

/** Markdown as one line of words. */
export const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** A round is running if the latest message hasn't been wrapped up yet. */
export function liveFromLog(events: RoomEvent[], now = Date.now()) {
  const last = events.at(-1)
  // Hermes gives up on a turn after ~30 minutes; anything older is stale.
  if (!last || now - last.created_at * 1000 > 35 * 60_000) return false
  for (let i = events.length - 1; i >= 0; i--) {
    if (TERMINAL.has(events[i].kind)) return false
    if (events[i].kind === 'message.user') return true
  }
  return false
}

/** "Atlas: Sounds good" or "You: …", from the newest thing said; empty for a brand-new group. */
export function lastLine(events: RoomEvent[], roster: Mentionable[]) {
  const said = events.findLast(
    (e) => e.kind === 'message.user' || (e.kind === 'message.member' && visibleText(String(e.payload.text ?? ''))),
  )
  if (!said) return ''
  const who = said.kind === 'message.user' ? 'You' : (roster.find((m) => m.id === memberOf(said))?.name ?? 'Someone')
  return `${who}: ${plain(toNames(String(said.payload.text ?? ''), roster))}`.slice(0, 140)
}
