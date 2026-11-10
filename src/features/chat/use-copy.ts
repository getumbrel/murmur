import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Put text on the clipboard. Murmur is often served over plain http (e.g.
 * umbrel.local), where `navigator.clipboard` doesn't exist; there it falls
 * back to the old select-and-copy trick. Resolves false if neither worked.
 * The text can be a promise of it, for text that takes a moment to get.
 */
export async function copyText(text: string | Promise<string>) {
  if (typeof text !== 'string') {
    // Text that's still on its way: the browser is promised it now, while the tap that asked still counts.
    if (window.isSecureContext && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      try {
        const blob = text.then((t) => new Blob([t], { type: 'text/plain' }))
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
        return true
      } catch {
        /* fall through */
      }
    }
    try {
      text = await text
    } catch {
      return false
    }
  }
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* fall through */
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  // Off-screen, and 16px so iOS doesn't zoom toward it.
  area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px'
  const focused = document.activeElement as HTMLElement | null
  document.body.appendChild(area)
  area.select()
  area.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  focused?.focus?.({ preventScroll: true })
  return ok
}

/** Copy text to the clipboard; `copied` stays true briefly for feedback. */
export function useCopy(timeout = 1600) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = useCallback(
    async (text: string) => {
      if (!(await copyText(text))) return false
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), timeout)
      return true
    },
    [timeout],
  )

  return { copied, copy }
}
