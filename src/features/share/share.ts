import { useSyncExternalStore } from 'react'

// Something shared into Murmur from another app: a link from the browser, a
// passage from a book, a note. The installed app is a share target
// (public/manifest.webmanifest), so Android's share sheet (and a desktop's
// Share menu, where there is one) opens /share?title=…&text=…&url=…. It's
// taken off the address at once, so a reload or Back never brings it twice,
// and kept for this tab until it's put in a chat or set aside, so signing in
// or setting up first doesn't lose it. Nothing is sent: it lands in a message
// box, for you to add to and send.

export type Shared = {
  /** What goes in the message box. */
  text: string
  /** The link in it, if there's one. */
  url?: string
  /** What the link is, when the app sharing it said ("Bread, the slow way"). */
  title?: string
}

/** The manifest's share_target action. */
const ACTION = '/share'
const KEY = 'murmur:shared'

/**
 * What a share says, as one message: the title over the text, with the link
 * after it unless the text has it already. Android puts a shared link in the
 * text (`url` stays empty) and the page's title in the title; some apps send
 * the link as the title too. Null for a share with nothing in it.
 */
export function readShare(params: URLSearchParams): Shared | null {
  const title = clean(params.get('title'))
  const text = clean(params.get('text'))
  const given = clean(params.get('url'))
  const url = linkIn(given) ?? linkIn(text)
  const body = [text, given && !text.includes(given) ? given : ''].filter(Boolean).join('\n')
  const said = !title || body.includes(title) || (url && title === url) ? body : [title, body].filter(Boolean).join('\n')
  if (!said) return null
  return { text: said, url, title: title && title !== url ? title : undefined }
}

const clean = (value: string | null) => (value ?? '').replace(/\r\n?/g, '\n').trim()
const linkIn = (text: string) => /\bhttps?:\/\/[^\s<>"]+[^\s<>"'.,;:!?)\]}]/i.exec(text)?.[0]

let shared: Shared | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function keep(next: Shared | null) {
  shared = next
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next))
    else sessionStorage.removeItem(KEY)
  } catch {
    // No storage (a private window): it's kept until the page reloads.
  }
  listeners.forEach((listener) => listener())
}

// Arriving with something shared: keep it (in place of anything shared before), and land on Home.
if (typeof location !== 'undefined') {
  if (location.pathname === ACTION) {
    keep(readShare(new URLSearchParams(location.search)))
    history.replaceState(history.state, '', '/')
  } else {
    try {
      shared = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    } catch {
      shared = null
    }
  }
}

/** What's been shared into Murmur and not yet put anywhere. */
export function useShared() {
  return useSyncExternalStore(subscribe, () => shared)
}

/** What's been shared, once: it's on its way to a message box, or set aside. Null if it's gone already. */
export function takeShare() {
  const taken = shared
  if (taken) keep(null)
  return taken
}
