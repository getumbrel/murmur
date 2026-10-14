// Groups as roster rows, from the groups store (state/groups).

import { useAgents } from '@/state/agents'
import { createGroup as create, useGroupSummaries, useGroupsAvailable } from '@/state/groups'

export type GroupRow = {
  id: string
  name: string
  memberHues: number[]
  memberIds: string[]
  /** "Atlas: Sounds good"; empty for a brand-new group. */
  subtitle?: string
  /** Last activity, ms. */
  at: number
  /** A round is running. */
  live: boolean
  /** Someone said something since you last looked. */
  unread: boolean
}

export function useGroupRows(): GroupRow[] {
  const { data } = useGroupSummaries()
  return (data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    memberHues: g.memberHues,
    memberIds: g.memberIds,
    subtitle: g.lastLine || undefined,
    at: g.lastActivityAt,
    live: g.live,
    unread: g.unread,
  }))
}

/** Whether "New group" makes sense here: Hermes can host groups, and there are two agents to put in one. */
export function useCanMakeGroups() {
  const available = useGroupsAvailable()
  const { data: agents } = useAgents()
  return available && (agents?.length ?? 0) >= 2
}

export async function createGroup(group: { name?: string; memberIds: string[] }): Promise<string | null> {
  return create(group)
}
