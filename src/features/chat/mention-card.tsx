import type { CSSProperties, RefObject } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Buddy, type BuddyState } from '@/ui/buddy'
import { Button } from '@/ui/button'
import { Sheet } from '@/ui/sheet'
import { cn } from '@/lib/cn'
import { useIsWide } from '@/lib/use-media'
import { navigate } from '@/lib/transitions'
import { useAgent, type Agent } from '@/state/agents'
import { useAgentStatus } from '@/state/status'
import { prettyModel } from '@/features/model/names'

// Who an @mention is: a small card with the agent's live Buddy, what it's
// for and the model it thinks with, and the two ways to go to it. A popover
// grown from the chip on wide screens; a sheet on phones.

type Props = {
  agentId: string
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
}

const grow = { type: 'spring', visualDuration: 0.3, bounce: 0.15 } as const
const fade = { duration: 0.15, ease: 'easeOut' } as const

export function MentionCard({ agentId, anchor, open, onOpenChange }: Props) {
  const agent = useAgent(agentId)
  const wide = useIsWide()
  const reduce = useReducedMotion()
  if (!agent) return null

  const go = (to: string) => {
    onOpenChange(false)
    navigate(to)
  }
  const profile = <Profile agent={agent} wide={wide} onGo={go} />

  if (!wide)
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={agent.name} hideTitle>
        {profile}
      </Sheet>
    )

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor virtualRef={anchor} />
      <AnimatePresence>
        {open && (
          <Popover.Portal forceMount>
            <Popover.Content
              forceMount
              asChild
              side="bottom"
              align="center"
              sideOffset={8}
              collisionPadding={12}
              aria-label={agent.name}
              // The chip toggles it: a press on it isn't a press outside.
              onInteractOutside={(e) => {
                if (anchor.current?.contains(e.target as Node)) e.preventDefault()
              }}
              onCloseAutoFocus={(e) => {
                e.preventDefault()
                anchor.current?.focus({ preventScroll: true })
              }}
            >
              <motion.div
                className="z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-xl bg-elevated px-5 pt-3 pb-5 shadow-float ring-1 ring-line outline-none"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1, transition: reduce ? fade : grow }}
                exit={reduce ? { opacity: 0, transition: fade } : { opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
              >
                {profile}
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  )
}

function Profile({ agent, wide, onGo }: { agent: Agent; wide: boolean; onGo: (to: string) => void }) {
  const status = useAgentStatus(agent.id)
  const busy = Boolean(status.activity && status.state !== 'idle' && status.state !== 'done')
  const state: BuddyState = status.state
  return (
    <div className="hue-scope flex flex-col items-center text-center" style={{ '--hue': agent.hue } as CSSProperties}>
      {/* Its soft light stays inside its own box: a sheet's scroller would clip it flat. */}
      <div className="relative grid place-items-center p-5">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
        />
        <span className="relative">
          <Buddy hue={agent.hue} size={56} state={state} seed={agent.id} />
        </span>
      </div>
      <p className="mt-0.5 max-w-full text-[17px] leading-6 font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">
        {agent.name}
      </p>
      <p
        className={cn(
          'mt-0.5 line-clamp-2 max-w-full text-footnote text-balance',
          busy ? (status.state === 'waiting' ? 'font-medium text-accent' : 'text-shimmer') : 'text-ink-2',
        )}
      >
        {busy ? status.activity : agent.role || (agent.isDefault ? 'Your main agent' : 'Your agent')}
      </p>
      {agent.model && (
        <span className="mt-2.5 max-w-full truncate rounded-full bg-fill-1 px-2.5 py-1 text-caption font-medium text-ink-2">
          {prettyModel(agent.model)}
        </span>
      )}
      <div className={cn('grid w-full grid-cols-2 gap-2', wide ? 'mt-5' : 'mt-6')}>
        <Button variant="secondary" size={wide ? 'md' : 'lg'} onClick={() => onGo(`/agent/${agent.id}`)}>
          Open
        </Button>
        <Button variant="accent" size={wide ? 'md' : 'lg'} onClick={() => onGo(`/chat/${agent.id}/new`)}>
          Message
        </Button>
      </div>
    </div>
  )
}
