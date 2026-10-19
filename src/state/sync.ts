// Hermes broadcasts `sessions.changed` whenever any chat list changes (ours or
// another app's), a routine's run included. Refresh the lists, gently: it
// fires several times per turn.

import type { QueryClient } from '@tanstack/react-query'
import { gateway } from '@/hermes/gateway'

export function wireSessionLists(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | undefined
  gateway.onEvent((ev) => {
    if (ev.type !== 'sessions.changed') return
    clearTimeout(timer)
    timer = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ['chats'] })
      void qc.invalidateQueries({ queryKey: ['routine-runs'] })
      void qc.invalidateQueries({ queryKey: ['routine-job-runs'] })
    }, 400)
  })
}
