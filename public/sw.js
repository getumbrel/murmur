// Murmur's service worker, for notifications only. It never touches a
// request (there's no fetch handler), so the app loads just as it would
// without it.
//
// Murmur's server sends each note as a push (server/notifications.ts), shown
// here, so a tap opens it in the Murmur window already open (a notification
// Safari shows by itself would load its link afresh). Every push is shown:
// browsers stop delivering to a worker that receives pushes and shows nothing.

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
