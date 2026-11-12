// How long an agent waits for the answer to a question it asks you. Hermes
// 0.23.1 cut its own wait from an hour to 90 seconds, for chats on messaging
// apps, where a message sent instead of an answer was held behind the question.
// In Murmur a question buzzes your phone, and a minute and a half is too short
// to get to it; a message written instead of an answer goes through at once
// (src/state/chats.ts), and the agent's other chats and routines run while it
// waits. So every agent waits an hour, as it did before 0.23.1.
//
// Murmur only lifts Hermes's own default: an agent with its own wait (anything
// but that default) keeps it, and a Hermes that already waits an hour or more
// (0.23.0 and before) is left as it is. That also keeps an hour Murmur wrote
// out of the way of Hermes's own 0.23.1 upgrade, which lowers a still-default
// hour to 90 seconds and couldn't tell Murmur's from its own.

import { useEffect } from 'react'
import { api, on } from '@/hermes/rest'
import { rememberedSet, upkeep } from '@/lib/upkeep'
import { hermesOf, scoped } from '@/hermes/instance'

/** Seconds an agent waits for your answer. */
export const QUESTION_WAIT = 3600

type WaitConfig = { agent?: { clarify_timeout?: unknown }; clarify?: { timeout?: unknown } }

const seconds = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v))

/**
 * The wait to give an agent, from its own config and Hermes's default; undefined to leave it be:
 * its own wait (or the older `clarify.timeout`, which wins), or a Hermes that already waits as long.
 */
export function questionWait(own: WaitConfig | undefined, defaults: WaitConfig | undefined): number | undefined {
  if (seconds(own?.clarify?.timeout) !== undefined) return undefined
  const hermes = seconds(defaults?.agent?.clarify_timeout)
  // Unknown, unlimited (0 or less), or an hour already.
  if (hermes === undefined || !Number.isFinite(hermes) || hermes <= 0 || hermes >= QUESTION_WAIT) return undefined
  const mine = seconds(own?.agent?.clarify_timeout)
  return mine === undefined || mine === hermes ? QUESTION_WAIT : undefined
}

// Each Hermes's defaults, read once (again after a failed read).
const defaultWait = new Map<string | null, Promise<WaitConfig | undefined>>()
function readDefaults(hermes: string | null) {
  let read = defaultWait.get(hermes)
  if (!read) {
    read = api.get<WaitConfig>('/api/config/defaults', on(hermes)).catch(() => {
      defaultWait.delete(hermes)
      return undefined
    })
    defaultWait.set(hermes, read)
  }
  return read
}

// Agents known to be in step, remembered across reloads (for a day).
const synced = rememberedSet(scoped('murmur:question-wait:1'))

/** Gives one agent Murmur's wait where it has Hermes's shorter default. */
export async function keepQuestionWait(profile: string) {
  const q = `profile=${encodeURIComponent(profile)}`
  const [own, defaults] = await Promise.all([
    api.get<WaitConfig>(`/api/config?${q}&include_defaults=false`),
    readDefaults(hermesOf(profile)),
  ])
  const wait = questionWait(own, defaults)
  // PUT deep-merges into the agent's config file, so only this key changes.
  if (wait !== undefined) await api.put(`/api/config?${q}`, { config: { agent: { clarify_timeout: wait } } })
  synced.add(profile)
}

/**
 * Every agent waits for your answers as long as Murmur's, agents made in other
 * apps included. Quiet, like the rest of Murmur's upkeep: idle-time requests,
 * one at a time, nothing once every agent is in step.
 */
export function useQuestionWaitSync(agentIds: readonly string[] | undefined) {
  const key = agentIds?.join('\n') ?? ''
  useEffect(() => {
    const ids = key ? key.split('\n') : []
    if (ids.every((id) => synced.has(id))) return
    void upkeep(async () => {
      for (const id of ids.filter((id) => !synced.has(id))) await keepQuestionWait(id).catch(() => {})
    }).catch(() => {})
  }, [key])
}
