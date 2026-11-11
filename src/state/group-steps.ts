// The steps behind each agent's words in a group chat. An agent takes its
// turn in its own copy of the room (the hidden chat "Group: <room id>" in its
// profile), which keeps each step from the moment it starts; the room's log
// keeps only what was said. Since Hermes 0.23 a turn runs where this
// connection can't hear it, so the copy is where its steps are read, while
// the agent works and after (state/groups.ts).
//
// Each turn in a copy opens with the request Hermes handed the agent, named
// for the room's task it runs, and the agent's message in the log names the
// same task: that's how words find their steps, never by what they say. An
// older Hermes doesn't name its requests, and its copies are left alone.

import { rpc } from '@/hermes/gateway'
import { readRows, stepsIn, type Row } from '@/state/chats'
import type { ChatItem } from '@/features/chat/types'

export type Step = Extract<ChatItem, { kind: 'tool' }>

/** A turn in an agent's copy of a room: the room's task it ran, and its steps. */
export type CopyTurn = {
  task: string
  steps: Step[]
  /** Read from its opening request, so these are all its steps (not just its last few). */
  whole: boolean
}

/** The room task a request from Hermes runs. Hermes names it `hosted:[{room_id, task_id, …}, attempt]`. */
export function taskOf(row: Row): string | undefined {
  const name = row.role === 'user' ? row.display_metadata?.submission_id : undefined
  if (typeof name !== 'string' || !name.startsWith('hosted:')) return
  try {
    const [task] = JSON.parse(name.slice('hosted:'.length)) as [{ task_id?: unknown }?]
    return typeof task?.task_id === 'string' && task.task_id ? task.task_id : undefined
  } catch {
    return
  }
}

/**
 * A copy's rows, oldest first, as its turns. Rows before the first request
 * among them are the end of `before`, the turn the agent was last seen on,
 * when that's known; otherwise there's no telling whose they are.
 */
export function turnsIn(rows: Row[], before?: string): CopyTurn[] {
  const turns: { task: string; rows: Row[]; whole: boolean }[] = []
  for (const row of rows) {
    const task = taskOf(row)
    if (task) turns.push({ task, rows: [row], whole: true })
    else if (turns.length) turns.at(-1)!.rows.push(row)
    else if (before) turns.push({ task: before, rows: [row], whole: false })
  }
  return turns.map(({ task, rows, whole }) => ({ task, whole, steps: stepsIn(rows) }))
}

/** The same turn's steps read again: what's new joins what was known, each step as it is now. */
export function joinSteps(known: Step[] = [], read: Step[]): Step[] {
  const now = new Map(read.map((s) => [s.id, s]))
  const kept = known.map((s) => now.get(s.id) ?? s)
  const had = new Set(known.map((s) => s.id))
  return [...kept, ...read.filter((s) => !had.has(s.id))]
}

// Where each agent's copy of each room is kept, once it has one.
const copies = new Map<string, string>()

async function copyOf(room: string, profile: string) {
  const key = `${room}/${profile}`
  const known = copies.get(key)
  if (known) return known
  type Listed = { id: string; title?: string }
  const title = `Group: ${room}`
  const { sessions } = await rpc<{ sessions: Listed[] }>('session.list', {
    profile,
    title,
    include_hidden: true,
    limit: 5,
  })
  const id = sessions.find((s) => s.title === title)?.id
  if (id) copies.set(key, id)
  return id
}

/** Forget where a room's copies are: the room is gone. */
export function forgetCopies(room: string) {
  for (const key of copies.keys()) if (key.startsWith(`${room}/`)) copies.delete(key)
}

export type Read = {
  turns: CopyTurn[]
  /** Its requests aren't named (an older Hermes): there's no knowing whose steps are whose. */
  unnamed: boolean
}

/**
 * An agent's turns in its copy of a room, oldest first, read back from its
 * newest rows a page at a time: until every turn in `wanted` is read from its
 * start, or, wanting none, the turn it's on is (or `before` says which that
 * is), or `most` rows. Undefined while it has no copy (it hasn't taken a turn
 * there yet, or it's on another Hermes).
 */
export async function readTurns(
  room: string,
  profile: string,
  { wanted = [], before, page = 100, most = 500 }: { wanted?: string[]; before?: string; page?: number; most?: number },
): Promise<Read | undefined> {
  const id = await copyOf(room, profile)
  if (!id) return
  let rows: Row[] = []
  for (let offset = 0; offset < most; offset += page) {
    const older = await readRows(id, profile, offset, { limit: Math.min(page, most - offset), pictures: false }).catch(
      (error) => {
        // Gone (deleted, say): looked for afresh next time.
        copies.delete(`${room}/${profile}`)
        throw error
      },
    )
    // Rows saved since the last page pushed this one back a little: what's read is left out.
    const have = new Set(rows.map((r) => r.id))
    rows = [...older.filter((r) => r.id == null || !have.has(r.id)), ...rows]
    const opened = new Set(rows.map(taskOf).filter(Boolean))
    const found = wanted.length ? wanted.every((t) => opened.has(t)) : opened.size > 0 || Boolean(before)
    // Requests, none of them named: an older Hermes, where reading on finds no more.
    const unnamed = !opened.size && rows.some((r) => r.role === 'user')
    if (found || unnamed || older.length < page) break
  }
  const turns = turnsIn(rows, before)
  return { turns, unnamed: !turns.length && rows.some((r) => r.role === 'user') }
}
