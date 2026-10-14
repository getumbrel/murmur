import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { scoped } from '@/hermes/instance'

// What every message box shares: unsent text that survives a reload, and a
// field that grows with what's typed.

const PREFIX = scoped('murmur:draft:')

function readDraft(key?: string) {
  if (!key) return ''
  try {
    return localStorage.getItem(PREFIX + key) ?? ''
  } catch {
    return ''
  }
}

function writeDraft(key: string, text: string) {
  try {
    if (text) localStorage.setItem(PREFIX + key, text)
    else localStorage.removeItem(PREFIX + key)
  } catch {
    /* storage unavailable: drafts just don't persist */
  }
}

/** Unsent text, kept per key (a chat, a group) across reloads. `clear` forgets it at once. */
export function useDraft(key?: string) {
  const [text, setText] = useState(() => readDraft(key))
  const [shown, setShown] = useState(key)
  if (shown !== key) {
    setShown(key)
    setText(readDraft(key))
  }
  useEffect(() => {
    if (!key) return
    const t = window.setTimeout(() => writeDraft(key, text), 250)
    return () => window.clearTimeout(t)
  }, [key, text])
  const clear = useCallback(() => {
    setText('')
    if (key) writeDraft(key, '')
  }, [key])
  return [text, setText, clear] as const
}

const MAX_LINES = 8
const LINE = 24

/** Grow a textarea with its text, 1 → 8 lines, then scroll. */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, text: string) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    let tries = 0
    const fit = () => {
      // Not laid out yet (a screen still arriving): keep its natural one line,
      // and measure once it's there, rather than collapse it and grow a beat later.
      if (!el.getClientRects().length) {
        el.style.height = ''
        if (tries++ < 30) frame = requestAnimationFrame(fit)
        return
      }
      // (Measured at no height: no transition may catch that, not even reduced
      // motion's 1ms one, or the field shows collapsed for a frame.)
      el.style.setProperty('transition', 'none', 'important')
      el.style.height = '0px'
      const style = getComputedStyle(el)
      const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      const content = el.scrollHeight - pad
      const max = MAX_LINES * LINE
      el.style.height = `${pad + Math.min(content, max)}px`
      el.style.overflowY = content > max ? 'auto' : 'hidden'
    }
    fit()
    return () => cancelAnimationFrame(frame)
  }, [ref, text])
}
