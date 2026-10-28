import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check } from 'lucide-react'
import { Button } from '@/ui/button'
import { Orb } from '@/ui/orb'
import { cn } from '@/lib/cn'
import type { Agent } from '@/state/agents'
import { openSignInTab } from '@/state/apps'
import { hostedAppFrom } from '@/state/hosted-apps-names'
import {
  clearChatConnect,
  finishChatConnect,
  openChatSignIn,
  skipChatConnect,
  useChatConnect,
  type ChatConnectTarget,
} from '@/state/hosted-apps-chat'
import { AppIcon, appName } from '@/features/apps/app-icon'

// An agent asking, mid-chat, to connect an app (Hermes's manage_connections,
// state/hosted-apps-chat.ts). Hermes holds the agent's turn until each app is
// connected or let go, so the card sits right above the composer: the app,
// the agent, the link between them, and one tap to sign in. Apps through Nous
// sign in in a new tab; one of Hermes's own is added from the Apps sheet.

const enter = { type: 'spring', duration: 0.32, bounce: 0 } as const
const leave = { duration: 0.16, ease: [0.16, 1, 0.3, 1] } as const
const pop = { type: 'spring', duration: 0.45, bounce: 0.45 } as const

const nameOf = (t: Pick<ChatConnectTarget, 'name' | 'kind'>) =>
  t.kind === 'connector' ? hostedAppFrom({ slug: t.name }).name : appName(t.name)
const iconOf = (t: Pick<ChatConnectTarget, 'name' | 'kind'>) => (t.kind === 'connector' ? hostedAppFrom({ slug: t.name }).icon : t.name)
const list = (names: string[]) => (names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(' and '))

/** The card for a chat's live id, when Hermes is waiting on one. */
export function ChatConnectCard({ runtimeId, agent }: { runtimeId: string | undefined; agent: Agent }) {
  const card = useChatConnect(runtimeId)
  const settled = !!card?.settled
  // Once Hermes has settled it, the card says how it went for a moment, then goes.
  useEffect(() => {
    if (!settled || !runtimeId) return
    const t = setTimeout(() => clearChatConnect(runtimeId), 2400)
    return () => clearTimeout(t)
  }, [settled, runtimeId])

  return <AnimatePresence>{card && runtimeId && <Card key={card.opId} runtimeId={runtimeId} agent={agent} />}</AnimatePresence>
}

function Card({ runtimeId, agent }: { runtimeId: string; agent: Agent }) {
  const card = useChatConnect(runtimeId)!
  const targets = card.targets.filter((t) => t.state !== 'skipped')
  const waiting = targets.filter((t) => t.state !== 'connected')
  const done = targets.length > 0 && waiting.length === 0
  const next = waiting[0]
  const viaNous = targets.some((t) => t.kind === 'connector')
  const broke = next && (next.state === 'failed' || next.state === 'expired')
  const directory = !targets.length

  const title = directory
    ? `Connect apps for ${agent.name}?`
    : done
      ? `${agent.name} can use ${list(targets.map(nameOf))}`
      : broke
        ? `${nameOf(next)} didn’t finish connecting`
        : `Connect ${list(waiting.map(nameOf))}?`
  const body = directory
    ? card.suggested?.length
      ? `It suggests ${list(card.suggested.map((s) => hostedAppFrom({ slug: s }).name))}. Add them from ${agent.name}’s Apps.`
      : `Add them from ${agent.name}’s Apps, then tap Done.`
    : done
      ? 'It’s carrying on.'
      : next.kind === 'mcp'
        ? `Add it from ${agent.name}’s Apps, and it carries on.`
        : viaNous
          ? `Through Nous Research. Sign in, and ${agent.name} carries on.`
          : `Sign in, and ${agent.name} carries on.`

  const connect = () => {
    if (!next || next.kind !== 'connector') return
    // Opened now, in the tap: a tab opened once Hermes answers would be blocked.
    const tab = openSignInTab(nameOf(next))
    void openChatSignIn(runtimeId, next.name, tab)
  }

  const icon = next ?? targets[0]
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: enter }}
      exit={{ opacity: 0, y: 6, scale: 0.98, transition: leave }}
      role="status"
      aria-live="polite"
      className="absolute inset-x-0 bottom-full z-20 mb-2 flex origin-bottom items-start gap-3 rounded-[22px] bg-elevated/90 p-3 pr-2.5 shadow-float ring-[0.5px] ring-line-strong backdrop-blur-2xl backdrop-saturate-150"
    >
      {/* The app, the agent, and the link drawn between them. */}
      <div className="flex flex-none items-center" aria-hidden>
        {icon ? <AppIcon name={iconOf(icon)} size={36} /> : <AppIcon name="nous" size={36} />}
        <span className={cn('relative mx-1 h-0.5 w-4 overflow-hidden rounded-full', done ? 'bg-fill-3' : 'umbrel-link')}>
          <motion.span
            className="umbrel-link-fill absolute inset-0 origin-left rounded-full"
            initial={false}
            animate={{ scaleX: done ? 1 : 0 }}
            transition={{ type: 'spring', duration: 0.6, bounce: 0 }}
          />
        </span>
        <span className="relative">
          <Orb hue={agent.hue} seed={agent.id} size={36} state={done ? 'done' : broke ? 'idle' : 'waiting'} />
          <AnimatePresence>
            {done && (
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
            key={`${title}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: enter }}
            exit={{ opacity: 0, y: -4, transition: leave }}
          >
            <p className="text-subhead font-semibold tracking-[-0.01em] text-balance">{title}</p>
            <p className="text-footnote text-pretty text-ink-2">{body}</p>
            {!done && !card.settled && (
              <div className="mt-2.5 flex gap-2">
                {next?.kind === 'connector' && (
                  <Button variant="accent" size="sm" onClick={connect}>
                    {broke ? 'Try again' : `Connect ${nameOf(next)}`}
                  </Button>
                )}
                {directory ? (
                  <Button variant="accent" size="sm" onClick={() => void finishChatConnect(runtimeId)}>
                    Done
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="text-ink-2" onClick={() => void skipChatConnect(runtimeId)}>
                    Not now
                  </Button>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
