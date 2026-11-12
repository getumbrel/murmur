// How a Hermes reads on screen. A Hermes is a "server" there (the machine it
// runs on, by name), so it never reads like the main agent, which Hermes also
// calls "Hermes".

import type { HermesConnection, KnownHermes } from '@/state/connection'
import { BUILTIN_ID } from '@/state/setup'

/** Where the Hermes Agent app answers on an Umbrel. */
const UMBREL_HOST = 'hermes-agent_web_1'

/** Whether this is the Hermes Agent app on this Umbrel (at its fixed address), saved or set by umbrelOS. */
export function isUmbrelHermes(c: Partial<Pick<HermesConnection, 'url'>> | undefined) {
  return !!c?.url && hostOf(c.url).startsWith(UMBREL_HOST)
}

/** Whether this is the Hermes that comes with Murmur. */
export function isBuiltinHermes(c: Partial<Pick<HermesConnection, 'id' | 'source'>> | undefined) {
  return !!c && (c.id === BUILTIN_ID || c.source === 'builtin')
}

/** Which way a Hermes's dot goes. The built-in on its first start is on its way, not down. */
export const toneOf = (c: Pick<KnownHermes, 'status'>, starting = false): 'success' | 'danger' | 'warning' =>
  c.status === 'connected' ? 'success' : starting ? 'warning' : c.status === 'unreachable' ? 'danger' : 'warning'

/**
 * "umbrel.local · Hermes 0.21.5", or what's wrong, in a few words. Where it
 * is, never a container's name: the built-in "Comes with Murmur", the Hermes
 * Agent app is "On this Umbrel".
 */
export function hermesDetail(c: KnownHermes, { starting = false } = {}) {
  const where = isBuiltinHermes(c) ? 'Comes with Murmur' : isUmbrelHermes(c) ? 'On this Umbrel' : hostOf(c.url)
  if (c.status !== 'connected' && starting) return `Starting up · ${where}`
  if (c.status === 'unreachable') return `Can’t reach it · ${where}`
  if (c.status !== 'connected') return `Needs signing in · ${where}`
  return [where, c.hermesVersion && `Hermes ${c.hermesVersion}`].filter(Boolean).join(' · ')
}

export function hostOf(url: string) {
  try {
    const u = new URL(url)
    return u.host + u.pathname.replace(/\/$/, '')
  } catch {
    return url
  }
}
