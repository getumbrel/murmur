// Older Hermes releases speak a smaller protocol (0.19 has no profiles.* or
// groups.* methods). Murmur keeps working on them: agent lists fall back to the
// REST API, and features that need newer methods simply stay hidden.

import { isOpen, rpc } from './gateway'
import { api, on } from './rest'
import { agentIdOn, firstHermes, hermesIds } from './instance'

/** JSON-RPC "method not found": this Hermes predates the feature. */
export function isMissingMethod(error: unknown) {
  return (error as { code?: number } | null)?.code === -32601
}

/** Don't hammer Hermes for features it doesn't have; retry anything else once. */
export const retryUnlessMissing = (failures: number, error: unknown) => !isMissingMethod(error) && failures < 1

type ListedProfile = { name: string; is_default: boolean; [key: string]: unknown }

/** The Hermes that only have REST (older than profiles.list). */
const restOnly = new Set<string | null>()

/**
 * Every agent (profile) of one Hermes (the first, unless said). Each one's
 * `name` is the agent's id: Hermes's own name for it on the first Hermes,
 * with the Hermes's id in front on any other (instance.ts), so passing it
 * back as a `profile` reaches the right Hermes. Newer Hermes answers
 * profiles.list with presentation metadata and each agent's latest chats;
 * older ones only have REST, which has neither, so agents there use their
 * default look.
 */
export async function listProfiles<P extends ListedProfile = ListedProfile>(
  params: { include_sessions?: boolean } = {},
  hermes: string | null = firstHermes(),
) {
  const named = (profiles: P[]) => profiles.map((p) => ({ ...p, name: agentIdOn(hermes, p.name) }))
  if (!restOnly.has(hermes)) {
    try {
      return named((await rpc<{ profiles: P[] }>('profiles.list', params, undefined, hermes)).profiles)
    } catch (error) {
      if (!isMissingMethod(error)) throw error
      restOnly.add(hermes)
    }
  }
  return named((await api.get<{ profiles: P[] }>('/api/profiles', on(hermes))).profiles)
}

/** Every agent of every Hermes, by id. With several, one that's away or doesn't answer is left out, not waited for. */
export async function listEveryProfile<P extends ListedProfile = ListedProfile>(params: { include_sessions?: boolean } = {}) {
  const all = hermesIds().length ? [...hermesIds()] : [null]
  const ids = all.length > 1 ? all.filter(isOpen) : all
  const lists = await Promise.all(ids.map((hermes) => listProfiles<P>(params, hermes).catch(() => [] as P[])))
  return lists.flat()
}

/** Every agent's id on one Hermes (the first, unless said). */
export const listProfileNames = async (hermes: string | null = firstHermes()) =>
  (await listProfiles({}, hermes)).map((p) => p.name)
