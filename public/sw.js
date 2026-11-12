// Murmur's service worker. It does two things.
//
// It keeps the app itself (the page and everything it's built from) on the
// device, so Murmur opens when its server can't be reached: on a train, away
// from home, or while the server restarts. Nothing of anyone's is kept here,
// only the app; what it shows then is what the page kept (src/state/kept.ts).
// A page is always asked of the server first, since it's the server that
// signs people in and says which Hermes a browser uses; the kept one stands
// in only when no answer comes.
//
// And it shows notifications. Murmur's server sends each note as a push
// (server/notifications.ts), shown here, so a tap opens it in the Murmur
// window already open (a notification Safari shows by itself would load its
// link afresh). Every push is shown: browsers stop delivering to a worker
// that receives pushes and shows nothing.

// ── The app, kept ───────────────────────────────────────────────────────────

/**
 * What this build of the app is made of, written in by the build
 * (vite.config.ts): `{ version, files }`. Null in development, where nothing
 * is kept and no request is touched.
 */
const SHELL = null

const KEPT = 'murmur-app-'
const PAGE = '/index.html'
const cacheName = SHELL && KEPT + SHELL.version
const files = new Set(SHELL?.files)
/** How long a page waits on the server before the kept one opens instead. */
const PATIENCE = 3000

/**
 * Keeps this build, every file of it and then the page: the page goes in last,
 * so a page that's kept always has all it needs. Whatever stops it (the
 * connection dropping, a sign-in page answering in a file's place) leaves it
 * to be finished the next time the app opens.
 */
let keeping

function keep() {
  return (keeping ??= SHELL ? keepBuild().finally(() => (keeping = undefined)) : Promise.resolve())
}

async function keepBuild() {
  const cache = await caches.open(cacheName)
  if (await cache.match(PAGE)) return
  const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname))
  const missing = SHELL.files.filter((f) => !have.has(f))
  // A few at a time: a phone on a slow connection shouldn't be asked for 150 files at once.
  for (let i = 0; i < missing.length; i += 6) {
    await Promise.all(
      missing.slice(i, i + 6).map(async (file) => {
        const res = await fetch(file, { cache: 'no-cache' })
        if (!theApps(res)) throw new Error(`${file} answered ${res.status}`)
        await cache.put(file, res)
      }),
    )
  }
  const page = await fetch(PAGE, { cache: 'no-store' })
  if (!theApps(page) || !/text\/html/.test(page.headers.get('content-type') ?? '')) throw new Error('No page to keep')
  await cache.put(PAGE, page)
  // Earlier builds go once this one is whole.
  for (const name of await caches.keys()) if (name.startsWith(KEPT) && name !== cacheName) await caches.delete(name)
}

/** Murmur's own answer, not a sign-in page it was sent to (umbrelOS's, say) or an error. */
const theApps = (res) => res.ok && !res.redirected && res.type === 'basic'

/** The newest build kept whole: this one, or the one before while this one is still coming in. */
async function keptPage() {
  const names = (await caches.keys()).filter((n) => n.startsWith(KEPT))
  for (const name of [cacheName, ...names.filter((n) => n !== cacheName).reverse()]) {
    const page = await (await caches.open(name)).match(PAGE)
    if (page) return page
  }
}

/**
 * A page from the server, or the kept one when the server doesn't answer in
 * time (or something in front of it says it's away). The kept one is marked,
 * so the app knows from its first moment that it's on its own (src/state/reach.ts).
 */
async function page(event) {
  const asked = fetch(event.request)
  asked.catch(() => {})
  const kept = await keptPage()
  let res
  if (kept) {
    try {
      res = await Promise.race([asked, new Promise((_, late) => setTimeout(late, PATIENCE))])
    } catch {
      // No answer: the kept page it is.
    }
  }
  if (!kept || (res && ![502, 503, 504].includes(res.status))) return res ?? asked
  const headers = new Headers(kept.headers)
  headers.set('server-timing', 'murmur-kept')
  return new Response(kept.body, { status: 200, headers })
}

/** One of the app's files: the kept copy, or the server's where there's none. */
async function file(request) {
  return (await caches.match(request, { ignoreVary: true, ignoreSearch: true })) ?? fetch(request)
}

