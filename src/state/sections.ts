import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { scoped } from '@/hermes/instance'
import { agentsKey, useAgents, writeMeta, type Agent } from '@/state/agents'

// Sections: shelves you file agents (and groups) on, so a long roster reads by
// what each one is for. One level, never nested.
//
// Where an agent sits lives on the agent, where Hermes Desktop keeps it
// (ui_meta['hermes-bots'].sectionId and .sectionName), so a section made in
// either app shows in both, on every device, against any Hermes. The list
// itself (its order, and which groups sit on each) is Murmur's own, a record of
// its own on the main agent (ui_meta['murmur-sections']), so editing the main
// agent never touches it. A section only an agent knows about (made in Hermes
// Desktop) joins the end of the list under the name it carries, and stays only
// while something is on it: once its agents have all left, it was deleted there.

export type Section = {
  id: string
  name: string
  groups?: string[]
  /** Made in another app, and known here from its agents: it goes once nothing's on it. Editing it here makes it Murmur's. */
  adopted?: true
}

const BOTS = 'hermes-bots'
const LIST = 'murmur-sections'

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export const sectionOf = (agent: Agent) => text(agent.botMeta?.sectionId) || undefined

function stored(main: Agent | undefined): Section[] {
  const raw = main?.sectionsMeta
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw.flatMap((s) => {
    const id = text(s?.id)
    const name = text(s?.name)
    if (!id || !name || seen.has(id)) return []
    seen.add(id)
    const groups = Array.isArray(s.groups) ? s.groups.filter((g: unknown): g is string => typeof g === 'string') : []
    return [{ id, name, groups, ...(s.adopted === true && { adopted: true as const }) }]
  })
}

/**
 * Every section, in order: Murmur's list, then any only an agent knows about.
 * A section takes the name its members carry when they all agree on it (it was
 * renamed in Hermes Desktop); while they don't, a rename is still landing and
 * the list's name stays.
 */
export function sectionsOf(agents: Agent[] | undefined): Section[] {
  if (!agents) return []
  const names = new Map<string, Set<string>>()
  const occupied = new Set<string>()
  for (const agent of agents) {
    const id = sectionOf(agent)
    const name = text(agent.botMeta?.sectionName)
    if (id) occupied.add(id)
    if (id && name) names.set(id, (names.get(id) ?? new Set()).add(name))
  }
  const agreed = (id: string) => {
    const set = names.get(id)
    return set?.size === 1 ? [...set][0] : undefined
  }
  const list = stored(agents.find((a) => a.isDefault))
    .filter((s) => !s.adopted || occupied.has(s.id) || s.groups?.length)
    .map((s) => ({ ...s, name: agreed(s.id) ?? s.name }))
  const listed = new Set(list.map((s) => s.id))
  for (const [id, set] of names) if (!listed.has(id)) list.push({ id, name: [...set][0], groups: [], adopted: true })
  return list
}

export function useSections() {
  const { data: agents } = useAgents()
  return sectionsOf(agents)
}

