// Hermes's own gateway: the process that runs routines on schedule and
// carries messaging (Telegram, WhatsApp). Not Murmur's socket to Hermes,
// which hermes/gateway.ts also calls a gateway.
//
// Umbrel's image and Murmur's built-in Hermes always run it. A Hermes started
// with just `hermes dashboard` doesn't, and until someone starts it routines
// never fire and nothing answers on Telegram. Hermes can start it itself where
// it's installed with a service manager (launchd, systemd). Its Docker images
// can't yet: on 0.22.5 every action their dashboard spawns stops at `hermes pm
// repair`. Either way it says so only in a log nobody reads, so the way to
// know is to watch for it coming up, or for Hermes's own start giving up.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, HermesError } from '@/hermes/rest'
import { telegramKey } from '@/state/telegram'
import { whatsappKey } from '@/state/whatsapp'

type Status = { gateway_running?: boolean }
/** What became of the last `hermes gateway start` Hermes ran for the dashboard. */
type Action = { running?: boolean; exit_code?: number | null }

/** How long a gateway takes to come up once asked, before Murmur stops waiting. */
const START_MS = 20_000

const q = (profile: string) => `?profile=${encodeURIComponent(profile)}`
const gatewayKey = (agentId: string) => ['hermes-gateway', agentId] as const

/**
 * Whether the gateway that runs an agent's routines is off, with a way to
 * start it. Off only when Hermes says so: unknown, or a Hermes that doesn't
 * say, counts as running.
 */
export function useHermesGateway(agentId: string | undefined, { live = false } = {}) {
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: gatewayKey(agentId ?? ''),
    enabled: Boolean(agentId),
    queryFn: () => api.get<Status>(`/api/status${q(agentId!)}`),
    staleTime: 30_000,
    // While it's in front of someone, notice it being started elsewhere too.
    refetchInterval: live ? 15_000 : false,
  })

  /** Start it. False if it never came up. */
  const start = async () => {
    if (!agentId) return false
    const now = await startGateway(agentId)
    if (!now) return false
    qc.setQueryData(gatewayKey(agentId), now)
    // It brings messaging up with it.
    void qc.invalidateQueries({ queryKey: telegramKey(agentId) })
    void qc.invalidateQueries({ queryKey: whatsappKey(agentId) })
    return true
  }

  return { off: status.data?.gateway_running === false, start }
}

/** Ask Hermes to start an agent's gateway and wait for it: Hermes's status once it's up, or null if it never came. */
export async function startGateway(agentId: string): Promise<Status | null> {
  try {
    await api.post(`/api/gateway/start${q(agentId)}`, {})
  } catch (e) {
    // 409: another gateway already serves this agent (Hermes's multiplexer).
    if (!(e instanceof HermesError && e.status === 409)) return null
  }
  const deadline = Date.now() + START_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const [now, action] = await Promise.all([
      api.get<Status>(`/api/status${q(agentId)}`).catch(() => null),
      api.get<Action>('/api/actions/gateway-start/status').catch(() => null),
    ])
    if (now?.gateway_running) return now
    // Hermes's own `hermes gateway start` gave up: no use waiting for it.
    if (action?.running === false && action.exit_code) return null
  }
  return null
}
