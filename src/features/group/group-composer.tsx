import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ArrowUp, AtSign, Square } from 'lucide-react'
import { Buddy, BuddyStack } from '@/ui/buddy'
import { useMedia } from '@/lib/use-media'
import { cn } from '@/lib/cn'
import type { GroupMember } from '@/state/groups'
import { activeQuery, mentionRanges, mentionedIds } from './mentions'
import { useAutoGrow, useDraft } from '@/features/chat/use-draft'
import { useKeyboardInset } from '@/features/chat/use-keyboard-inset'
import { haptic } from '@/lib/haptics'
import '@/features/chat/composer.css'

// The group's message box. Type "@" to ask someone in particular: a small
// picker of faces floats up, and chosen names tint in that agent's colour.

type Props = {
  members: GroupMember[]
  onSend: (text: string) => void
  onStop?: () => void
  busy?: boolean
  disabled?: boolean
  /** Colours the working rim: whoever has the floor. */
  hue?: number
  draftKey: string
  /** Who the text currently @mentions, and whether anything is typed. */
  onDraftChange?: (draft: { mentioned: string[]; typing: boolean }) => void
  placeholder?: string
  className?: string
}

type Option = { id: string; name: string; hue?: number; everyone?: boolean }

export function GroupComposer({
  members,
  onSend,
  onStop,
  busy = false,
  disabled = false,
  hue,
  draftKey,
  onDraftChange,
  placeholder = 'Message the group',
  className,
}: Props) {
  const [text, setText, clearDraft] = useDraft(draftKey)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const touch = useMedia('(pointer: coarse)')
  // With the keyboard up, the home indicator is under it: no room to keep for it.
  const keyboard = useKeyboardInset() > 0
  const pickerId = useId()

  const roster = useMemo(() => members.map((m) => ({ id: m.id, name: m.name, handle: m.handle })), [members])
  const ranges = useMemo(() => mentionRanges(text, roster), [text, roster])
  const mentioned = useMemo(() => mentionedIds(text, roster), [text, roster])
  const typing = text.trim().length > 0

  const report = useRef(onDraftChange)
  report.current = onDraftChange
  const mentionKey = mentioned.join()
  useEffect(() => {
    report.current?.({ mentioned: mentionKey ? mentionKey.split(',') : [], typing })
  }, [mentionKey, typing])

  useAutoGrow(area, text)
  // The tinted copy scrolls with the field.
  useLayoutEffect(() => {
    if (mirror.current && area.current) mirror.current.scrollTop = area.current.scrollTop
  }, [text])

  // ── The @ picker ──────────────────────────────────────────────────────────
  const query = focused ? activeQuery(text, caret) : null
  const options = useMemo<Option[]>(() => {
    if (!query) return []
    const q = query.query.toLowerCase()
    const people = members
      .filter(
        (m) =>
          !q ||
          m.name
            .toLowerCase()
            .split(/\s+/)
            .some((w) => w.startsWith(q)) ||
          m.name.toLowerCase().startsWith(q),
      )
      .map((m) => ({ id: m.id, name: m.name, hue: m.hue }))
    const everyone = !q || 'everyone'.startsWith(q) ? [{ id: '@everyone', name: 'Everyone', everyone: true }] : []
    return [...people, ...everyone]
  }, [query, members])
  const open = Boolean(query && options.length && dismissed !== query.start)
  const index = Math.min(highlight, Math.max(0, options.length - 1))

  const syncCaret = () => setCaret(area.current?.selectionStart ?? text.length)

  const choose = (option: Option) => {
    if (!query) return
    const word = option.everyone ? 'everyone' : option.name
    const before = text.slice(0, query.start)
    const after = text.slice(caret).replace(/^[\p{L}\p{N}_-]*/u, '')
    const insert = `@${word}${after.startsWith(' ') ? '' : ' '}`
    const next = before + insert + after
    const at = before.length + insert.length + (after.startsWith(' ') ? 1 : 0)
    setText(next)
    setCaret(at)
    setHighlight(0)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(at, at)
    })
  }

  /** The @ button: start a mention wherever the caret is. */
  const startMention = () => {
    const el = area.current
    if (!el) return
    const at = focused ? el.selectionStart : text.length
    const before = text.slice(0, at)
    const pad = before && !/\s$/.test(before) ? ' ' : ''
    const next = `${before}${pad}@${text.slice(at)}`
    const pos = at + pad.length + 1
    setText(next)
    setCaret(pos)
    setDismissed(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  // ── Sending ───────────────────────────────────────────────────────────────
  const hasContent = text.trim().length > 0
  const mode: 'send' | 'stop' = busy && !hasContent ? 'stop' : 'send'

  const send = () => {
    if (disabled || !hasContent) return
    haptic()
    onSend(text.trim())
    clearDraft()
    setCaret(0)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setHighlight((index + d + options.length) % options.length)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        choose(options[index])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(query!.start)
        return
      }
    }
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    if (touch && !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    send()
  }

  const tinted = ranges.length > 0

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn('px-3 sm:px-6 sm:pb-6', keyboard ? 'pb-3' : 'pb-[max(env(safe-area-inset-bottom),12px)]', className)}>
        <div className="hue-scope relative" style={hue !== undefined ? ({ '--hue': hue } as CSSProperties) : undefined}>
          <AnimatePresence>
            {open && (
              <MentionPicker
                key="picker"
                id={pickerId}
                options={options}
                index={index}
                onHover={setHighlight}
                onChoose={choose}
                members={members}
              />
            )}
          </AnimatePresence>

          <div className="composer glass relative rounded-[26px] shadow-float" data-busy={busy || undefined}>
            <span aria-hidden className="composer-rim" />
            {/* The same card as a one-to-one chat's: what you write on top, the
                controls in a row beneath (features/chat/composer.tsx). */}
            <div className="relative">
              {/* What you typed, with mentions tinted. Sits exactly under the (then clear) text. */}
              {tinted && (
                <div
                  ref={mirror}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 overflow-hidden px-4.5 pt-3.5 pb-1 text-body break-words whitespace-pre-wrap text-ink"
                >
                  {renderTinted(text, ranges, members)}
                </div>
              )}
              <textarea
                ref={area}
                rows={1}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setCaret(e.target.selectionStart)
                  setDismissed(null)
                }}
                onSelect={syncCaret}
                onKeyDown={onKeyDown}
                onKeyUp={syncCaret}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onScroll={(e) => {
                  if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop
                }}
                placeholder={placeholder}
                disabled={disabled}
                aria-label="Message"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={open ? pickerId : undefined}
                aria-activedescendant={open ? `${pickerId}-${index}` : undefined}
                enterKeyHint={touch ? 'enter' : 'send'}
                className={cn(
                  'no-scrollbar relative block w-full resize-none bg-transparent px-4.5 pt-3.5 pb-1 text-body outline-none placeholder:truncate placeholder:text-ink-3 disabled:opacity-50',
                  tinted ? 'text-transparent caret-ink' : 'text-ink',
                )}
              />
            </div>

            <div className="flex items-center gap-0.5 px-2 pt-1 pb-2">
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={startMention}
                disabled={disabled}
                aria-label="Mention someone"
                title="Mention someone"
                className="pressable relative flex size-9 flex-none items-center justify-center rounded-full text-ink-2 hover:bg-fill-2 hover:text-ink disabled:opacity-40 after:absolute after:-inset-1"
              >
                <AtSign size={20} strokeWidth={1.75} />
              </button>

              <div className="flex-1" />

              <button
                type="button"
                onClick={mode === 'stop' ? onStop : send}
                disabled={disabled || (mode === 'send' && !hasContent) || (mode === 'stop' && !onStop)}
                aria-label={mode === 'stop' ? 'Stop' : 'Send'}
                title={mode === 'stop' ? 'Stop' : 'Send'}
                className={cn(
                  // A 36px face with a 44px reach, like the @ button opposite.
                  'pressable relative flex size-9 flex-none items-center justify-center rounded-full transition-colors duration-200 after:absolute after:-inset-1',
                  'disabled:bg-fill-3 disabled:text-ink-3',
                  mode === 'stop' ? 'bg-ink text-bg' : 'bg-accent text-accent-ink',
                )}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={mode}
                    initial={{ scale: 0.4, opacity: 0, rotate: mode === 'stop' ? -90 : 0 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 520, damping: 30 }}
                    className="flex"
                  >
                    {mode === 'stop' ? (
                      <Square size={12} fill="currentColor" strokeWidth={0} />
                    ) : (
                      <ArrowUp size={19} strokeWidth={2.25} />
                    )}
                  </motion.span>
                </AnimatePresence>
              </button>
            </div>
          </div>
        </div>
      </div>
    </MotionConfig>
  )
}

