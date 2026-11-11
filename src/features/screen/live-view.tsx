import './screen.css'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import RFB from '@novnc/novnc'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'
import { useFinePointer } from '@/lib/use-media'
import { CHROME, PAGE, handBack, sizeOf, takeOver, useControl, useScreen, watch } from '@/state/screen'

type Size = { w: number; h: number }

/** Chromium won't make a window narrower than this. */
const NARROWEST = 500
/** Shaved off the browser's top and bottom too: scaled down, the desktop's bars bleed into its first row. */
const EDGE = 1
/** The ring a live view wears while you're in control: the agent's colour. */
const RING = 'shadow-[0_0_0_2px_var(--accent),0_0_0_7px_var(--accent-soft)]'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A still of the agent's browser: the screen's latest picture, cropped to the browser, or to just its page. */
export function Still({
  src,
  size,
  page,
  dim,
  shape,
  className,
}: {
  src: string | null
  size: Size
  page?: boolean
  dim?: boolean
  /** The shape to hold instead of the screen's own: a picture kept from a screen of another size. */
  shape?: Size
  className?: string
}) {
  const crop = page ? PAGE : CHROME
  return (
    <div
      className={cn('relative overflow-hidden bg-sunken', className)}
      style={{ aspectRatio: shape ? `${shape.w} / ${shape.h}` : `${size.w} / ${size.h - crop.top - crop.bottom}` }}
    >
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          className={cn(
            'block w-full select-none transition-[filter,opacity] duration-500',
            dim && 'opacity-60 blur-[2px] saturate-50',
          )}
          style={{ marginTop: `${(-crop.top / size.w) * 100}%` }}
        />
      )}
    </div>
  )
}

/** The live view in control of each agent's screen in this window, and the size the agent had it. */
const holding = new Map<string, { rfb: RFB; size: Size }>()

const shapedLike = (rfb: RFB, size: Size) => rfb._fbWidth === size.w && rfb._fbHeight === size.h
const reshape = (rfb: RFB, size: Size) =>
  RFB.messages.setDesktopSize(rfb._sock, size.w, size.h, rfb._screenID, rfb._screenFlags)

/**
 * Hands the agent its browser back, the way it had it: a phone in control
 * reshapes the screen to its own, and only the viewer in control may put it
 * back, so that comes first.
 */
export async function giveBack(profile: string) {
  const held = holding.get(profile)
  if (held && !shapedLike(held.rfb, held.size)) {
    reshape(held.rfb, held.size)
    for (let i = 0; i < 30 && !shapedLike(held.rfb, held.size); i++) await sleep(50)
  }
  await handBack(profile)
}

/** The screen a phone in control gets: its own shape, as narrow as a browser window goes. */
function phoneShape(box: Size): Size {
  const w = Math.max(NARROWEST, Math.round(box.w))
  return { w, h: Math.round((box.h * w) / box.w) + CHROME.top + CHROME.bottom }
}

const KEYS: Record<string, number> = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
}
const CONTROL = 0xffe3
const V = 0x76

/** The most Hermes takes onto the screen's clipboard at once is 256 KiB; a little is kept for the message around it. */
const MOST_PASTED = 255 * 1024

/**
 * Pastes into the page the way you would at the screen: the text goes onto its
 * clipboard, then Ctrl+V in the agent's browser. The page gets a real paste,
 * so a code split across boxes fills them all. Hermes takes it only from
 * whoever has control and never sends it on, and the screen asks this window
 * for it each time something pastes, which Hermes lets through only while
 * it's still yours: once you hand back, the agent can't paste it again.
 */
function pasteInto(rfb: RFB, text: string) {
  rfb.clipboardPasteFrom(text)
  rfb.sendKey(CONTROL, 'ControlLeft', true)
  rfb.sendKey(V, 'KeyV', true)
  rfb.sendKey(V, 'KeyV', false)
  rfb.sendKey(CONTROL, 'ControlLeft', false)
}

/** A character's X keysym: Latin-1 as itself, the rest of Unicode as 0x1000000 plus its code point. */
const keysymOf = (ch: string) => {
  const cp = ch.codePointAt(0) ?? 0
  return ch === '\n' ? KEYS.Enter : cp < 0x100 ? cp : 0x1000000 + cp
}

export type LiveViewHandle = {
  /** Shows or hides the phone's keyboard, typing into the page. */
  keyboard: () => void
  /** Pastes into the page, while you're in control. */
  paste: (text: string) => void
}

