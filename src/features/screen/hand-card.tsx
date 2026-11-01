import { memo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Check, EyeOff } from 'lucide-react'
import { Orb } from '@/ui/orb'
import { Button } from '@/ui/button'
import { cn } from '@/lib/cn'
import type { ChatItem, Speaker } from '@/features/chat/types'
import { Swap, arrive } from '@/features/chat/collapse'
import { formatDuration } from '@/features/chat/format'
import { useControl } from '@/state/screen'
import { Peek } from './peek'
import { openViewer, takeOverAndOpen } from './viewer'

type Item = Extract<ChatItem, { kind: 'tool' }>

/**
 * The agent asking for a hand with its browser (the murmur-screen plugin's
 * ask_for_a_hand): the page right there, what it needs, and one thing to do
 * about it. Once it's handed back, a line saying so.
 */
export const HandCard = memo(function HandCard({
  item,
  agent,
  site,
  hue,
  seed,
}: {
  item: Item
  agent: Speaker
  site?: string
  hue: number
  seed?: string
}) {
  const waiting = item.status === 'running'
  // Handed back while you watched: the line says so with a brief tint. From history, quietly.
  const watched = useRef(waiting)
  return (
    <Swap id={waiting ? 'card' : 'receipt'}>
      {waiting ? (
        <Asking item={item} agent={agent} site={site} hue={hue} seed={seed} />
      ) : (
        <p
          className={cn(
            'flex h-8 min-w-0 items-center gap-2 text-footnote text-ink-3',
            watched.current && 'receipt-tint -mx-2 px-2',
          )}
        >
          <Check size={14} strokeWidth={2} aria-hidden className="flex-none text-success" />
          <span className="flex-none text-ink-2">
            You took over{item.took ? ` for ${formatDuration(item.took)}` : ''}
          </span>
          {site && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{site}</span>
            </>
          )}
        </p>
      )}
    </Swap>
  )
})

function Asking({
  item,
  agent,
  site,
  hue,
  seed,
}: {
  item: Item
  agent: Speaker
  site?: string
  hue: number
  seed?: string
}) {
  const control = useControl(agent.id)
  const [busy, setBusy] = useState(false)
  const viewing = { profile: agent.id, agent, site, reason: item.detail }
  const yours = control === 'you'
  const act = async () => {
    if (yours) return openViewer(viewing)
    setBusy(true)
    await takeOverAndOpen(viewing)
    setBusy(false)
  }
  return (
    <motion.div {...arrive} className="rounded-xl bg-elevated p-4 shadow-[inset_0_0_0_0.5px_var(--line-strong)]">
      <div className="flex items-center gap-3">
        <Orb hue={hue} size={28} state="waiting" seed={seed} />
        <h3 className="min-w-0 flex-1 text-subhead font-semibold tracking-[-0.01em]">
          {yours
            ? 'You’re in control'
            : control === 'elsewhere'
              ? 'You’re in control on another device'
              : `${agent.name} needs a hand`}
        </h3>
      </div>
      {item.detail && <p className="mt-2 text-footnote text-ink-2">{item.detail}</p>}
      <div className="mt-3">
        <Peek profile={agent.id} agent={agent} site={site} reason={item.detail} />
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-ink-3">
          <EyeOff size={12} strokeWidth={2} aria-hidden className="flex-none" />
          <span className="min-w-0">{agent.name} waits, and can’t look, while you’re in control.</span>
        </p>
        <Button
          variant={yours ? 'secondary' : 'primary'}
          loading={busy}
          onClick={act}
          className="h-11 w-full whitespace-nowrap sm:h-10 sm:w-auto sm:min-w-24"
        >
          {yours ? 'Back to the browser' : control === 'elsewhere' ? 'Take over here' : 'Take over'}
        </Button>
      </div>
    </motion.div>
  )
}
