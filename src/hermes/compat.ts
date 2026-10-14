// Older Hermes releases speak a smaller protocol (0.19 has no profiles.* or
// groups.* methods). Murmur keeps working on them: agent lists fall back to the
// REST API, and features that need newer methods simply stay hidden.

import { rpc } from './gateway'
import { api } from './rest'

/** JSON-RPC "method not found": this Hermes predates the feature. */
export function isMissingMethod(error: unknown) {
  return (error as { code?: number } | null)?.code === -32601
}

/** Don't hammer Hermes for features it doesn't have; retry anything else once. */
export const retryUnlessMissing = (failures: number, error: unknown) => !isMissingMethod(error) && failures < 1

type ListedProfile = { name: string; is_default: boolean; [key: string]: unknown }

let restOnly = false

/**
 * Every agent (profile). Newer Hermes answers profiles.list with presentation
 * metadata and each agent's latest chats; older ones only have REST, which has
 * neither, so agents there use their default look.
 */
export async function listProfiles<P extends ListedProfile = ListedProfile>(params: { include_sessions?: boolean } = {}) {
  if (!restOnly) {
    try {
      return (await rpc<{ profiles: P[] }>('profiles.list', params)).profiles
    } catch (error) {
      if (!isMissingMethod(error)) throw error
      restOnly = true
    }
  }
  return (await api.get<{ profiles: P[] }>('/api/profiles')).profiles
}

export const listProfileNames = async () => (await listProfiles()).map((p) => p.name)
