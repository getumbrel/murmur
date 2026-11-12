// Murmur opens whether or not its server can be reached. Its service worker
// (public/sw.js) keeps the app itself on the device and hands it over when the
// server doesn't answer; this is the page's side of that.
//
// Browsers only run a service worker on a secure page (HTTPS, or localhost),
// so over plain http none of this happens and nothing changes. The desktop
// app carries its own server, which is always there.

import { isDesktop } from '@/lib/desktop'

let registering: Promise<ServiceWorkerRegistration> | undefined

/** Murmur's service worker, registered once and ready. Rejects where there can't be one. */
export function worker(): Promise<ServiceWorkerRegistration> {
  return (registering ??= navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
    .then(() => navigator.serviceWorker.ready))
}

/** Have the app kept on this device, from the first visit on, and finished if it was ever cut short. Call once. */
export function keepApp() {
  if (!import.meta.env.PROD || isDesktop || !window.isSecureContext || !('serviceWorker' in navigator)) return
  // After the app has what it needs for its first screen: the files come from the browser's own cache where it has them.
  const ask = () =>
    void worker()
      .then((registration) => registration.active?.postMessage({ type: 'murmur:keep' }))
      .catch(() => {})
  if (document.readyState === 'complete') setTimeout(ask, 2000)
  else window.addEventListener('load', () => setTimeout(ask, 2000), { once: true })
}

/**
 * Whether this page is the kept one, opened because the server didn't answer
 * (the worker marks it so). Known from the first moment, so the app never
 * waits on a server that isn't there.
 */
export const openedKept: boolean = (() => {
  try {
    const [page] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
    return !!page?.serverTiming?.some((t) => t.name === 'murmur-kept')
  } catch {
    return false
  }
})()
