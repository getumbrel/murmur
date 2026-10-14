// Slash commands: type "/" in the composer. A short, curated set in plain
// words; anything else typed after a slash goes to Hermes as-is.

import {
  CircleStop,
  Lightbulb,
  MessageCircleQuestionMark,
  PencilLine,
  RotateCcw,
  Sparkles,
  SquarePen,
  Target,
  Undo2,
  type LucideIcon,
} from 'lucide-react'

export type CommandName = 'new' | 'model' | 'think' | 'retry' | 'undo' | 'rename' | 'stop' | 'btw' | 'goal'

export type CommandOption = { value: string; title: string; description: string }

export type Command = {
  name: string
  icon: LucideIcon
  title: string
  description: string
  /** What goes after it, e.g. "a title"; the command waits for it. */
  arg?: string
  /** Picks from these next, e.g. thinking levels. */
  options?: CommandOption[]
  /** A Hermes command outside the curated set. */
  passthrough?: boolean
  /** Its keyboard shortcut, e.g. 'mod+shift+o' (src/features/commands/shortcuts.tsx). */
  keys?: string
  /** Murmur's own: runs here instead of going to the chat. */
  run?: () => void
  /** Only once you start typing its name. */
  quiet?: boolean
}

const THINK: CommandOption[] = [
  { value: 'auto', title: 'Auto', description: 'Let your agent decide how hard to think' },
  { value: 'quick', title: 'Quick', description: 'Fast answers for simple things' },
  { value: 'deep', title: 'Deep', description: 'Takes longer, thinks it through' },
  { value: 'max', title: 'Max', description: 'As much thinking as it can do' },
]

const ALL: Record<CommandName, Omit<Command, 'name'>> = {
  new: { icon: SquarePen, title: 'New chat', description: 'Start fresh', keys: 'mod+shift+o' },
  btw: {
    icon: MessageCircleQuestionMark,
    title: 'Quick question',
    description: 'Ask on the side without interrupting',
    arg: 'your question',
  },
  model: { icon: Sparkles, title: 'Change model', description: 'Pick the AI that answers' },
  think: { icon: Lightbulb, title: 'Thinking', description: 'Quick, Deep, Max or Auto', options: THINK },
  retry: { icon: RotateCcw, title: 'Try again', description: 'A new reply to your last message' },
  undo: { icon: Undo2, title: 'Undo', description: 'Take back your last message' },
  rename: { icon: PencilLine, title: 'Rename chat', description: 'Give this chat a title', arg: 'a title' },
  goal: { icon: Target, title: 'Set a goal', description: 'Keep working until it’s done', arg: 'the goal' },
  stop: { icon: CircleStop, title: 'Stop', description: 'Stop the reply in progress', keys: 'esc' },
}

/** The curated commands, in palette order. */
export function commandList(names: CommandName[]): Command[] {
  return names.map((name) => ({ name, ...ALL[name] }))
}

export const isCurated = (name: string): name is CommandName => name in ALL

/** "/rename Trip ideas" → { name: 'rename', arg: 'Trip ideas' }. Paths like "/etc/hosts" aren't commands. */
export function parseCommand(text: string) {
  const m = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim())
  return m ? { name: m[1].toLowerCase(), arg: (m[2] ?? '').trim() } : null
}

export type Palette =
  | { mode: 'commands'; query: string }
  | { mode: 'options'; command: Command; query: string }
  | null

/** What the palette shows for the composer's text, if anything. */
export function paletteFor(text: string, commands: Command[]): Palette {
  if (!text.startsWith('/') || text.includes('\n')) return null
  const word = /^\/([\w-]*)$/.exec(text)
  if (word) return { mode: 'commands', query: word[1].toLowerCase() }
  const withArg = /^\/([\w-]+)\s+(\S*)$/.exec(text)
  const command = withArg && commands.find((c) => c.name === withArg[1].toLowerCase() && c.options)
  return command ? { mode: 'options', command, query: withArg[2].toLowerCase() } : null
}

/** Name matches first, then title words. */
export function filterCommands(commands: Command[], query: string) {
  if (!query) return commands.filter((c) => !c.quiet)
  const starts = commands.filter((c) => c.name.startsWith(query))
  const words = commands.filter(
    (c) => !starts.includes(c) && c.title.toLowerCase().split(/\s+/).some((w) => w.startsWith(query)),
  )
  return [...starts, ...words]
}