/**
 * The agent's browser, live: Hermes's Bot Screen over RFB through Murmur's
 * own /hermes proxy, cropped to the browser between the desktop's bars. It
 * takes your pointer and keys only while you're in control (Hermes lets them
 * through only then, too). With `fit` (a phone), control reshapes the screen
 * to yours, so the page lays out for a phone at its real size rather than a
 * desktop shrunk to a quarter. In control, ⌘V or Ctrl+V pastes what you copied
 * into the page. Dropped, it reconnects by itself, and keeps control if you
 * had it.
 */
export const LiveView = forwardRef<
  LiveViewHandle,
  {
    profile: string
    fit?: boolean
    /** Shown until the live picture arrives. */
    still?: string | null
    /** Shown while the screen is off. */
    off?: ReactNode
    onTyping?: (typing: boolean) => void
    className?: string
  }
>(function LiveView({ profile, fit, still, off, onTyping, className }, ref) {
  const screen = useScreen(profile)
  const yours = useControl(profile) === 'you'
  const fine = useFinePointer()
  const running = !!screen?.running
  const agentSize = sizeOf(screen)
  const frame = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const typing = useRef<HTMLInputElement>(null)
  const [box, setBox] = useState<Size>({ w: 0, h: 0 })
  const [rfb, setRfb] = useState<RFB | null>(null)
  const [fb, setFb] = useState<Size | null>(null)
  const yoursNow = useRef(yours)
  yoursNow.current = yours

  useLayoutEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // One connection while the screen is on, made again whenever it drops.
  useEffect(() => {
    if (!running) return
    let alive = true
    let current: RFB | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    const again = () => {
      if (alive) timer = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt++))
    }
    const connect = async () => {
      let url: string
      try {
        url = await watch(profile)
      } catch {
        return again()
      }
      if (!alive || !stage.current) return
      const r = new RFB(stage.current, url, { shared: true })
      current = r
      r.scaleViewport = true
      r.resizeSession = false
      r.viewOnly = true
      r.background = 'transparent'
      r.qualityLevel = 7
      r.compressionLevel = 2
      r.showDotCursor = false
      // noVNC sizes the picture from its box as drawn, which the viewer's opening zoom
      // shrinks for a moment, and keeps that size; the box as laid out is the real one.
      const laid = getComputedStyle(r._screen)
      r._screenSize = () => ({ w: parseFloat(laid.width), h: parseFloat(laid.height) })
      const resize = r._resize.bind(r)
      r._resize = (w, h) => {
        resize(w, h)
        if (alive) setFb({ w, h })
      }
      r.addEventListener('connect', () => {
        attempt = 0
        setFb({ w: r._fbWidth, h: r._fbHeight })
        setRfb(r)
        // Back after a drop (a phone put away to fetch a code): control is still yours, on this connection now.
        if (yoursNow.current) void takeOver(profile).catch(() => {})
      })
      r.addEventListener('disconnect', () => {
        if (current !== r) return
        current = undefined
        setRfb(null)
        again()
      })
    }
    void connect()
    return () => {
      alive = false
      clearTimeout(timer)
      const r = current
      current = undefined
      r?.disconnect()
      setRfb(null)
      setFb(null)
    }
  }, [profile, running])

  // Your pointer and keys reach the page only while you're in control.
  useEffect(() => {
    if (!rfb) return
    rfb.viewOnly = !yours
    rfb.focusOnClick = fine
    if (!yours) return
    holding.set(profile, { rfb, size: agentSize })
    if (fine) rfb.focus({ preventScroll: true })
    return () => {
      if (holding.get(profile)?.rfb === rfb) holding.delete(profile)
    }
  }, [rfb, yours, fine, profile, agentSize.w, agentSize.h])

  // In control, the screen takes the shape it's seen in: a phone's, or the agent's own.
  const want = fit ? phoneShape(box) : agentSize
  useEffect(() => {
    if (!rfb || !yours || !box.w || shapedLike(rfb, want)) return
    const t = setTimeout(() => reshape(rfb, want), 120)
    return () => clearTimeout(t)
  }, [rfb, yours, box.w, want.w, want.h])

  // What you copied, into the page.
  const paste = (text: string) => {
    if (!rfb || !yours || !text) return
    if (new TextEncoder().encode(text).length > MOST_PASTED) {
      toast.error('That’s too long to paste into the page.')
      return
    }
    pasteInto(rfb, text)
  }
  const pasteNow = useRef(paste)
  pasteNow.current = paste
  useEffect(() => {
    const host = frame.current
    const field = typing.current
    if (!rfb || !yours || !host || !field) return
    // noVNC sends ⌘V or Ctrl+V on as keys, and so stops the browser's own paste: the field
    // nobody sees takes the paste instead, and noVNC lets go of the keys it's holding down there.
    let catching = false
    const back = () => {
      if (!catching) return
      catching = false
      rfb.focus({ preventScroll: true })
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target === field || e.key.toLowerCase() !== 'v' || !(e.metaKey || e.ctrlKey) || e.altKey) return
      e.stopPropagation()
      rfb._keyboard._allKeysUp()
      catching = true
      field.focus({ preventScroll: true })
      // Nothing to paste (a picture, or nothing copied): the keys go back to the page.
      setTimeout(back, 100)
    }
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault()
      pasteNow.current(e.clipboardData?.getData('text/plain') ?? '')
      back()
    }
    host.addEventListener('keydown', onKeyDown, true)
    host.addEventListener('paste', onPaste)
    return () => {
      host.removeEventListener('keydown', onKeyDown, true)
      host.removeEventListener('paste', onPaste)
    }
  }, [rfb, yours])

  // The phone's keyboard types into the page through a field nobody sees.
  useImperativeHandle(ref, () => ({
    keyboard: () => {
      const el = typing.current
      if (!el) return
      if (document.activeElement === el) el.blur()
      else el.focus({ preventScroll: true })
    },
    paste,
  }))
  useEffect(() => {
    const el = typing.current
    if (!el || !rfb) return
    const press = (keysym: number) => {
      rfb.sendKey(keysym, null, true)
      rfb.sendKey(keysym, null, false)
    }
    // What's in the field is what's been typed since it was last empty: a change to it is the keys
    // that made it, which also covers autocorrect, dictation and a code the keyboard offers.
    let sent = ''
    const onInput = () => {
      const now = el.value
      let same = 0
      while (same < sent.length && same < now.length && sent[same] === now[same]) same++
      for (let n = sent.length - same; n > 0; n--) press(KEYS.Backspace)
      for (const ch of now.slice(same)) press(keysymOf(ch))
      sent = now
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      // Keys that change nothing in an empty field, or nothing at all.
      if (e.key === 'Backspace' && el.value) return
      const keysym = KEYS[e.key]
      if (!keysym) return
      e.preventDefault()
      press(keysym)
      if (e.key === 'Enter') el.value = sent = ''
    }
    const onFocus = () => onTyping?.(true)
    const onBlur = () => {
      el.value = sent = ''
      onTyping?.(false)
    }
    el.addEventListener('input', onInput)
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('focus', onFocus)
    el.addEventListener('blur', onBlur)
    return () => {
      el.removeEventListener('input', onInput)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('focus', onFocus)
      el.removeEventListener('blur', onBlur)
    }
  }, [rfb, onTyping])
  useEffect(() => {
    if (!yours) typing.current?.blur()
  }, [yours])

  // The browser fits the frame; the desktop's own bars sit outside it.
  const shown = fb ?? agentSize
  const visible = shown.h - CHROME.top - CHROME.bottom - 2 * EDGE
  const s = box.w && box.h ? Math.min(box.w / shown.w, box.h / visible) : 0

  return (
    <div ref={frame} className={cn('relative flex items-center justify-center', className)}>
      <div
        className={cn(
          'relative overflow-hidden bg-sunken transition-shadow duration-300',
          fit && yours ? 'rounded-[18px]' : 'rounded-[14px]',
          yours ? RING : 'shadow-[0_0_0_0.5px_var(--line-strong)]',
        )}
        style={{ width: shown.w * s, height: visible * s }}
      >
        <div
          ref={stage}
          className="absolute left-0"
          style={{ top: -(CHROME.top + EDGE) * s, width: shown.w * s, height: shown.h * s }}
        />
        {!rfb && (
          <div className="absolute inset-0 animate-fade">
            {still && <Still src={still} size={agentSize} className="h-full w-full" />}
            {screen && !running && off}
          </div>
        )}
      </div>
      <input
        ref={typing}
        aria-label="Type into the page"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="one-time-code"
        spellCheck={false}
        tabIndex={-1}
        className="pointer-events-none absolute bottom-0 left-1/2 size-px opacity-0"
      />
    </div>
  )
})
