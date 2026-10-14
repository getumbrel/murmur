import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Check, X } from 'lucide-react'
import { Button } from '@/ui/button'
import { Orb } from '@/ui/orb'
import { UmbrelMark } from '@/ui/brand'
import { cn } from '@/lib/cn'
import type { Agent } from '@/state/agents'
import { connectUmbrel, findUmbrelKey, UmbrelKeyError, umbrelSettingsUrl, useHermesOnUmbrel } from '@/state/umbrel-mcp'

// The moment someone pastes umbrelOS's "connect your agent" message into a
// chat. Sent as is, it would hand the key to the model provider and ask the
// agent to edit its own config (which Hermes won't let it do). So Murmur steps
// in before it goes: a card above the composer offers to connect every agent
// itself (Send does the same), draws the link from the Umbrel to the agent as
// each one joins, and leaves the friendly part of the ask ready to send.

const enter = { type: 'spring', duration: 0.32, bounce: 0 } as const
const leave = { duration: 0.16, ease: [0.16, 1, 0.3, 1] } as const
const pop = { type: 'spring', duration: 0.45, bounce: 0.45 } as const

/** What's left to say once it's connected: the umbrelOS message ends with this. */
export const UMBREL_HELLO = 'Say hello to my Umbrel and tell me what you find.'

type Phase = 'connecting' | 'done' | 'refused' | 'unreachable'

/**
 * For a chat's composer: `above` draws the card, `beforeSend` takes over Send
 * while a key is in the text. `onConnected` gets to replace the text.
 */
export function useUmbrelKey({
  agent,
  agents,
  onConnected,
}: {
  agent: Agent | undefined
  agents: Agent[]
  onConnected: (next: string) => void
}) {
  const qc = useQueryClient()
  const onUmbrel = useHermesOnUmbrel().data === true
  const [phase, setPhase] = useState<Phase | null>(null)
  const [joined, setJoined] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(settle.current), [])

  const connect = useCallback(
    async (key: string) => {
      clearTimeout(settle.current)
      setPhase('connecting')
      setJoined(0)
      try {
        await connectUmbrel(
          key,
          agents.map((a) => a.id),
          () => setJoined((n) => n + 1),
        )
        setPhase('done')
        onConnected(UMBREL_HELLO)
        void qc.invalidateQueries({ queryKey: ['umbrel-mcp'] })
        // A beat to take it in, then out of the way.
        settle.current = setTimeout(() => setPhase(null), 2800)
      } catch (e) {
        setPhase(e instanceof UmbrelKeyError ? 'refused' : 'unreachable')
      }
    },
    [agents, onConnected, qc],
  )

  const beforeSend = useCallback(
    (text: string) => {
      const key = onUmbrel && findUmbrelKey(text)
      if (!key) return false
      if (phase !== 'connecting') void connect(key)
      return true
    },
    [onUmbrel, phase, connect],
  )

  const above = (text: string) => {
    const key = onUmbrel ? findUmbrelKey(text) : null
    const show = phase !== null || (!!key && key !== dismissed)
    return (
      <AnimatePresence>
        {show && agent && (
          <UmbrelKeyCard
            key="umbrel-key"
            agent={agent}
            count={agents.length}
            joined={joined}
            phase={phase}
            onConnect={() => key && void connect(key)}
            onDismiss={() => {
              setPhase(null)
              setDismissed(key)
            }}
          />
        )}
      </AnimatePresence>
    )
  }

  return { above, beforeSend }
}

