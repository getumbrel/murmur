// Notifications on this device. Murmur's server notices what agents do and
// sends them (server/notifications.ts), so they arrive with every tab closed
// and the phone asleep. Here the device signs up: a browser subscribes to
// pushes, which public/sw.js shows; the desktop app asks the server to show
// them itself. Murmur asks once, in its own words (notify.tsx), before the
// browser does, and Settings can turn them off. The choice is this device's,
// for every Hermes.

import { create } from 'zustand'
import { desktop } from '@/lib/desktop'
import { ios, standalone } from '@/lib/device'

const KEY = 'murmur:notifications'
const DEVICE_KEY = 'murmur:notifications-device'
const DESKTOP = 'desktop'

/**
 * How this device gets notifications:
 *   push         a browser on a secure page, through its maker's push service
 *   desktop      the desktop app, which shows them itself
 *   home-screen  Safari on an iPhone or iPad: only once Murmur is on the Home Screen
 *   none         a page on plain http, or a browser without push
 */
export type Support = 'push' | 'desktop' | 'home-screen' | 'none'

export const support: Support = (() => {
  if (typeof window === 'undefined') return 'none'
  if (desktop) return 'desktop'
  if (!window.isSecureContext) return 'none'
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'push'
  return ios && !standalone() ? 'home-screen' : 'none'
})()

type Choice = 'on' | 'off'
type Permission = NotificationPermission | 'unsupported'

/**
 * Why turning them on didn't work, when it wasn't the permission: the
 * browser's push service is switched off (Brave, until it's allowed to use
 * Google's), or Murmur's server couldn't be reached.
 */
export type Problem = 'no-push' | 'unreachable'

const permissionNow = (): Permission =>
  (support === 'push' || support === 'desktop') && 'Notification' in window ? Notification.permission : 'unsupported'

function read(key: string) {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function write(key: string, value: string | undefined) {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private mode: it lasts the visit.
  }
}

const savedChoice = read(KEY)

export const useNotifications = create<{ choice?: Choice; permission: Permission; device?: string; problem?: Problem }>(() => ({
  choice: savedChoice === 'on' || savedChoice === 'off' ? savedChoice : undefined,
  permission: permissionNow(),
  device: read(DEVICE_KEY),
}))

function saveChoice(choice: Choice) {
  write(KEY, choice)
  useNotifications.setState({ choice })
}

function saveDevice(device: string | undefined) {
  write(DEVICE_KEY, device)
  useNotifications.setState({ device })
}

/**
 * Notifications go out: allowed by the system, and turned on here. Where the
 * system allows them without being asked (the desktop app), they're on until
 * turned off.
 */
export function isOn({ choice, permission } = useNotifications.getState()) {
  return permission === 'granted' && (choice === 'on' || (support === 'desktop' && choice !== 'off'))
}

/** Whether to offer them: never chosen, and the browser would still ask. */
export function shouldOffer({ choice, permission } = useNotifications.getState()) {
  return support === 'push' && choice === undefined && permission === 'default'
}

// ── Murmur's server ─────────────────────────────────────────────────────────

class Unreachable extends Error {}

async function server<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Unreachable()
  }
  if (!res.ok) throw new Unreachable(`Murmur answered ${res.status}`)
  return (await res.json()) as T
}

// ── Pushes ──────────────────────────────────────────────────────────────────

let registering: Promise<ServiceWorkerRegistration> | undefined

/** The service worker that shows pushes (public/sw.js), registered once and ready. */
const worker = () =>
  (registering ??= navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
    .then(() => navigator.serviceWorker.ready))

const keyBytes = (key: string) => Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

