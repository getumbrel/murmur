// System notifications for agents that finish or need you while you're
// elsewhere, through the web's own Notification API: the desktop app hands
// them to the OS, and so do desktop browsers on localhost or HTTPS. Murmur
// asks once, in its own words (prompt.tsx), before the browser ever does, and
// Settings can turn them off. The choice is this device's, for every Hermes.

import { create } from 'zustand'
import { focusWindow } from '@/lib/desktop'
import type { Note } from './compose'

const KEY = 'murmur:notifications'

type Choice = 'on' | 'off'
type Permission = NotificationPermission | 'unsupported'

/**
 * Secure pages with the API, on computers. Phones' browsers either lack it or
 * only show notifications through a service worker, which Murmur doesn't have.
 */
export function notificationsSupported() {
  if (typeof window === 'undefined' || !window.isSecureContext || !('Notification' in window)) return false
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

const permissionNow = (): Permission => (notificationsSupported() ? Notification.permission : 'unsupported')

function readChoice(): Choice | undefined {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'on' || value === 'off' ? value : undefined
  } catch {
    return undefined
  }
}

function saveChoice(choice: Choice) {
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    // Private mode: the choice lasts the visit.
  }
  useNotifications.setState({ choice })
}

export const useNotifications = create<{ choice?: Choice; permission: Permission }>(() => ({
  choice: readChoice(),
  permission: permissionNow(),
}))

/**
 * Notifications go out: allowed by the system, and turned on here. Where the
 * system already allows them without being asked (the desktop app), they're on
 * until turned off.
 */
export function isOn({ choice, permission } = useNotifications.getState()) {
  return permission === 'granted' && choice !== 'off'
}

/** Whether to offer them: never chosen, and the browser would still ask. */
export function shouldOffer({ choice, permission } = useNotifications.getState()) {
  return choice === undefined && permission === 'default'
}

/** Turn them on (asking the system, when it hasn't been) or off. Resolves whether they're on. */
export async function setNotifications(on: boolean) {
  if (!on) {
    saveChoice('off')
    return false
  }
  if (!notificationsSupported()) return false
  let permission = Notification.permission
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission()
    } catch {
      permission = Notification.permission
    }
  }
  useNotifications.setState({ permission })
  // Blocked: remembered as off, so Murmur doesn't offer again.
  saveChoice(permission === 'granted' ? 'on' : 'off')
  return permission === 'granted'
}

let watching = false

/** Follow the permission when it's changed in the browser's or system's settings. */
export function watchPermission() {
  if (watching || !notificationsSupported()) return
  watching = true
  const sync = () => {
    const permission = permissionNow()
    if (permission !== useNotifications.getState().permission) useNotifications.setState({ permission })
  }
  document.addEventListener('visibilitychange', sync)
  navigator.permissions
    ?.query({ name: 'notifications' })
    .then((status) => status.addEventListener('change', sync))
    .catch(() => {})
}

/** Shows a note, if notifications are on. Clicking it brings Murmur forward and opens `href`. */
export function showNote(note: Note, open: (href: string) => void) {
  if (!isOn()) return
  try {
    const n = new Notification(note.title, { body: note.body, tag: note.tag, icon: '/icon-192.png' })
    n.onclick = () => {
      focusWindow()
      open(note.href)
      n.close()
    }
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}
