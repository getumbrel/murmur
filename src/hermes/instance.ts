// Which Hermes this tab is for.
//
// A Murmur can be connected to several Hermes (one on an Umbrel, one on a
// VPS). The browser uses one at a time: the server keeps the choice in the
// `murmur_hermes` cookie and sends it with the page, so it is known here before
// anything else loads. Each tab then sticks with the Hermes it started with:
// its requests name it (a header, or `?hermes=` on the socket), and what it
// keeps in local storage is filed under it. Two Hermes never mix; switching
// reloads the app (src/state/connection.ts).

export const HERMES_HEADER = 'x-murmur-hermes'
export const HERMES_PARAM = 'hermes'
/** Fired when the server says this tab's Hermes was removed (in another tab or browser). */
export const HERMES_GONE = 'murmur:hermes-gone'

/** The browser's current choice, as its `murmur_hermes` cookie says now. */
export function browserHermes(): string | null {
  const match = /(?:^|;\s*)murmur_hermes=([A-Za-z0-9]+)/.exec(document.cookie)
  return match?.[1] ?? null
}

let current = browserHermes()

// A notification's link names the Hermes it's from (?hermes=<id>). The server
// has made that the browser's choice already, so the address needn't say.
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has(HERMES_PARAM)) {
  const url = new URL(location.href)
  url.searchParams.delete(HERMES_PARAM)
  history.replaceState(history.state, '', url)
}

/** The Hermes this tab is for: null until the server has named one (a first visit in development). */
export const tabHermes = () => current

// The first Hermes (the one set by the server, or the first set up in the
// app, or the umbrelOS default before either) keeps the browser's original,
// unprefixed storage, so nothing anyone had before is lost. The server never
// lets two of these exist at once.
const ORIGINAL = new Set(['env', 'main', 'default'])
const scopeOf = (id: string | null) => (!id || ORIGINAL.has(id) ? '' : id)

/**
 * A local-storage key for this Hermes's things: 'murmur:seen' stays as it is
 * for the first Hermes and becomes 'murmur@<id>:seen' for others. Read once at
 * startup is fine: switching reloads.
 */
export const scoped = (key: string) => {
  const scope = scopeOf(current)
  return scope ? key.replace(/^murmur:/, `murmur@${scope}:`) : key
}

/**
 * Carry on with `id` without a reload, when it files things in the same
 * place (a first run's default becoming the Hermes just set up). False when
 * a reload is needed.
 */
export function adoptHermes(id: string) {
  if (scopeOf(id) !== scopeOf(current)) return false
  current = id
  return true
}

/** Forget what this browser kept for a removed Hermes. */
export function forgetHermesStorage(id: string) {
  const scope = scopeOf(id)
  if (!scope) return
  try {
    for (const store of [localStorage, sessionStorage]) {
      for (const key of Object.keys(store)) if (key.startsWith(`murmur@${scope}:`)) store.removeItem(key)
    }
  } catch {
    // Private mode: nothing was kept.
  }
}
