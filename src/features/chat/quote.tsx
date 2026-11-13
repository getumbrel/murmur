import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Reply, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { tidyQuote } from '@/features/media/parse'
import type { ChatItem } from './types'

// Replying to a part of what the agent said. Select some of a reply and one
// small pill offers Reply; the passage then waits above the message box, goes
// with your message as a quote, and sits at the top of your bubble, where a
// tap goes back to the place it came from. Reply again and the next passage
// waits under the first: a message can answer several, from one reply or many.

/** Letters and digits only: how a passage is matched, whatever became of its spaces, marks and line breaks. */
const squeeze = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** A passage on one line, for where it's shown small. */
const flat = (quote: string) => quote.replace(/\s+/g, ' ').trim()

// ── What's selected ─────────────────────────────────────────────────────────

/** Some of one reply, selected: its words, and where they are on screen. */
export type Passage = { text: string; rect: DOMRect }

const same = (a: Passage | null, b: Passage | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.text === b.text &&
    Math.round(a.rect.top) === Math.round(b.rect.top) &&
    Math.round(a.rect.left) === Math.round(b.rect.left) &&
    Math.round(a.rect.width) === Math.round(b.rect.width) &&
    Math.round(a.rect.height) === Math.round(b.rect.height))

/** The words selected, when all of them are in one reply's own words (an element marked `data-quotable`). */
function selected(root: HTMLElement | null): Passage | null {
  const selection = document.getSelection()
  if (!root || !selection || selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  const within = (node: Node) =>
    (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-quotable]') ?? null
  const reply = within(range.startContainer) ?? within(range.endContainer)
  if (!reply || !root.contains(reply)) return null
  const text = tidyQuote(selection.toString())
  if (!text) return null
  // A selection that runs on into the next message isn't a part of this one.
  const inside = range.cloneRange()
  const whole = document.createRange()
  whole.selectNodeContents(reply)
  if (inside.compareBoundaryPoints(Range.START_TO_START, whole) < 0) inside.setStart(whole.startContainer, whole.startOffset)
  if (inside.compareBoundaryPoints(Range.END_TO_END, whole) > 0) inside.setEnd(whole.endContainer, whole.endOffset)
  if (squeeze(inside.toString()) !== squeeze(text)) return null
  return { text, rect: range.getBoundingClientRect() }
}

/**
 * The passage selected in a thread, kept current as the selection and the
 * page move. A mouse still drawing it shows nothing until it lets go. `clear`
 * lets the selection go.
 */
export function usePassage(root: RefObject<HTMLElement | null>, enabled: boolean) {
  const [passage, setPassage] = useState<Passage | null>(null)
  useEffect(() => {
    if (!enabled) return
    let drawing = false
    // The pill, pressed: a tap can let the selection go before it lands, and the pill has to still be there.
    let pressing = false
    let release: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      if (drawing || pressing) return
      const next = selected(root.current)
      setPassage((prev) => (same(prev, next) ? prev : next))
    }
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-reply-pill]')) {
        pressing = true
        clearTimeout(release)
        return
      }
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      drawing = true
      setPassage(null)
    }
    const onUp = () => {
      drawing = false
      // (After the click that follows, if there is one.)
      clearTimeout(release)
      release = setTimeout(() => {
        pressing = false
        update()
      }, pressing ? 350 : 0)
    }
    const el = root.current
    document.addEventListener('selectionchange', update)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onUp, true)
    el?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      clearTimeout(release)
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onUp, true)
      el?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [enabled, root])
  const clear = useCallback(() => {
    document.getSelection()?.removeAllRanges()
    setPassage(null)
  }, [])
  return [enabled ? passage : null, clear] as const
}

// ── The pill ────────────────────────────────────────────────────────────────

/**
 * What Reply is drawn on: the message menu's surface, near solid, so the pill
 * reads over the words it floats above (glass let them show through its label).
 */
export const REPLY_SURFACE = 'bg-elevated/95 backdrop-blur-xl'
const PILL = 'flex h-9 items-center gap-1.5 rounded-full pr-3.5 pl-3 text-footnote font-medium text-ink shadow-float ring-[0.5px] ring-line-strong'
const PILL_H = 36
/** How far it floats from what's selected. */
const GAP = 8
/** About how wide it is, for keeping it on screen. */
const PILL_W = 92
const FLOAT = { type: 'spring', stiffness: 420, damping: 32 } as const

/** What the pill says. */
export function ReplyFace() {
  return (
    <>
      <Reply size={15} strokeWidth={2} aria-hidden />
      Reply
    </>
  )
}

/**
 * Under a pointer: Reply, floating just above what's selected and centred on
 * it (under it when there's no room above), kept between `top` and `bottom`
 * of what can be seen of the thread.
 */
