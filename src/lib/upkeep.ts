// Background upkeep (keeping every agent's settings in step) must never
// compete with what the person is doing. Browsers allow six requests at a time
// per server and some Hermes config reads take seconds, so a burst of upkeep
// would queue their own taps behind it. Jobs here run one at a time, each only
// once the page is idle, and what's been done is remembered across reloads so
// most page loads have nothing to do at all.

let queue: Promise<unknown> = Promise.resolve()

const idle = () =>
  new Promise<void>((resolve) => {
    // A beat first, so the screen's own requests go out ahead of us.
    setTimeout(() => {
      if ('requestIdleCallback' in window) requestIdleCallback(() => resolve(), { timeout: 3000 })
      else resolve()
    }, 800)
  })

/** Runs `job` after every job queued before it, once the page is idle. */
export function upkeep<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(idle).then(job)
  queue = run.catch(() => {})
  return run
}

/**
 * A set of ids kept in this browser across reloads, forgotten after `ttl` so
 * changes made in other apps are still caught up eventually.
 */
export function rememberedSet(key: string, ttl = 24 * 60 * 60_000) {
  let ids = new Set<string>()
  let at = Date.now()
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { ids: string[]; at: number } | null
    if (saved && Date.now() - saved.at < ttl) {
      ids = new Set(saved.ids)
      at = saved.at
    }
  } catch {
    // Private mode or junk: start empty.
  }
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify({ ids: [...ids], at }))
    } catch {
      // Private mode: remembered for this page load only.
    }
  }
  return {
    has: (id: string) => ids.has(id),
    add: (id: string) => void (ids.add(id), save()),
    delete: (id: string) => void (ids.delete(id), save()),
    clear: () => void (ids.clear(), (at = Date.now()), save()),
  }
}
