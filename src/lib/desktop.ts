// Murmur's desktop app (Electron, desktop/) runs this same web app in a window
// and lends it a few native things through its preload: the platform, the
// app's version, the dock or taskbar badge, bringing the window forward, and
// the notifications it shows (clicking one opens what it's about).
// Before the first paint the preload also sets <html data-desktop="mac|win|linux">,
// which the titlebar styles in styles.css key off. In a browser none of it exists.

export type DesktopPlatform = 'darwin' | 'win32' | 'linux'

export type MurmurDesktop = Readonly<{
  platform: DesktopPlatform
  /** The desktop app's version. */
  version: string
  /** The dock or taskbar badge; 0 clears it. */
  setBadge(count: number): void
  /** Brings the window forward, e.g. when a notification is clicked. */
  focus(): void
  /** Matches the window chrome to Murmur's own theme. Missing in older desktop builds. */
  setTheme?(mode: 'system' | 'light' | 'dark'): void
  /** Called with a clicked notification's {href, hermes}. Returns the stop. */
  onOpen?(fn: (note: { href: string; hermes: string }) => void): () => void
}>

declare global {
  interface Window {
    murmurDesktop?: MurmurDesktop
  }
}

/** The desktop app's bridge, or undefined in a browser. */
export const desktop: MurmurDesktop | undefined = typeof window === 'undefined' ? undefined : window.murmurDesktop

export const isDesktop = !!desktop

/** Which window chrome the page sits in: the titlebar it has to make room for. */
export type DesktopChrome = 'mac' | 'win' | 'linux'

export function desktopChrome(): DesktopChrome | undefined {
  if (typeof document === 'undefined') return undefined
  const value = document.documentElement.dataset.desktop
  return value === 'mac' || value === 'win' || value === 'linux' ? value : undefined
}

export const isMacDesktop = desktop?.platform === 'darwin'

/** The unread count on the dock or taskbar icon. A no-op in a browser. */
export function setDesktopBadge(count: number) {
  try {
    desktop?.setBadge(Math.max(0, Math.floor(count) || 0))
  } catch {
    // An older desktop build without it: the badge just stays as it was.
  }
}

/** Brings Murmur forward: the desktop window, or this tab as far as a browser lets a page. */
export function focusWindow() {
  if (desktop) desktop.focus()
  else window.focus()
}
