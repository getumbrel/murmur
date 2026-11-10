// Groups as roster rows, from the groups store (state/groups).

import { useAgents } from '@/state/agents'
import { useMemo } from 'react'
import { createGroup as create, foldGroups, useGroupSummaries, useGroupsAvailable } from '@/state/groups'

export type GroupChatRow = {
  id: string
  /** How it opened; empty for a chat nothing's been said in. */
  title: string
  at: number
  live: boolean
  unread: boolean
}

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
  /** The chat its row opens. */
  lead: string
  /** Every chat with the group, newest first. */
  chats: GroupChatRow[]
}

export function useGroupRows(): GroupRow[] {
  const { data } = useGroupSummaries()
  return useMemo(
    () =>
      foldGroups(data ?? []).map((g) => {
        // The chat that wants you speaks for the group, and is where its row leads: one with something
        // new, else one at work, else the last one anything was said in.
        const lead =
          g.chats.find((c) => c.unread && !c.live) ??
          g.chats.find((c) => c.live) ??
          g.chats.find((c) => c.lastLine) ??
          g.chats[0]
        return {
          id: g.id,
          name: g.name,
          memberHues: g.memberHues,
          memberIds: g.memberIds,
          subtitle: lead.lastLine || undefined,
          at: lead.lastActivityAt,
          live: g.chats.some((c) => c.live),
          unread: g.chats.some((c) => c.unread && !c.live),
          lead: lead.id,
          chats: g.chats.map((c) => ({
            id: c.id,
            title: c.title,
            at: c.lastActivityAt,
            live: c.live,
            unread: c.unread,
          })),
        }
      }),
    [data],
  )
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
