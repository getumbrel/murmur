import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Put text on the clipboard. Murmur is often served over plain http (e.g.
 * umbrel.local), where `navigator.clipboard` doesn't exist; there it falls
 * back to the old select-and-copy trick. Resolves false if neither worked.
 */
export async function copyText(text: string) {
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
