// What an agent remembers: the short notes Hermes keeps in the agent's
// USER.md ("About you") and MEMORY.md ("Notes"), one card per § section.
//
// Hermes addresses each card by position (memory:<source>:<index>, MEMORY.md
// first), so ids shift whenever the agent saves something or a card goes.
// Every change therefore re-reads the list and finds its card by text right
// before writing, and the list is refetched afterwards.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/hermes/rest'

export type MemoryKind = 'you' | 'note'

export type Memory = {
  /** Hermes's positional id at read time; only good until the next change. */
  id: string
  kind: MemoryKind
  text: string
  /** Hermes trims long cards in the list; the full text is fetched to edit. */
  clipped: boolean
}

type Card = { source: 'memory' | 'profile'; title: string; body: string; timestamp?: number | null }

const CLIP = 1200
const q = (profile: string) => `?profile=${encodeURIComponent(profile)}`

export const memoryKey = (agentId: string) => ['memory', agentId] as const

async function readMemories(agentId: string): Promise<Memory[]> {
  const res = await api.get<{ memory?: Card[] }>(`/api/learning/graph${q(agentId)}`)
  return (res.memory ?? []).map((card, i) => ({
    id: `memory:${card.source}:${i}`,
    kind: card.source === 'profile' ? 'you' : 'note',
    text: card.body.trim(),
    clipped: card.body.length >= CLIP,
  }))
}

/** `watch` re-reads every few seconds, e.g. while the agent saves something it was told. */
export function useMemories(agentId: string, { enabled = true, watch = false } = {}) {
  return useQuery({
    queryKey: memoryKey(agentId),
    queryFn: () => readMemories(agentId),
    enabled,
    staleTime: 15_000,
    refetchInterval: watch ? 4_000 : false,
  })
}

/** Today's id for a card, matched by kind and text. */
async function currentId(agentId: string, memory: Memory) {
  const fresh = await readMemories(agentId)
  const match = fresh.find((m) => m.kind === memory.kind && m.text === memory.text)
  if (!match) throw new Error(`${memory.kind === 'you' ? 'That' : 'That note'} changed in the meantime. Take another look.`)
  return match.id
}

// One change at a time, so positions can't move under a write in flight.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => {})
  return next
}

/** The whole text of a card, for editing one the list cut short. */
export async function fullMemoryText(agentId: string, memory: Memory) {
  if (!memory.clipped) return memory.text
  const id = await currentId(agentId, memory)
  const res = await api.get<{ content?: string }>(`/api/learning/node${q(agentId)}&id=${encodeURIComponent(id)}`)
  return (res.content ?? memory.text).trim()
}

export function useMemoryActions(agentId: string) {
  const qc = useQueryClient()
  const key = memoryKey(agentId)
  const refresh = () => qc.invalidateQueries({ queryKey: key })

  /** Drop or swap a card in the cache now, so the list answers instantly. */
  const patch = (memory: Memory, next: Memory | null) =>
    qc.setQueryData<Memory[]>(key, (list) =>
      list?.flatMap((m) => (m.id === memory.id ? (next ? [next] : []) : [m])),
    )

  return {
    edit: (memory: Memory, text: string) =>
      serial(async () => {
        const content = text.trim()
        if (!content) throw new Error('A memory can’t be empty.')
        const id = await currentId(agentId, memory)
        await api.put('/api/learning/node', { id, content, profile: agentId })
        patch(memory, { ...memory, text: content, clipped: content.length >= CLIP })
      }).finally(refresh),

    forget: (memory: Memory) => {
      const before = qc.getQueryData<Memory[]>(key)
      patch(memory, null)
      return serial(async () => {
        const id = await currentId(agentId, memory)
        await api.delete('/api/learning/node', { id, profile: agentId })
      })
        .catch((error) => {
          if (before) qc.setQueryData(key, before)
          throw error
        })
        .finally(refresh)
    },

    forgetAll: () =>
      serial(async () => {
        await api.post(`/api/memory/reset${q(agentId)}`, { target: 'all' })
        qc.setQueryData<Memory[]>(key, [])
      }).finally(refresh),
  }
}

/**
 * What to send in chat when the person asks the agent to remember something.
 * There's no way to add a memory directly; the agent saves it itself.
 */
export function rememberMessage(text: string) {
  const clean = text.trim()
  return `Please remember this: ${/[.!?…]$/.test(clean) ? clean : `${clean}.`}`
}
