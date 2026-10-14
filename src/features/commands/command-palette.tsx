import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Check, Keyboard, Search, Settings } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMedia } from '@/lib/use-media'
import { navigate } from '@/lib/transitions'
import { filterCommands, isCurated, paletteFor, type Command, type CommandOption, type Palette } from './commands'
import { Keys, focusSearch, openShortcuts } from './shortcuts'

/** Murmur's own, for keyboards: each shows its shortcut. Settings and search wait to be typed. */
const APP: Command[] = [
  { name: 'shortcuts', icon: Keyboard, title: 'Keyboard shortcuts', description: 'Every shortcut, in one place', keys: '?', run: openShortcuts },
  { name: 'settings', icon: Settings, title: 'Settings', description: 'Agents, models and more', keys: 'mod+,', run: () => navigate('/settings'), quiet: true },
  { name: 'search', icon: Search, title: 'Search chats', description: 'Find something said before', keys: 'mod+k', run: () => focusSearch(), quiet: true },
]

type Item =
  | { key: string; kind: 'command'; command: Command }
  | { key: string; kind: 'option'; command: Command; option: CommandOption }

const MAX_EXTRA = 4

function itemsFor(palette: Palette, commands: Command[], extra: Command[]): Item[] {
  if (!palette) return []
  if (palette.mode === 'options') {
    const q = palette.query
    return (palette.command.options ?? [])
      .filter((o) => !q || o.value.startsWith(q) || o.title.toLowerCase().startsWith(q))
      .map((option) => ({ key: option.value, kind: 'option', command: palette.command, option }))
  }
  const curated = filterCommands(commands, palette.query)
  // Hermes's own commands only once you've started typing a name.
  const more = palette.query
    ? extra.filter((c) => c.name.startsWith(palette.query) && !isCurated(c.name)).slice(0, MAX_EXTRA)
    : []
  return [...curated, ...more].map((command) => ({ key: command.name, kind: 'command', command }))
}

type Options = {
  text: string
  setText: (text: string) => void
  commands: Command[]
  extra?: Command[]
  /** Run a command now; `arg` is empty for ones that take none. */
  onRun: (name: string, arg: string) => void
  /** The current choice for an options command (e.g. thinking), ticked in its list. */
  current?: Record<string, string | undefined>
}

/** The palette's state, driven by what's typed. Hand its `onKeyDown` the composer's keys first. */
export function useCommandPalette({ text, setText, commands: given, extra = [], onRun, current }: Options) {
  const keyboard = useMedia('(hover: hover) and (pointer: fine)')
  // Only where there's a chat's commands to begin with.
  const commands = useMemo(() => (keyboard && given.length ? [...given, ...APP] : given), [keyboard, given])
  const palette = useMemo(() => paletteFor(text, commands), [text, commands])
  const items = useMemo(() => itemsFor(palette, commands, extra), [palette, commands, extra])
  const [highlight, setHighlight] = useState(0)
  // Esc hides it until you leave the slash behind.
  const [dismissed, setDismissed] = useState(false)
  if (dismissed && !text.startsWith('/')) setDismissed(false)

  const query = palette ? `${palette.mode}:${palette.mode === 'options' ? palette.command.name : ''}:${palette.query}` : ''
  const [lastQuery, setLastQuery] = useState(query)
  if (query !== lastQuery) {
    setLastQuery(query)
    const at = palette?.mode === 'options' ? items.findIndex((i) => i.kind === 'option' && i.option.value === current?.[palette.command.name]) : 0
    setHighlight(Math.max(0, at))
  }

  const open = !dismissed && items.length > 0
  const index = Math.min(highlight, Math.max(0, items.length - 1))

  const pick = (item: Item, complete = false) => {
    if (item.kind === 'option') {
      setText('')
      return onRun(item.command.name, item.option.value)
    }
    const { command } = item
    if (command.run) {
      setText('')
      return command.run()
    }
    if (complete || command.arg || command.options) return setText(`/${command.name} `)
    setText('')
    onRun(command.name, '')
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open || e.nativeEvent.isComposing) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((index + step + items.length) % items.length)
    } else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      pick(items[index], e.key === 'Tab')
    } else if (e.key === 'Escape') {
      setDismissed(true)
    } else {
      return false
    }
    e.preventDefault()
    return true
  }

  return {
    open,
    palette,
    items,
    index,
    setHighlight,
    pick,
    onKeyDown,
    back: () => setText('/'),
    current,
  }
}

export type CommandPaletteState = ReturnType<typeof useCommandPalette>

