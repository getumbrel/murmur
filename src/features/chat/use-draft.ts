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

/** Where an agent's next blank chat keeps what's typed into it. */
export const newChatDraft = (agentId: string) => `${agentId}:new`
/** Where a group keeps what's typed into it. */
export const groupDraft = (groupId: string) => `group:${groupId}`

// The boxes on screen now, by key, so text put in from elsewhere shows at once.
const showing = new Map<string, Set<(text: string) => void>>()

/** Puts `text` in a message box, a blank line under whatever's there already, and shows it if the box is on screen. */
export function addToDraft(key: string, text: string) {
  const before = readDraft(key).trimEnd()
  const next = before ? `${before}\n\n${text}` : text
  writeDraft(key, next)
  showing.get(key)?.forEach((show) => show(next))
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
    const boxes = showing.get(key) ?? new Set()
    showing.set(key, boxes.add(setText))
    return () => {
      boxes.delete(setText)
      if (!boxes.size) showing.delete(key)
    }
  }, [key])
  // Saved with every change (a write takes microseconds), so leaving the
  // moment you stop typing loses nothing.
  const change = useCallback(
    (next: string) => {
      setText(next)
      if (key) writeDraft(key, next)
    },
    [key],
  )
  const clear = useCallback(() => change(''), [change])
  return [text, change, clear] as const
}

// The passage a message answers (features/chat/quote.tsx) waits with the words typed under it.
const QUOTE = scoped('murmur:draft-quote:')

function readQuote(key?: string) {
  if (!key) return ''
  try {
    return localStorage.getItem(QUOTE + key) ?? ''
  } catch {
    return ''
  }
}

/** The passage being answered, kept per key like the text under it. One at a time: a new one takes its place. */
export function useDraftQuote(key?: string) {
  const [quote, setQuote] = useState(() => readQuote(key))
  const [shown, setShown] = useState(key)
  if (shown !== key) {
    setShown(key)
    setQuote(readQuote(key))
  }
  const change = useCallback(
    (next: string) => {
      setQuote(next)
      if (!key) return
      try {
        if (next) localStorage.setItem(QUOTE + key, next)
        else localStorage.removeItem(QUOTE + key)
      } catch {
        /* storage unavailable: it just doesn't outlast a reload */
      }
    },
    [key],
  )
  return [quote, change] as const
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
