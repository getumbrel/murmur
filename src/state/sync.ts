// Hermes broadcasts `sessions.changed` whenever any chat list changes (ours or
// another app's), a routine's run included. Refresh the lists, gently: it
// fires several times per turn. An agent saving a login mid-chat refreshes
// its passwords the same way.

import type { QueryClient } from '@tanstack/react-query'
import { gateway, type GatewayEvent } from '@/hermes/gateway'

/** Hermes 0.22's `browser_vault` with action save_login, or 0.21's `browser_vault_save_login`. */
const savedLogin = (name: string, args: unknown) =>
  name === 'browser_vault_save_login' ||
  (name === 'browser_vault' && (args as { action?: unknown } | null | undefined)?.action === 'save_login')

export function wireSessionLists(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | undefined
  gateway.onEvent((ev) => {
    if (ev.type === 'tool.complete') {
      const done = (ev as GatewayEvent<'tool.complete'>).payload
      if (done && savedLogin(done.name, done.args)) void qc.invalidateQueries({ queryKey: ['vault'] })
    }
    if (ev.type !== 'sessions.changed') return
    clearTimeout(timer)
    timer = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ['chats'] })
      void qc.invalidateQueries({ queryKey: ['routine-runs'] })
      void qc.invalidateQueries({ queryKey: ['routine-job-runs'] })
    }, 400)
  })
}
