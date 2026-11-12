import { useQuery } from '@tanstack/react-query'
import { useAgents } from '@/state/agents'
import { connectionApi, connectionKey, connectionStart } from '@/state/connection'
import type { Away } from '@/state/reach'
import { isBuiltinHermes, isUmbrelHermes } from './hermes-connection-form'

/**
 * What's out of reach, and what to do or know meanwhile, as a title and a
 * line under it. Hermes alone: what to check. The device offline, or Murmur's
 * server not answering (the phone has left home, say): nobody's to blame and
 * there's nothing to fix, so it says what's still here.
 */
export function awayWords(away: Away, { agents, builtin, umbrel }: { agents: number; builtin: boolean; umbrel: boolean }) {
  const here = agents ? 'Recent chats are here as you last saw them.' : ''
  if (away === 'offline') return ['You’re offline', here || 'Murmur will be back when you are.'] as const
  if (away === 'murmur') {
    const who = agents > 1 ? 'your agents' : agents ? 'your agent' : 'Murmur'
    return [`Can’t reach ${who}`, `${here} Murmur keeps trying.`.trim()] as const
  }
  if (builtin) return ['Murmur’s built-in Hermes isn’t responding', 'Try restarting Murmur.'] as const
  return [
    'Can’t reach Hermes',
    umbrel ? 'Make sure the Hermes Agent app is running on your Umbrel.' : 'Make sure Hermes is running. Murmur keeps trying.',
  ] as const
}

/** The words for what's away, knowing which Hermes this is and whether there's a roster to read meanwhile. */
export function useAwayWords(away: Away | undefined, enabled = !!away) {
  // The Umbrel's own Hermes app, not merely an address from the environment:
  // a standalone Docker run sets HERMES_URL too, and has no Umbrel to check.
  const current = useQuery({ queryKey: connectionKey, queryFn: connectionApi.get, enabled, staleTime: 60_000, ...connectionStart }).data
  const agents = useAgents().data?.length ?? 0
  // Murmur's own: nothing to check but Murmur itself.
  return away ? awayWords(away, { agents, builtin: isBuiltinHermes(current), umbrel: isUmbrelHermes(current) }) : undefined
}
