// Hermes's own notices (a provider running low on credit, an agent slow to
// wake up) become a quiet toast. Every chat this tab holds hears the same
// notice, so each one shows once, and a newer one with the same key replaces
// it in place.

import { toast } from 'sonner'
import { gateway } from '@/hermes/gateway'

type Notice = { text?: unknown; level?: unknown; kind?: unknown; ttl_ms?: unknown; key?: unknown; id?: unknown }

const AGAIN_MS = 60_000
const shown = new Map<string, { text: string; at: number }>()

const idOf = (key: string) => `hermes-notice:${key}`

export function showNotice(n: Notice, now = Date.now()) {
  const text = typeof n.text === 'string' ? n.text.trim() : ''
  if (!text) return false
  const key = (typeof n.key === 'string' && n.key) || (typeof n.id === 'string' && n.id) || text
  const last = shown.get(key)
  if (last?.text === text && now - last.at < AGAIN_MS) return false
  shown.set(key, { text, at: now })
  // Sticky ones stay until Hermes clears them (or they're swiped away).
  const duration = n.kind === 'sticky' ? Infinity : typeof n.ttl_ms === 'number' && n.ttl_ms > 0 ? n.ttl_ms : undefined
  const show =
    n.level === 'error'
      ? toast.error
      : n.level === 'warn'
        ? toast.warning
        : n.level === 'success'
          ? toast.success
          : toast
  show(text, { id: idOf(key), duration })
  return true
}

let wired = false

export function wireNotices() {
  if (wired) return
  wired = true
  gateway.onEvent((ev) => {
    const payload = ((ev as { payload?: Notice & { key?: unknown } }).payload ?? {}) as Notice
    if (ev.type === 'notification.show') showNotice(payload)
    if (ev.type === 'notification.clear' && typeof payload.key === 'string') {
      shown.delete(payload.key)
      toast.dismiss(idOf(payload.key))
    }
  })
}