export function ReplyPill({
  passage,
  top,
  bottom,
  onReply,
}: {
  passage: Passage | null
  top: number
  bottom: number
  onReply: (text: string) => void
}) {
  const reduce = useReducedMotion()
  const rect = passage?.rect
  const above = !!rect && rect.top - PILL_H - GAP >= top
  const y = !rect ? 0 : above ? rect.top - PILL_H - GAP : Math.min(rect.bottom + GAP, bottom - PILL_H - GAP)
  const x = !rect
    ? 0
    : Math.min(Math.max(rect.left + rect.width / 2, 12 + PILL_W / 2), window.innerWidth - 12 - PILL_W / 2)
  // Scrolled out of sight, there's nothing to float over.
  const inSight = !!rect && rect.bottom > top && rect.top < bottom
  return createPortal(
    <AnimatePresence>
      {passage && inSight && (
        <motion.button
          key="reply"
          type="button"
          data-reply-pill=""
          // Pressing it leaves the selection, and the focus, where they are.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onReply(passage.text)}
          className={cn(PILL, REPLY_SURFACE, 'fixed z-30 cursor-default')}
          style={{ top: y, left: x, x: '-50%', transformOrigin: above ? '50% 100%' : '50% 0%' }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: above ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: reduce ? 1 : 0.96, transition: { duration: 0.12 } }}
          transition={reduce ? { duration: 0.15 } : FLOAT}
          whileTap={reduce ? undefined : { scale: 0.96 }}
        >
          <ReplyFace />
        </motion.button>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// ── Above the message box ───────────────────────────────────────────────────

/** Whether a passage is one of those already picked, whatever became of its spaces and marks. */
export const quotedAlready = (quotes: readonly string[], passage: string) => {
  const needle = squeeze(passage)
  return quotes.findIndex((q) => squeeze(q) === needle)
}

/** `quotes` with `passage` after them, unless it's there already: then they come back as they were. */
export function addQuote(quotes: readonly string[], passage: string): string[] {
  const next = tidyQuote(passage)
  if (!next || quotedAlready(quotes, next) >= 0) return quotes as string[]
  return [...quotes, next]
}

const OPEN = { type: 'spring', duration: 0.32, bounce: 0 } as const

/**
 * The passages being answered, in the message box above what's typed, in the
 * order they were picked: quiet cards, each with a bar in the agent's colour
 * and an × of its own. One has two lines; with more, each keeps to one, so a
 * few take the room one did. Past four the stack scrolls by itself. `again`
 * is a passage picked a second time: its card lights for a moment instead of
 * being there twice. They open and close the way "Editing message" does.
 */
export function ComposerQuotes({
  quotes,
  onRemove,
  again,
}: {
  quotes: readonly string[]
  onRemove: (index: number) => void
  again?: { quote: string; at: number }
}) {
  const list = useRef<HTMLDivElement>(null)
  const several = quotes.length > 1
  // A card alone has two lines, in company one. Going to one, the second line
  // is let go only once the card has closed over it: cut any sooner, the card
  // would drop a line's height at once.
  const [closed, setClosed] = useState(several)
  // (Only a card that was alone has a second line to close over.)
  const alone = useRef(quotes.length === 1)
  useEffect(() => {
    const was = alone.current
    alone.current = quotes.length === 1
    if (!several || !was) return setClosed(several)
    const after = setTimeout(() => setClosed(true), 200)
    return () => clearTimeout(after)
  }, [several, quotes.length])
  // Where the stack runs on past an edge, that edge fades: the cards under it
  // are on their way somewhere, not cut off. As deep as it's scrolled, up to 12px.
  const fade = useCallback(() => {
    const el = list.current
    if (!el) return
    const below = el.scrollHeight - el.clientHeight - el.scrollTop
    el.style.setProperty('--fade-top', `${Math.min(Math.max(el.scrollTop, 0), 12)}px`)
    el.style.setProperty('--fade-bottom', `${Math.min(Math.max(below, 0), 12)}px`)
  }, [])
  // A card opening or closing moves the end of the stack for a moment: for that
  // long the stack is held where it should be, frame by frame.
  const count = useRef(quotes.length)
  const top = useRef(0)
  useLayoutEffect(() => {
    const was = count.current
    count.current = quotes.length
    const el = list.current
    if (!el || was === quotes.length) return
    const grew = quotes.length > was
    // (One dropped: the rest stay put, as far as there's still room to.)
    const kept = top.current
    let frame = 0
    const until = performance.now() + 400
    const hold = () => {
      // The newest is the one just picked: it's brought into sight.
      el.scrollTop = grew ? el.scrollHeight : Math.min(kept, el.scrollHeight - el.clientHeight)
      fade()
      if (performance.now() < until) frame = requestAnimationFrame(hold)
    }
    hold()
    return () => cancelAnimationFrame(frame)
  }, [quotes.length, fade])
  // One picked again: into sight, and lit.
  const lit = again ? quotedAlready(quotes, again.quote) : -1
  useEffect(() => {
    if (lit < 0) return
    list.current?.children[lit]?.scrollIntoView({ block: 'nearest' })
    fade()
  }, [lit, again?.at, fade])
  return (
    <AnimatePresence initial={false}>
      {quotes.length > 0 && (
        <motion.div
          key="quotes"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={OPEN}
          className="overflow-hidden"
        >
          {/* The inset is outside what scrolls: a card never runs into the box's edge. */}
          <div className="-mb-1 px-2 pt-2">
            <div
              ref={list}
              role="group"
              aria-label={several ? `Replying to ${quotes.length} parts` : 'Replying to'}
              onScroll={(e) => ((top.current = e.currentTarget.scrollTop), fade())}
              // Four cards and most of a fifth, which says there's more. (Whatever's
              // brought into sight, a card picked again or an × tabbed to, clears the fade.)
              className="quote-stack max-h-[11rem] scroll-py-4 overflow-y-auto overscroll-contain [scrollbar-width:none]"
            >
              <AnimatePresence initial={false}>
                {quotes.map((quote, index) => (
                  <motion.div
                    key={quote}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={OPEN}
                    className="overflow-hidden"
                  >
                    {/* Rounded to sit inside the box's own corners. (The gap under a
                        card is the card's own, so it opens and closes with it.) */}
                    <div className="pb-1">
                      <div
                        key={index === lit ? again?.at : undefined}
                        className={cn(
                          'relative flex items-start gap-1 rounded-[18px] bg-fill-1 pr-1.5 pl-5 transition-[padding] duration-200',
                          several ? 'py-1.5' : 'py-2',
                          index === lit && 'quote-again',
                        )}
                      >
                        <span aria-hidden className={cn('absolute left-2.5 w-[3px] rounded-full bg-accent', several ? 'inset-y-2' : 'inset-y-2.5')} />
                        <p
                          className={cn(
                            // (Its height eases between one line and two, as its padding does.)
                            'min-w-0 flex-1 text-footnote leading-[1.4] break-words text-ink-2 transition-[max-height] duration-200',
                            several ? 'max-h-[1lh]' : 'max-h-[2lh]',
                            several && closed ? 'line-clamp-1' : 'line-clamp-2',
                          )}
                        >
                          {flat(quote)}
                        </p>
                        <button
                          type="button"
                          onClick={() => onRemove(index)}
                          aria-label={several ? `Remove quote: ${flat(quote)}` : 'Remove quote'}
                          title="Remove quote"
                          className="pressable relative mt-px flex size-5 flex-none items-center justify-center rounded-full text-ink-3 hover:bg-fill-2 hover:text-ink-2 after:absolute after:-inset-x-2.5 after:-inset-y-1.5"
                        >
                          <X size={13} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── In your bubble ──────────────────────────────────────────────────────────

/**
 * The passage a message answers, inset at the top of its bubble. A tap goes
 * to where it was said. `still` draws it without the tap (the bubble lifted
 * over its menu).
 */
export function BubbleQuote({ quote, onOpen, still }: { quote: string; onOpen?: () => void; still?: boolean }) {
  const words = flat(quote)
  const face = (
    <>
      <span aria-hidden className="absolute inset-y-2 left-2 w-[3px] rounded-full bg-accent" />
      <span className="line-clamp-3">{words}</span>
    </>
  )
  // Set into the bubble, close to its edges, with corners that follow the bubble's own.
  const shape =
    'relative -mx-2 -mt-0.5 block w-[calc(100%+1rem)] rounded-[12px] bg-fill-2 py-1.5 pr-3 pl-[1.125rem] text-left text-footnote leading-[1.4] whitespace-normal text-ink-2'
  if (still || !onOpen) return <span className={shape}>{face}</span>
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      aria-label={`Go to what you quoted: ${words}`}
      className={cn(shape, 'pressable cursor-pointer transition-colors duration-150 after:absolute after:-inset-x-1 after:-inset-y-2 hover:bg-fill-3')}
    >
      {face}
    </button>
  )
}

// ── Back to where it was said ───────────────────────────────────────────────

/** A line of a passage long enough to tell one reply from another. */
const TELLING = 12

/** Lines of a passage, squeezed, longest first: what to look for when the whole of it can't be found as one. */
const linesOf = (quote: string) =>
  quote
    .split('\n')
    .map(squeeze)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

/**
 * The reply a passage was taken from: the newest one before `before` (your
 * message) that holds all of it, or else the one that holds the most of its
 * lines. Nothing when no reply holds any of it.
 */
export function sourceOf(items: ChatItem[], before: string, quote: string): string | undefined {
  const end = items.findIndex((i) => i.id === before)
  const needle = squeeze(quote)
  if (!needle) return undefined
  const lines = linesOf(quote)
  let best: { id: string; score: number } | undefined
  for (let n = (end < 0 ? items.length : end) - 1; n >= 0; n--) {
    const item = items[n]
    if (item.kind !== 'assistant' && item.kind !== 'finding') continue
    const said = squeeze(item.text)
    if (said.includes(needle)) return item.id
    // (Markdown keeps marks the page doesn't show, a link's address say: line by line gets past them.)
    const score = lines.reduce((sum, line) => sum + (line.length >= Math.min(TELLING, needle.length) && said.includes(line) ? line.length : 0), 0)
    if (score > (best?.score ?? 0)) best = { id: item.id, score }
  }
  return best?.id
}

/** Where a passage is in a reply as it's drawn: a range over its words, or over its longest line that's there. */
export function passageRange(message: HTMLElement, quote: string): Range | undefined {
  const nodes: Text[] = []
  // Each letter or digit of the reply, in order: which text node it's in, and where.
  const at: [node: number, offset: number][] = []
  let text = ''
  const walk = document.createTreeWalker(message, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('button,[aria-hidden="true"],.sr-only') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  for (let node = walk.nextNode() as Text | null; node; node = walk.nextNode() as Text | null) {
    const n = nodes.push(node) - 1
    const data = node.data
    for (let i = 0; i < data.length; i++) {
      // (Lower-cased one character at a time, so each stays where it was.)
      const c = data[i].toLowerCase()
      if (c.length === 1 && /[\p{L}\p{N}]/u.test(c)) {
        text += c
        at.push([n, i])
      }
    }
  }
  for (const needle of [squeeze(quote), ...linesOf(quote).filter((l) => l.length >= TELLING)]) {
    const start = needle ? text.indexOf(needle) : -1
    if (start < 0) continue
    const [fromNode, from] = at[start]
    const [toNode, to] = at[start + needle.length - 1]
    // (With the marks that touch it: the full stop it ends on, the bracket it opens with.)
    const mark = (c?: string) => !!c && !/[\s\p{L}\p{N}]/u.test(c)
    let fromOffset = from
    while (mark(nodes[fromNode].data[fromOffset - 1])) fromOffset--
    let toOffset = to
    while (mark(nodes[toNode].data[toOffset + 1])) toOffset++
    const range = document.createRange()
    range.setStart(nodes[fromNode], fromOffset)
    range.setEnd(nodes[toNode], toOffset + 1)
    if (range.getClientRects().length) return range
  }
  return undefined
}

/** How long a passage stays washed: the length of its animation in styles.css. */
const WASH_MS = 2600

/**
 * Washes a passage in Find's yellow for a moment, behind its words: a soft
 * block per line, drawn over the reply rather than into it, so what React
 * rendered is left alone. Gives back the way to take it off early.
 */
export function washPassage(message: HTMLElement, range: Range) {
  const layer = document.createElement('span')
  layer.setAttribute('aria-hidden', 'true')
  layer.className = 'passage-wash'
  message.classList.add('passage-washed')
  message.append(layer)
  const lay = () => {
    const origin = layer.getBoundingClientRect()
    // One block per line: the words on a line come as several boxes.
    const lines: { top: number; bottom: number; left: number; right: number }[] = []
    for (const box of range.getClientRects()) {
      if (!box.width || !box.height) continue
      const line = lines.find((l) => box.top < l.bottom - 2 && box.bottom > l.top + 2)
      if (line) {
        line.top = Math.min(line.top, box.top)
        line.bottom = Math.max(line.bottom, box.bottom)
        line.left = Math.min(line.left, box.left)
        line.right = Math.max(line.right, box.right)
      } else lines.push({ top: box.top, bottom: box.bottom, left: box.left, right: box.right })
    }
    layer.replaceChildren(
      ...lines.map((l) => {
        const block = document.createElement('span')
        Object.assign(block.style, {
          left: `${l.left - origin.left - 3}px`,
          top: `${l.top - origin.top - 1}px`,
          width: `${l.right - l.left + 6}px`,
          height: `${l.bottom - l.top + 2}px`,
        })
        return block
      }),
    )
  }
  lay()
  const ro = new ResizeObserver(lay)
  ro.observe(message)
  const off = () => {
    clearTimeout(timer)
    ro.disconnect()
    layer.remove()
    message.classList.remove('passage-washed')
  }
  const timer = setTimeout(off, WASH_MS)
  return off
}