self.addEventListener('fetch', (event) => {
  if (!SHELL) return
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Hermes and Murmur's server are never answered from here: only the app is kept.
  if (/^\/(hermes|murmur)(\/|$)/.test(url.pathname)) return
  if (request.mode === 'navigate') {
    // A screen of the app (they're all one page), not a file opened on its own.
    if (!/\.[a-z0-9]+$/i.test(url.pathname)) event.respondWith(page(event))
    return
  }
  if (files.has(url.pathname)) event.respondWith(file(request))
})

// The page asks once it's up (src/lib/keep-app.ts), so keeping the app never
// holds a new worker back from its notifications.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'murmur:keep') event.waitUntil(keep().catch(() => {}))
})

// ── Notifications ───────────────────────────────────────────────────────────

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let note = {}
  try {
    note = event.data?.json().notification ?? {}
  } catch {
    // Not one of Murmur's: still shown, as Murmur.
  }
  event.waitUntil(show(note).then(() => catchUp(note.data?.id)))
})

/**
 * Shows a note, and remembers that it did. One shown here before (a catch-up
 * brought it ahead of its own push) only replaces itself, quietly; a catch-up
 * shows only what's new here, without buzzing again, but for a question,
 * which needs the person.
 */
async function show({ title = 'Murmur', navigate, data, ...options }, catchingUp = false) {
  const again = Boolean(data?.id) && (await shown.has(data.id))
  if (again && catchingUp) return
  const quiet = (again || (catchingUp && !data?.ask)) && { renotify: false, silent: true }
  await self.registration.showNotification(title, { ...options, ...quiet, data: { ...data, navigate } })
  if (data?.id) await shown.add(data.id)
}

/**
 * Chrome on Android keeps one push waiting at a time and drops any that land
 * meanwhile (while the phone dozes, coming back online), so whichever gets
 * through asks Murmur for the rest this device was sent and hasn't shown.
 */
async function catchUp(id) {
  try {
    const subscription = await self.registration.pushManager.getSubscription()
    if (!subscription) return
    const res = await fetch('/murmur/notifications/shown', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint, id }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return
    const { missed = [] } = await res.json()
    for (const note of missed) await show(note, true)
  } catch {
    // Murmur's out of reach (away from home, say): what this push brought is all there is.
  }
}

/** The notes shown here in the last day (as long as Murmur keeps them for a catch-up), by id. */
const shown = {
  DAY: 24 * 60 * 60 * 1000,
  /** When older ones were last let go: an hour apart is plenty, and it reads every one. */
  pruned: 0,
  async has(id) {
    try {
      return Boolean(await (await caches.open('murmur-shown')).match(`/shown/${id}`))
    } catch {
      return false
    }
  },
  async add(id) {
    try {
      const cache = await caches.open('murmur-shown')
      await cache.put(`/shown/${id}`, new Response(String(Date.now())))
      if (Date.now() - this.pruned < 60 * 60 * 1000) return
      this.pruned = Date.now()
      for (const key of await cache.keys()) {
        const at = Number(await (await cache.match(key))?.text())
        if (!(at > Date.now() - this.DAY)) await cache.delete(key)
      }
    } catch {
      // No storage here (a private window): a catch-up may show a note twice.
    }
  },
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(open(event.notification.data ?? {}))
})

/** Opens what a note is about: in a Murmur window already open (which knows its Hermes), or a new one at the note's link. */
async function open({ href, hermes, navigate }) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const client = windows.find((w) => w.focused) ?? windows.find((w) => w.visibilityState === 'visible') ?? windows[0]
  if (client && href) {
    client.postMessage({ type: 'murmur:open', href, hermes })
    return client.focus()
  }
  return self.clients.openWindow(navigate ?? href ?? '/')
}

// The push service replaced this browser's subscription: hand Murmur the new
// one in place of the old, and tell open pages which device they are now.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      let subscription = event.newSubscription
      if (!subscription) {
        const { key } = await (await fetch('/murmur/notifications', { cache: 'no-store' })).json()
        const applicationServerKey = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
        subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
      }
      const res = await fetch('/murmur/notifications/devices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON(), previous: event.oldSubscription?.endpoint }),
      })
      const { device } = await res.json()
      for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
        client.postMessage({ type: 'murmur:device', device })
      }
    })(),
  )
})
