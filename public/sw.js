// Murmur's service worker, for notifications only. It never touches a
// request (there's no fetch handler), so the app loads just as it would
// without it.
//
// Murmur's server sends each note as a push (server/notifications.ts), in
// the declarative form Safari 18.4 and later shows by itself; other browsers
// hand it here to show. Every push is shown: browsers stop delivering to a
// worker that receives pushes and shows nothing.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let note = {}
  try {
    note = event.data?.json().notification ?? {}
  } catch {
    // Not one of Murmur's: still shown, as Murmur.
  }
  const { title = 'Murmur', navigate, data, ...options } = note
  event.waitUntil(self.registration.showNotification(title, { ...options, data: { ...data, navigate } }))
})

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
