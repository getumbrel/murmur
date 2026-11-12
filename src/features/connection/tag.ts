// Which server an agent is on, said only where its name alone doesn't: two
// agents going by one name ("Hermes" on Home and on VPS). Everywhere else the
// list is just agents.

import { useMemo } from 'react'
import { useAgents } from '@/state/agents'
import { useServers } from '@/state/connection'
import { hermesOf } from '@/hermes/instance'

const key = (name: string) => name.trim().toLowerCase()

/** For an agent's id: its server's name where another agent shares its name, else nothing. */
export function useServerTags(): (agentId: string) => string | undefined {
  const { data: agents } = useAgents()
  const servers = useServers()
  return useMemo(() => {
    if (servers.length < 2 || !agents) return () => undefined
    const sharing = new Map<string, number>()
    for (const a of agents) sharing.set(key(a.name), (sharing.get(key(a.name)) ?? 0) + 1)
    const tags = new Map<string, string>()
    for (const a of agents) {
      const server = (sharing.get(key(a.name)) ?? 0) > 1 ? servers.find((s) => s.id === hermesOf(a.id))?.name : undefined
      if (server) tags.set(a.id, server)
    }
    return (agentId: string) => tags.get(agentId)
  }, [agents, servers])
}

/** One agent's tag. */
export const useServerTag = (agentId: string | undefined) => useServerTags()(agentId ?? '')
