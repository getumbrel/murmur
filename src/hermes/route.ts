// Which Hermes a call goes to, worked out from what it names.
//
// Callers don't say: they pass an agent's id where Hermes expects a profile,
// as they always did. Here the id is read for its Hermes and put back to the
// plain name Hermes knows. A call that names no agent but names a chat, a
// live session or a group goes where that came from (instance.ts remembers).
// One that names nothing goes to the first Hermes, unless the caller says
// (`on`).

import { firstHermes, hermesIds, homeOf, noteHome, placeOf } from './instance'

/** With one Hermes there is nothing to work out, and ids are already Hermes's own. */
const several = () => hermesIds().length > 1

type Json = Record<string, unknown>

/** An agent's id, as `{profile}` or `{name}` to a profiles.* method, or in a group's members. */
function plain(value: unknown, found: (hermes: string | null) => void): unknown {
  if (typeof value !== 'string') return value
  const { hermes, profile } = placeOf(value)
  if (profile !== value) found(hermes)
  return profile
}

/**
 * A socket call's Hermes and its params as Hermes expects them.
 * `on` wins; then the agent named; then the chat, session or group named.
 */
export function routeCall(method: string, params: Json, on?: string | null): { hermes: string | null; params: Json } {
  if (!several()) return { hermes: on ?? firstHermes(), params }
  let named: string | null | undefined
  const found = (hermes: string | null) => (named ??= hermes)
  const out: Json = { ...params }
  if ('profile' in out) out.profile = plain(out.profile, found)
  if (method.startsWith('profiles.') && 'name' in out) out.name = plain(out.name, found)
  if (Array.isArray(out.members)) {
    out.members = out.members.map((m) =>
      m && typeof m === 'object' && 'profile' in m ? { ...m, profile: plain((m as Json).profile, found) } : m,
    )
  }
  // A plain profile name is the first Hermes's agent only if nothing else says otherwise.
  const home = homeOf(out.session_id) ?? homeOf(out.room_id) ?? homeOf(out.stored_session_id)
  const hermes = on ?? named ?? home ?? firstHermes()
  return { hermes, params: out }
}

/**
 * A REST path's Hermes and the path as Hermes expects it: the agent in
 * `?profile=` or in `/api/profiles/<id>`, then a session in the path.
 */
export function routePath(path: string, body: unknown, on?: string | null): { hermes: string | null; path: string; body: unknown } {
  if (!several()) return { hermes: on ?? firstHermes(), path, body }
  let named: string | null | undefined
  const found = (hermes: string | null) => (named ??= hermes)
  let out = path.replace(/([?&]profile=)([^&#]*)/, (_, key: string, value: string) => {
    return key + encodeURIComponent(plain(decodeURIComponent(value), found) as string)
  })
  out = out.replace(/^(\/api\/profiles\/)([^/?#]+)/, (_, head: string, value: string) => {
    return head + encodeURIComponent(plain(decodeURIComponent(value), found) as string)
  })
  let sent = body
  if (body && typeof body === 'object' && !Array.isArray(body) && !(body instanceof FormData)) {
    const b = body as Json
    if (typeof b.profile === 'string') sent = { ...b, profile: plain(b.profile, found) }
  }
  const session = /^\/api\/sessions\/([^/?#]+)/.exec(out)?.[1]
  const home = session ? homeOf(decodeURIComponent(session)) : undefined
  return { hermes: on ?? named ?? home ?? firstHermes(), path: out, body: sent }
}

const ID_KEYS = ['session_id', 'stored_session_id', 'resolved_id', 'room_id', 'session_key'] as const

/** Remember where the chats, sessions and groups in an answer or an event came from. */
export function noteAnswer(hermes: string | null, value: unknown, depth = 0) {
  if (!hermes || !several() || !value || typeof value !== 'object' || depth > 3) return
  if (Array.isArray(value)) {
    for (const item of value) noteAnswer(hermes, item, depth + 1)
    return
  }
  const row = value as Json
  for (const key of ID_KEYS) noteHome(row[key], hermes)
  // A row of a list of chats, live sessions or groups: its own id.
  if (depth > 0 && typeof row.id === 'string') noteHome(row.id, hermes)
  for (const key of ['sessions', 'rooms', 'room', 'payload', 'session', 'last_session', 'canonical_session', 'profiles'] as const) {
    if (row[key] && typeof row[key] === 'object') noteAnswer(hermes, row[key], depth + 1)
  }
}