function UmbrelKeyCard({
  agent,
  count,
  joined,
  phase,
  onConnect,
  onDismiss,
}: {
  agent: Agent
  count: number
  joined: number
  phase: Phase | null
  onConnect: () => void
  onDismiss: () => void
}) {
  const progress = phase === 'done' ? 1 : phase === 'connecting' ? Math.max(0.08, joined / Math.max(count, 1)) : 0
  const title =
    phase === 'connecting'
      ? count > 1
        ? `Connecting ${Math.min(joined + 1, count)} of ${count}…`
        : 'Connecting…'
      : phase === 'done'
        ? `${agent.name} can use your Umbrel`
        : phase === 'refused'
          ? 'umbrelOS didn’t accept that key'
          : phase === 'unreachable'
            ? 'Couldn’t reach Hermes'
            : 'Connect your Umbrel?'
  const body =
    phase === 'connecting'
      ? 'Adding it to each agent'
      : phase === 'done'
        ? count > 1
          ? 'And so can the rest of your agents.'
          : 'Ask away.'
        : phase === 'refused'
          ? 'Make a new one in umbrelOS and paste it here.'
          : phase === 'unreachable'
            ? 'Check that it’s running, then try again.'
            : count > 1
              ? `Murmur adds it to ${count === 2 ? 'both' : `all ${count}`} agents, and the key stays out of the chat.`
              : 'Murmur adds it itself, and the key stays out of the chat.'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: enter }}
      exit={{ opacity: 0, y: 6, scale: 0.98, transition: leave }}
      role="status"
      aria-live="polite"
      className="absolute inset-x-0 bottom-full z-20 mb-2 flex origin-bottom items-start gap-3 rounded-[22px] bg-elevated/90 p-3 pr-2.5 shadow-float ring-[0.5px] ring-line-strong backdrop-blur-2xl backdrop-saturate-150"
    >
      {/* The Umbrel, the agent, and the link drawn between them. */}
      <div className="flex flex-none items-center" aria-hidden>
        <span className="grid size-9 place-items-center rounded-[0.65rem] bg-[#0e0e10] text-white ring-1 ring-white/10">
          <UmbrelMark size={21} />
        </span>
        <span className="relative mx-1 h-0.5 w-4 overflow-hidden rounded-full bg-[length:5px_2px] bg-[linear-gradient(90deg,var(--line-strong)_50%,transparent_0)]">
          <motion.span
            className="absolute inset-0 origin-left rounded-full bg-accent"
            initial={false}
            animate={{ scaleX: progress }}
            transition={{ type: 'spring', duration: 0.6, bounce: 0 }}
          />
        </span>
        <span className="relative">
          <Orb
            hue={agent.hue}
            seed={agent.id}
            size={36}
            state={phase === 'connecting' ? 'thinking' : phase === 'done' ? 'done' : phase ? 'error' : 'listening'}
          />
          <AnimatePresence>
            {phase === 'done' && (
              <motion.span
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1, transition: pop }}
                exit={{ opacity: 0 }}
                className="absolute -right-1 -bottom-0.5 grid size-4.5 place-items-center rounded-full bg-success text-white ring-2 ring-elevated"
              >
                <Check size={11} strokeWidth={3.25} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </div>

      <div className="min-w-0 flex-1 py-0.5">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={phase ?? 'offer'}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: enter }}
            exit={{ opacity: 0, y: -4, transition: leave }}
          >
            <p
              className={cn(
                'text-subhead font-semibold tracking-[-0.01em] text-balance',
                (phase === 'refused' || phase === 'unreachable') && 'text-danger',
              )}
            >
              {title}
            </p>
            <p className="text-footnote text-pretty text-ink-2">{body}</p>
            {(phase === null || phase === 'refused' || phase === 'unreachable') && (
              <div className="mt-2.5 flex gap-2">
                {phase === null && (
                  <Button variant="accent" size="sm" onClick={onConnect}>
                    Connect
                  </Button>
                )}
                {phase === 'refused' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => window.open(umbrelSettingsUrl(), '_blank', 'noopener')}
                  >
                    Open umbrelOS
                    <ArrowUpRight size={14} strokeWidth={2.25} aria-hidden />
                  </Button>
                )}
                {phase === 'unreachable' && (
                  <Button size="sm" variant="secondary" onClick={onConnect}>
                    Try again
                  </Button>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {(phase === null || phase === 'refused' || phase === 'unreachable') && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={phase === null ? 'Not now' : 'Close'}
          className="pressable relative -mt-0.5 flex size-7 flex-none items-center justify-center rounded-full text-ink-3 hover:bg-fill-2 hover:text-ink-2 after:absolute after:-inset-2"
        >
          <X size={16} strokeWidth={2} />
        </button>
      )}
    </motion.div>
  )
}
