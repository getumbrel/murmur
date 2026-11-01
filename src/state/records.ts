import type { QueryClient } from '@tanstack/react-query'
import { agentsKey, writeMeta, type Agent } from '@/state/agents'

// Records Murmur keeps on an agent, in its ui_meta: where it sits, the
// sections (state/sections.ts), the pinned models (features/model/pins.ts).
//
// Every change shows at once and is then written to Hermes, as a change to
// what's there (writeMeta) made again on top of whatever it finds. So every
// change can be made twice and land the same: it says where things go, never
// how far.

/** Each record, and the field of the agent that holds it. */
const FIELDS = {
  'hermes-bots': 'botMeta',
  'murmur-sections': 'sectionsMeta',
  'murmur-pinned-models': 'pinsMeta',
} as const satisfies Record<string, keyof Agent>

export type RecordKey = keyof typeof FIELDS

export const agentsIn = (qc: QueryClient) => qc.getQueryData<Agent[]>(agentsKey) ?? []

export const patchAgent = (qc: QueryClient, id: string, fn: (agent: Agent) => Agent) =>
  qc.setQueryData<Agent[]>(agentsKey, (list) => list?.map((a) => (a.id === id ? fn(a) : a)))

/** One write at a time per record, so quick changes queue rather than race (and conflict) each other. */
const lanes = new Map<string, Promise<unknown>>()
function inLane<T>(lane: string, fn: () => Promise<T>): Promise<T> {
  const next = (lanes.get(lane) ?? Promise.resolve()).catch(() => {}).then(fn)
  lanes.set(lane, next)
  return next
}

/** Writes on their way: the roster reads Hermes again once they've all landed, not between them. */
let writing = 0

/** Write one of an agent's records as `change` makes it from what the agent holds (see above). */
export function writeRecord(qc: QueryClient, id: string, key: RecordKey, change: (agent: Agent) => unknown) {
  const field = FIELDS[key]
  const now = () => agentsIn(qc).find((a) => a.id === id)
  const hold = (agent: Agent) => {
    const value = change(agent)
    patchAgent(qc, id, (a) => ({ ...a, [field]: value }))
    return value
  }
  // Read again after a conflict: only this record is news, the agent's others may be mid-write.
  const fresh = (read: Agent) => {
    patchAgent(qc, id, (a) => ({
      ...a,
      [field]: read[field],
      metaRevisions: { ...a.metaRevisions, [key]: read.metaRevisions?.[key] ?? 0 },
    }))
    return now()
  }
  const agent = now()
  if (!agent) return Promise.resolve()
  hold(agent)
  writing++
  return inLane(`${id}/${key}`, async () => {
    const revision = (await writeMeta(id, now(), (a) => ({ [key]: hold(a) }), { fresh }))?.[key]
    if (revision !== undefined) {
      patchAgent(qc, id, (a) => ({ ...a, metaRevisions: { ...a.metaRevisions, [key]: revision } }))
    }
  }).finally(() => writing--)
}

/** Once every write has landed (or failed), read the agents again: what Hermes kept is what shows. */
export function settle(qc: QueryClient) {
  if (!writing) void qc.invalidateQueries({ queryKey: agentsKey })
}