/** Whether a subscription was made for this key: one made for an earlier key (Murmur's data was reset) is no use. */
function madeFor(subscription: PushSubscription, key: string) {
  const made = subscription.options.applicationServerKey
  if (!made) return false
  const [a, b] = [new Uint8Array(made), keyBytes(key)]
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

/** Subscribe this browser and tell Murmur's server about it. Throws Unreachable, or a push error. */
async function signUp() {
  if (support === 'desktop') return saveDevice((await server<{ device: string }>('POST', '/murmur/notifications/devices', { native: true })).device)
  const registration = await worker()
  const { key } = await server<{ key: string }>('GET', '/murmur/notifications')
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !madeFor(subscription, key)) {
    await subscription.unsubscribe().catch(() => {})
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  const { device } = await server<{ device: string }>('POST', '/murmur/notifications/devices', { subscription: subscription.toJSON() })
  saveDevice(device)
}

async function signOff() {
  const { device } = useNotifications.getState()
  saveDevice(undefined)
  if (device) await server('DELETE', `/murmur/notifications/devices/${encodeURIComponent(device)}`).catch(() => {})
  if (support !== 'push') return
  const subscription = await (await worker()).pushManager.getSubscription().catch(() => null)
  await subscription?.unsubscribe().catch(() => {})
}

// ── Turning them on and off ─────────────────────────────────────────────────

/** Turn them on (asking the system, when it hasn't been) or off. Resolves whether they're on. */
export async function setNotifications(on: boolean) {
  if (!on) {
    saveChoice('off')
    await signOff()
    return false
  }
  if (support !== 'push' && support !== 'desktop') return false
  useNotifications.setState({ problem: undefined })
  let permission = Notification.permission
  // Asked first, while the tap still counts: Safari won't ask after anything else is awaited.
  if (permission === 'default') permission = await Notification.requestPermission().catch(() => Notification.permission)
  useNotifications.setState({ permission })
  if (permission !== 'granted') {
    // Blocked: remembered as off, so Murmur doesn't offer again.
    saveChoice('off')
    return false
  }
  try {
    await signUp()
  } catch (error) {
    useNotifications.setState({ problem: error instanceof Unreachable ? 'unreachable' : 'no-push' })
    return false
  }
  saveChoice('on')
  return true
}

let synced = false

/**
 * On load: get ready, and make sure Murmur's server still knows this device
 * (its data may have been reset, or a push service said the subscription had
 * gone). Follows the permission when it's changed in the browser's settings.
 */
export async function syncNotifications() {
  if (synced || (support !== 'push' && support !== 'desktop')) return
  synced = true
  watchChanges()
  // Ready before a tap needs it, so turning them on asks at once.
  if (support === 'push') void worker().catch(() => {})
  if (!isOn()) return
  const { device } = useNotifications.getState()
  try {
    const status = await server<{ key: string; known: boolean }>('GET', `/murmur/notifications?device=${encodeURIComponent(device ?? '')}`)
    const subscription = support === 'push' ? await (await worker()).pushManager.getSubscription() : null
    const current = support === 'desktop' ? device === DESKTOP : subscription && madeFor(subscription, status.key)
    if (!status.known || !current) await signUp()
  } catch {
    // Murmur or the push service is away: the next load tries again.
  }
}

let watching = false

/** Follows what changes outside the app: the permission, in the browser's settings, and the subscription, renewed by the worker. */
function watchChanges() {
  if (watching || support !== 'push') return
  watching = true
  navigator.serviceWorker.addEventListener('message', (event) => {
    const { type, device } = (event.data ?? {}) as { type?: unknown; device?: unknown }
    if (type === 'murmur:device' && typeof device === 'string' && isOn()) saveDevice(device)
  })
  const sync = () => {
    const permission = permissionNow()
    if (permission === useNotifications.getState().permission) return
    useNotifications.setState({ permission })
    if (isOn()) {
      synced = false
      void syncNotifications()
    }
  }
  document.addEventListener('visibilitychange', sync)
  navigator.permissions
    ?.query({ name: 'notifications' })
    .then((status) => status.addEventListener('change', sync))
    .catch(() => {})
}
