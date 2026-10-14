import { motion } from 'motion/react'
import { CalendarDays, Lightbulb, PenLine } from 'lucide-react'
import { Orb, type OrbState } from '@/ui/orb'
import { templateStarters, type Starter } from '@/features/templates/templates'

const STARTERS: readonly Starter[] = [
  { icon: CalendarDays, label: 'Plan my week', prompt: 'Help me plan my week. Ask me what’s on my plate, then lay it out day by day.' },
  { icon: Lightbulb, label: 'Explain something simply', prompt: 'I’d like you to explain something to me simply, like I’m new to it. Ask me what it is.' },
  { icon: PenLine, label: 'Help me write a message', prompt: 'Help me write a message. Ask me who it’s for and what I want to say.' },
]

type Props = {
  agent: { id: string; name: string; hue: number; role: string; template?: string }
  onStart: (prompt: string) => void
  /** e.g. 'listening' while you type the first message. */
  orb?: OrbState
}

/** A new chat: the agent says hello and offers a few ways in. */
export function EmptyState({ agent, onStart, orb }: Props) {
  return (
    <div className="flex w-full flex-col items-center pb-10 text-center">
      {/* The agent arrives first, with a small spring; its words and the ways in follow. */}
      <motion.div
        className="relative"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', duration: 0.6, bounce: 0.2 }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-12 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
        />
        <Orb hue={agent.hue} size={96} seed={agent.id} state={orb} />
      </motion.div>
      <h2 className="mt-6 max-w-full animate-rise text-title font-semibold tracking-[-0.02em] text-balance break-words [animation-delay:80ms]">
        Hi, I’m {agent.name}
      </h2>
      {agent.role && <p className="mt-1 max-w-80 animate-rise text-subhead text-balance text-ink-2 [animation-delay:130ms]">{agent.role}</p>}

      <div className="mt-8 flex max-w-[460px] flex-wrap justify-center gap-2">
        {(templateStarters(agent) ?? STARTERS).map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onStart(s.prompt)}
            style={{ animationDelay: `${200 + i * 50}ms` }}
            className="pressable flex h-11 max-w-full animate-rise items-center gap-2 rounded-full bg-fill-1 pr-4 pl-3.5 text-subhead text-ink ring-[0.5px] ring-line ring-inset select-none hover:bg-fill-2"
          >
            <s.icon size={17} strokeWidth={1.85} aria-hidden className="text-accent" />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