const enter = { type: 'spring', duration: 0.32, bounce: 0 } as const
const leave = { duration: 0.16, ease: [0.16, 1, 0.3, 1] } as const

/** Floats above the composer: what you can do from here, in plain words. */
export function CommandPalette({ state, id }: { state: CommandPaletteState; id: string }) {
  const { open, palette, items, index, setHighlight, pick, back, current } = state
  const fine = useMedia('(hover: hover) and (pointer: fine)')
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index, open])

  const options = palette?.mode === 'options' ? palette.command : null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: enter }}
          exit={{ opacity: 0, y: 6, scale: 0.98, transition: leave }}
          className="absolute inset-x-0 bottom-full z-20 mb-2 origin-bottom overflow-hidden rounded-[22px] bg-elevated/90 shadow-float ring-[0.5px] ring-line-strong backdrop-blur-2xl backdrop-saturate-150"
          // Keep focus (and the keyboard) in the composer.
          onPointerDown={(e) => e.preventDefault()}
        >
          {options && (
            <div className="flex items-center gap-1 px-2 pt-2 pb-0.5">
              <button
                type="button"
                onClick={back}
                aria-label="All commands"
                className="pressable relative flex size-7 items-center justify-center rounded-full text-ink-3 hover:bg-fill-2 hover:text-ink-2 after:absolute after:-inset-2"
              >
                <ArrowLeft size={15} strokeWidth={2} />
              </button>
              <span className="text-footnote font-medium text-ink-2">{options.title}</span>
            </div>
          )}
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label={options ? options.title : 'Commands'}
            className="no-scrollbar max-h-[min(20.5rem,42dvh)] overflow-y-auto overscroll-contain p-1.5"
          >
            {items.map((item, i) => {
              const selected = i === index
              const Icon = item.command.icon
              const title = item.kind === 'option' ? item.option.title : item.command.title
              const description = item.kind === 'option' ? item.option.description : item.command.description
              const ticked = item.kind === 'option' && current?.[item.command.name] === item.option.value
              const passthrough = item.kind === 'command' && item.command.passthrough
              return (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  id={`${id}-${i}`}
                  data-index={i}
                  aria-selected={selected}
                  onPointerMove={() => fine && !selected && setHighlight(i)}
                  onClick={() => pick(item)}
                  className={cn(
                    'flex min-h-13 w-full items-center gap-3 rounded-[16px] py-2 pr-3 pl-2 text-left',
                    selected ? 'bg-fill-2' : 'active:bg-fill-2',
                  )}
                >
                  {item.kind === 'option' ? (
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-8 flex-none items-center justify-center rounded-sm',
                        ticked ? 'bg-accent text-accent-ink' : 'bg-fill-2 text-ink-3',
                      )}
                    >
                      {ticked ? <Check size={16} strokeWidth={2.5} /> : <ThinkingDots level={item.option.value} />}
                    </span>
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-8 flex-none items-center justify-center rounded-sm',
                        passthrough ? 'bg-fill-2 text-ink-2' : 'bg-accent-soft text-accent',
                      )}
                    >
                      <Icon size={18} strokeWidth={1.85} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-subhead leading-5 font-medium text-ink">{title}</span>
                    <span className="block truncate text-footnote text-ink-2">{description}</span>
                  </span>
                  {item.kind === 'command' && fine && item.command.keys && <Keys combo={item.command.keys} small />}
                  {item.kind === 'command' && (
                    <span className="flex-none font-mono text-caption text-ink-3">/{item.command.name}</span>
                  )}
                </button>
              )
            })}
          </div>
          {fine && (
            <div className="hairline-t flex items-center gap-3 px-4 py-2 text-caption text-ink-3">
              <span>
                <Key>↑</Key>
                <Key>↓</Key> to move
              </span>
              <span>
                <Key>↵</Key> to choose
              </span>
              <span>
                <Key>esc</Key> to close
              </span>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="mr-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-[5px] bg-fill-2 px-1 font-sans text-[11px] leading-none text-ink-2">
      {children}
    </kbd>
  )
}

/** "A" for Auto, else one to three bars: how hard it thinks, at a glance. */
function ThinkingDots({ level }: { level: string }) {
  if (level === 'auto') return <span className="text-[13px] leading-none font-semibold">A</span>
  const n = level === 'quick' ? 1 : level === 'deep' ? 2 : 3
  return (
    <span className="flex items-end gap-[2.5px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn('w-[3px] rounded-full', i < n ? 'bg-current' : 'bg-current opacity-25')}
          style={{ height: 6 + i * 3 }}
        />
      ))}
    </span>
  )
}
