// Keeping where an agent left its browser (state/browser-frames.ts): the
// page as the chat's card shows it, kept as the reply goes, so a tab closed
// partway still leaves a picture, and once more when the reply ends, which is
// the one that stays. Only ever a picture the agent's own work drew: the card
// hands over nothing until its browser has drawn (drawn.ts), Hermes sends
// none while a person has the browser, and a screen with nothing on it yet
// isn't a page.

import { useEffect, useRef } from 'react'
import { keepFrame, pagePicture } from '@/state/browser-frames'
import { stillNow } from '@/state/screen'
import { blank, glance } from './drawn'

type Size = { w: number; h: number }

/** How often a reply's picture is kept while it browses. */
const EVERY = 8000

/** The latest still each live card has shown, for the one last look when its reply ends. */
const shown = new Map<string, { still: string; size: Size }>()

async function keep(chat: string, frame: string, still: string, size: Size) {
  if (blank(await glance(still, size))) return false
  const picture = await pagePicture(still, size)
  if (!picture) return false
  await keepFrame(chat, frame, picture)
  return true
}

/**
 * While a reply browses: keeps the page its card is showing, every so often.
 * `still` is the card's picture once it can be shown, null until then and
 * while a person has the browser.
 */
export function useKeeping(chat: string | undefined, frame: string | undefined, still: string | null, size: Size) {
  const kept = useRef(0)
  const { w, h } = size
  useEffect(() => {
    if (!chat || !frame || !still) return
    shown.set(`${chat}/${frame}`, { still, size: { w, h } })
    if (Date.now() - kept.current < EVERY) return
    kept.current = Date.now()
    void keep(chat, frame, still, { w, h }).catch(() => {})
  }, [chat, frame, still, w, h])
}

/**
 * The reply has ended: keeps where its browser is now, with one last look at
 * it, or failing that the last page its card showed.
 */
export async function keepLast(chat: string, frame: string, profile: string, size: Size) {
  const key = `${chat}/${frame}`
  const last = shown.get(key)
  shown.delete(key)
  try {
    const now = await stillNow(profile)
    if (now && (await keep(chat, frame, now, size))) return
    if (last) await keep(chat, frame, last.still, last.size)
  } catch {
    // The picture kept as it went stays.
  }
}
