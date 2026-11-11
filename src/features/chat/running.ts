// What an agent leaves running after its reply: a command it started and
// didn't wait for (a download, a server, a long script). Hermes keeps each
// chat's own, and wakes the agent when one finishes ("Command finished"),
// so until then the chat says it's still going, with a way to stop it.

/** A command Hermes is keeping for a chat, as much of it as this needs (`process.list`). */
export type Kept = { session_id: string; status?: string; started_epoch?: number | null; uptime_seconds?: number | null }

/** The commands still going: which they are, and when the first of them started. */
export type Running = { ids: string[]; since: number }

/** What's still going among the commands Hermes keeps for a chat; nothing, when none is. */
export function stillRunning(kept: Kept[] | undefined, now: number): Running | undefined {
  const going = (kept ?? []).filter((p) => p.session_id && p.status === 'running')
  if (!going.length) return undefined
  const started = going.map((p) =>
    typeof p.started_epoch === 'number' && p.started_epoch > 0
      ? p.started_epoch * 1000
      : now - Math.max(0, p.uptime_seconds ?? 0) * 1000,
  )
  return { ids: going.map((p) => p.session_id), since: Math.min(now, ...started) }
}

/** The same commands as before: nothing to draw again. */
export const sameRunning = (a?: Running, b?: Running) =>
  a === b || (!!a && !!b && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]))

/** In the words the agent's own steps use ("Running a command", "Command finished"). */
export const runningLine = (count: number) => (count === 1 ? 'Still running a command' : `Still running ${count} commands`)