const newId = () => `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

// ── Writing ─────────────────────────────────────────────────────────────────
// Every change shows at once (the roster moves under your finger) and is then
// written to Hermes: one write per agent that moved, one for the list, each a
// change to what's there (writeMeta), made again on top of whatever it finds.
// So every change can be made twice and land the same: it says where things
// go, never how far.

type Key = typeof BOTS | typeof LIST

const agentsIn = (qc: QueryClient) => qc.getQueryData<Agent[]>(agentsKey) ?? []

const patchAgent = (qc: QueryClient, id: string, fn: (agent: Agent) => Agent) =>
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
function write(qc: QueryClient, id: string, key: Key, change: (agent: Agent) => unknown) {
  const now = () => agentsIn(qc).find((a) => a.id === id)
  const hold = (agent: Agent) => {
    const value = change(agent)
    patchAgent(qc, id, (a) =>
      key === BOTS ? { ...a, botMeta: value as Record<string, unknown> } : { ...a, sectionsMeta: value },
    )
    return value
  }
  // Read again after a conflict: only this record is news, the agent's others may be mid-write.
  const fresh = (read: Agent) => {
    patchAgent(qc, id, (a) => ({
      ...a,
      ...(key === BOTS ? { botMeta: read.botMeta } : { sectionsMeta: read.sectionsMeta }),
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

/** The agent on `section`, or (null) on none. Members carry the name too: Hermes Desktop rebuilds sections from it. */
const place = (qc: QueryClient, id: string, section: Section | null) =>
  write(qc, id, BOTS, (a) => ({ ...a.botMeta, sectionId: section?.id ?? null, sectionName: section?.name ?? null }))

/** The list as `change` makes it from the list as it is now. */
const writeList = (qc: QueryClient, change: (list: Section[]) => Section[]) => {
  const main = agentsIn(qc).find((a) => a.isDefault)
  return main ? write(qc, main.id, LIST, () => change(sectionsOf(agentsIn(qc)))) : Promise.resolve()
}

/** These groups on `to` (or on none), and on no other; those already there keep their place. */
const withGroups = (groups: string[], to: Pick<Section, 'id'> | null) => (list: Section[]) =>
  list.map((s) => {
    const own = s.groups ?? []
    return s.id === to?.id
      ? { ...s, groups: [...own, ...groups.filter((g) => !own.includes(g))] }
      : { ...s, groups: own.filter((g) => !groups.includes(g)) }
  })

const isOn = (agent: Agent, to: Section | null) =>
  sectionOf(agent) === to?.id && (!to || text(agent.botMeta?.sectionName) === to.name)

/** Agents on `id` now. */
const membersOf = (qc: QueryClient, id: string) => agentsIn(qc).filter((a) => sectionOf(a) === id)

/** File agents and groups on a section (null takes them off any). */
export async function file(qc: QueryClient, items: { agents?: string[]; groups?: string[] }, to: Section | null) {
  await qc.cancelQueries({ queryKey: agentsKey })
  const agents = agentsIn(qc)
  const moving = agents.filter((a) => items.agents?.includes(a.id) && !isOn(a, to))
  // A section renamed in Hermes Desktop has its new name only on its members: the list keeps it as they leave.
  const leaving = new Set(moving.map(sectionOf).filter((id) => id !== to?.id))
  const listed = new Map(stored(agents.find((a) => a.isDefault)).map((s) => [s.id, s.name]))
  const renamed = sectionsOf(agents).filter((s) => leaving.has(s.id) && listed.has(s.id) && listed.get(s.id) !== s.name)
  const named = (list: Section[]) =>
    list.map((s) => ({ ...s, name: renamed.find((r) => r.id === s.id)?.name ?? s.name }))
  await Promise.all([
    ...moving.map((a) => place(qc, a.id, to)),
    ...(items.groups?.length || renamed.length
      ? [writeList(qc, (list) => withGroups(items.groups ?? [], to)(named(list)))]
      : []),
  ])
}

/** A new section at the end of the list, with these in it. */
export async function createSection(qc: QueryClient, name: string, items: { agents: string[]; groups: string[] }) {
  await qc.cancelQueries({ queryKey: agentsKey })
  const section: Section = { id: newId(), name: name.trim(), groups: [] }
  await Promise.all([
    writeList(qc, (list) =>
      withGroups(items.groups, section)(list.some((s) => s.id === section.id) ? list : [...list, section]),
    ),
    file(qc, { agents: items.agents }, section),
  ])
  return section
}

/** A new name, and exactly these in it: anyone left out goes back to the top of the list. */
export async function editSection(
  qc: QueryClient,
  id: string,
  name: string,
  items: { agents: string[]; groups: string[] },
) {
  await qc.cancelQueries({ queryKey: agentsKey })
  const section: Section = { id, name: name.trim(), groups: [] }
  const out = membersOf(qc, id).filter((a) => !items.agents.includes(a.id))
  await Promise.all([
    writeList(qc, (list) => withGroups(items.groups, section)(list.map((s) => (s.id === id ? section : s)))),
    file(qc, { agents: items.agents }, section),
    ...out.map((a) => place(qc, a.id, null)),
  ])
}

/** Up or down one place, past the section beside it (wherever another device has put that one since). */
export async function moveSection(qc: QueryClient, id: string, delta: -1 | 1) {
  await qc.cancelQueries({ queryKey: agentsKey })
  const list = sectionsOf(agentsIn(qc))
  const at = list.findIndex((s) => s.id === id)
  const past = list[at + delta]?.id
  if (at < 0 || !past) return
  await writeList(qc, (now) => {
    const moving = now.find((s) => s.id === id)
    const rest = now.filter((s) => s.id !== id)
    const beside = rest.findIndex((s) => s.id === past)
    if (!moving || beside < 0) return now
    rest.splice(delta < 0 ? beside : beside + 1, 0, moving)
    return rest
  })
}

/**
 * The section goes; what was in it goes back to the top of the list, nothing
 * lost, so there's no asking first. Returns the undo.
 */
export async function deleteSection(qc: QueryClient, id: string) {
  await qc.cancelQueries({ queryKey: agentsKey })
  const list = sectionsOf(agentsIn(qc))
  const at = list.findIndex((s) => s.id === id)
  const section = list[at]
  if (!section) return async () => {}
  const members = membersOf(qc, id).map((a) => a.id)
  const wasFolded = !!useFoldStore.getState().folded[id]
  setFolded(id, false)
  await Promise.all([...members.map((m) => place(qc, m, null)), writeList(qc, (now) => now.filter((s) => s.id !== id))])
  return async () => {
    await qc.cancelQueries({ queryKey: agentsKey })
    // Back where it was, as Murmur's own now, with what was in it then and hasn't been filed elsewhere since.
    const again: Section = { id, name: section.name, groups: section.groups ?? [] }
    const free = agentsIn(qc)
      .filter((a) => members.includes(a.id) && !sectionOf(a))
      .map((a) => a.id)
    setFolded(id, wasFolded)
    await Promise.all([
      writeList(qc, (now) => {
        const next = now.filter((s) => s.id !== id)
        next.splice(Math.min(at, next.length), 0, again)
        return withGroups(again.groups!, again)(next)
      }),
      file(qc, { agents: free }, again),
    ])
  }
}

export function useSectionWrites() {
  const qc = useQueryClient()
  const run =
    <A extends unknown[], R>(fn: (qc: QueryClient, ...args: A) => Promise<R>) =>
    async (...args: A) => {
      try {
        return await fn(qc, ...args)
      } finally {
        if (!writing) void qc.invalidateQueries({ queryKey: agentsKey })
      }
    }
  return {
    file: run(file),
    create: run(createSection),
    edit: run(editSection),
    move: run(moveSection),
    remove: async (id: string) => {
      const undo = await run(deleteSection)(id)
      return run(() => undo())
    },
  }
}

// ── Folded ──────────────────────────────────────────────────────────────────
// Which sections are folded away, on this device: a phone and a computer are
// used for different things.

const KEY = scoped('murmur:sections-folded')

function load(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

const useFoldStore = create<{ folded: Record<string, boolean> }>(() => ({ folded: load() }))

export const useFolded = (id: string) => useFoldStore((s) => !!s.folded[id])
export const useFoldedMap = () => useFoldStore((s) => s.folded)

/** Only the folded ones are kept, so a deleted section leaves nothing behind. */
export function setFolded(id: string, folded: boolean) {
  useFoldStore.setState((s) => {
    const { [id]: _, ...next } = s.folded
    if (folded) next[id] = true
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // Private mode: it lasts the visit.
    }
    return { folded: next }
  })
}
