// Is there a model Hermes can think with? Hermes Desktop asks the same
// question with setup.runtime_check; its `ok` is authoritative.

import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { rpc, useConnection } from '@/hermes/gateway'

export type RuntimeCheck = { ok: boolean; provider?: string; model?: string; source?: string; error?: string }

/** Hermes's "readiness check still in progress; retrying next tick". */
const STILL_CHECKING = 5097

export const readinessKey = (profile?: string) => ['readiness', profile ?? 'default'] as const

export function useRuntimeCheck(profile?: string) {
  return useQuery({
    queryKey: readinessKey(profile),
    queryFn: async () => {
      const params = profile ? { profile } : {}
      for (let tries = 0; ; tries++) {
        try {
          return await rpc<RuntimeCheck>('setup.runtime_check', params, 20_000)
        } catch (e) {
          // Still working it out: ask again. The boot record below only ever turns to "yes",
          // so it misses a model that's just been removed.
          if ((e as { code?: number } | null)?.code !== STILL_CHECKING || tries >= 3) break
          await new Promise((done) => setTimeout(done, 1000))
        }
      }
      // Older or busy backends: the boot record is the next best answer.
      const s = await rpc<{ provider_configured?: boolean }>('setup.status', params, 10_000)
      return { ok: !!s.provider_configured }
    },
    staleTime: 60_000,
  })
}

// Give up waiting after a few seconds so a missing Hermes shows the app (and
// the connection banner) instead of an endless splash.
const useBoot = create(() => ({ late: false }))
const BOOT_MS = 6000
let bootTimer = setTimeout(() => useBoot.setState({ late: true }), BOOT_MS)

/**
 * The app proper starts now, after a first-run step in front of it (choosing
 * a Hermes, Getting ready) that can take far longer than the wait: Hermes
 * gets its few seconds again, rather than counting as not answering.
 */
export function restartBoot() {
  clearTimeout(bootTimer)
  useBoot.setState({ late: false })
  bootTimer = setTimeout(() => useBoot.setState({ late: true }), BOOT_MS)
}

// The welcome plays once per browser.
const WELCOMED = 'murmur:welcomed'
const useWelcomedStore = create(() => {
  try {
    return { welcomed: localStorage.getItem(WELCOMED) === '1' }
  } catch {
    return { welcomed: false }
  }
})
export const useWelcomed = () => useWelcomedStore((s) => s.welcomed)
export function markWelcomed() {
  try {
    localStorage.setItem(WELCOMED, '1')
  } catch {
    // Private mode: it just plays again next time.
  }
  useWelcomedStore.setState({ welcomed: true })
}

/**
 * - `loading`: still asking (the splash shows).
 * - `ready`: the main agent can think, and this browser has seen the welcome.
 * - `needs-welcome`: ready, but first visit here.
 * - `needs-setup`: no model yet.
 * - `unknown`: Hermes didn't answer in time; show the app and let the banner explain.
 */
export type Readiness = 'loading' | 'ready' | 'needs-welcome' | 'needs-setup' | 'unknown'

export function useReadiness(): Readiness {
  const { data, isPending, isError } = useRuntimeCheck()
  const late = useBoot((s) => s.late)
  const open = useConnection((s) => s.state === 'open')
  const welcomed = useWelcomed()
  if (isPending) return late && !open ? 'unknown' : 'loading'
  if (isError || !data) return 'unknown'
  if (!data.ok) return 'needs-setup'
  return welcomed ? 'ready' : 'needs-welcome'
}
