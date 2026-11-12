// Why a Hermes's agents can't be reached right now, in a few words, where the
// app has several. Each agent's row says it where the agent sits, so the rest
// of the list carries on as it was (features/home/roster.tsx). With one Hermes
// the island speaks for the whole app, as it always did, and so it does when
// this device is offline or Murmur itself can't be reached (state/reach.ts):
// no one server is to blame.

import { useAway } from '@/hermes/gateway'
import { troubleOf, useServer, useSeveral } from '@/state/connection'
import { useAway as useAwayAll } from '@/state/reach'

/** "Can’t reach VPS", or what that Hermes needs; nothing while it's there, or where it's the only one. */
export function useUnreachable(hermes: string | null | undefined): string | undefined {
  const several = useSeveral()
  const away = useAway(hermes)
  const all = useAwayAll()
  const server = useServer(hermes)
  if (!several || all === 'offline' || all === 'murmur') return undefined
  const name = server?.name ?? 'its server'
  // One the app can't use as it is isn't dialed: said for as long as it's so.
  const trouble = troubleOf(server)
  if (trouble === 'outdated') return `${name} needs an update`
  if (trouble === 'sign-in') return `${name} needs signing in`
  return away ? `Can’t reach ${name}` : undefined
}
