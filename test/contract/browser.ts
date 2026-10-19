// Just enough of a browser for Murmur's own data layer (src/hermes, src/state)
// to run here unchanged: relative fetches and the socket go to the Murmur
// server under test, as they would from a page it served. Tests can then call
// the app's real functions (createAgent, connectLocal, fetchRunResult…)
// against a real Hermes, as well as checking the wire directly.

import { inject } from 'vitest'

const origin = inject('murmur')
const events = new EventTarget()
const memory = () => {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: (i: number) => [...items.keys()][i] ?? null,
    get length() {
      return items.size
    },
  }
}

const nodeFetch = globalThis.fetch
Object.assign(globalThis, {
  window: globalThis,
  location: new URL(origin),
  document: { cookie: '', visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
  localStorage: memory(),
  sessionStorage: memory(),
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
  dispatchEvent: events.dispatchEvent.bind(events),
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    nodeFetch(typeof input === 'string' && input.startsWith('/') ? `${origin}${input}` : input, init),
})