function renderTinted(text: string, ranges: ReturnType<typeof mentionRanges>, members: GroupMember[]) {
  const out: ReactNode[] = []
  let at = 0
  ranges.forEach((r, i) => {
    if (r.start > at) out.push(text.slice(at, r.start))
    const hue = members.find((m) => m.id === r.member?.id)?.hue
    out.push(
      <span
        key={i}
        className={cn('rounded-[5px]', hue !== undefined ? 'hue-scope text-accent' : 'text-ink')}
        style={
          {
            ...(hue !== undefined ? { '--hue': hue } : {}),
            background: hue !== undefined ? 'var(--accent-soft)' : 'var(--fill-2)',
            boxShadow: `0 0 0 2px ${hue !== undefined ? 'var(--accent-soft)' : 'var(--fill-2)'}`,
          } as CSSProperties
        }
      >
        {text.slice(r.start, r.end)}
      </span>,
    )
    at = r.end
  })
  out.push(text.slice(at))
  // A trailing newline needs something after it to take up its line.
  out.push('​')
  return out
}

function MentionPicker({
  id,
  options,
  index,
  onHover,
  onChoose,
  members,
}: {
  id: string
  options: Option[]
  index: number
  onHover: (i: number) => void
  onChoose: (o: Option) => void
  members: GroupMember[]
}) {
  return (
    <motion.div
      id={id}
      role="listbox"
      aria-label="Mention someone"
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.14 } }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: '24px 100%' }}
      className="composer absolute bottom-full left-0 z-20 mb-2 w-[min(18rem,100%)] overflow-hidden rounded-[20px] p-1.5 backdrop-blur-xl"
    >
      {options.map((o, i) => (
        <button
          key={o.id}
          id={`${id}-${i}`}
          type="button"
          role="option"
          aria-selected={i === index}
          // Keep the keyboard up and the caret where it is.
          onPointerDown={(e) => e.preventDefault()}
          onPointerEnter={() => onHover(i)}
          onClick={() => onChoose(o)}
          className={cn(
            'flex h-11 w-full items-center gap-3 rounded-[14px] px-2.5 text-left transition-colors duration-150',
            i === index ? 'bg-fill-2' : 'hover:bg-fill-1',
          )}
        >
          {o.everyone ? (
            <span className="-mx-1 flex w-9 flex-none justify-center">
              <BuddyStack hues={members.map((m) => m.hue)} seeds={members.map((m) => m.id)} size={32} />
            </span>
          ) : (
            <Buddy hue={o.hue ?? 278} size={28} seed={o.id} />
          )}
          <span className="min-w-0 flex-1 truncate text-subhead font-medium">{o.name}</span>
          {o.everyone && <span className="flex-none text-footnote text-ink-3">All of them</span>}
        </button>
      ))}
    </motion.div>
  )
}
