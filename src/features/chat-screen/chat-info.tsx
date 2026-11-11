import { useId, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { Sheet } from '@/ui/sheet'
import { ListGroup, ListRow } from '@/ui/list'
import { Orb } from '@/ui/orb'
import { Skeleton } from '@/ui/skeleton'
import { money, tokensText, useContextBreakdown, type ChatUsage, type Slice } from '@/state/insights'

// What the agent remembers of a chat, what it's cost, and how much it has read
// and written along the way; the chat's menu opens it. A long chat outgrows
// what the model can read at once, and Hermes then summarizes its earlier
// messages: the agent keeps those in brief and the recent ones word for word,
// while the person still has every one.

/** Each part of what it's keeping in mind in the agent's own colour, the chat itself boldest. */
const SHADE: Record<Slice['id'], number> = { chat: 1, tools: 0.62, instructions: 0.42, skills: 0.3, memory: 0.22 }
const shade = (id: Slice['id']) => `color-mix(in oklab, var(--accent) ${SHADE[id] * 100}%, transparent)`

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: { id: string; name: string; hue: number }
  usage?: ChatUsage
  /** The agent has summarized this chat's earlier messages (just now, or read back from its history). */
  summarized: boolean
  /** The chat's live id in Hermes, for what it's keeping in mind. */
  runtimeId?: string
}

export function ChatInfoSheet({ open, onOpenChange, agent, usage, summarized, runtimeId }: Props) {
  const breakdown = useContextBreakdown(runtimeId, open)
  const slices = breakdown.data?.slices ?? []
  const total = slices.reduce((n, s) => n + s.tokens, 0)
  const heading = useId()

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="This chat" width={420}>
      <div className="hue-scope space-y-7 pt-1" style={{ '--hue': agent.hue } as CSSProperties}>
        <div className="flex flex-col items-center text-center">
          <Orb hue={agent.hue} size={64} seed={agent.id} />
          <p className="mt-4 text-body font-semibold tracking-[-0.01em] text-balance text-ink">
            {summarized ? `${agent.name} summarized earlier messages` : `${agent.name} remembers every message`}
          </p>
          <p className="mt-1 max-w-72 text-subhead text-balance text-ink-2">
            {summarized ? (
              <>
                It remembers those in brief, and recent ones <span className="whitespace-nowrap">word for word</span>.
                You still have them all.
              </>
            ) : (
              <>
                <span className="whitespace-nowrap">Word for word</span>, from the first one.
              </>
            )}
          </p>
        </div>

        {(breakdown.isPending && open && runtimeId) || slices.length > 0 ? (
          <section aria-labelledby={heading} className="space-y-3">
            <h3 id={heading} className="px-1 text-footnote font-medium text-ink-2">
              What it’s keeping in mind
            </h3>
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-fill-2">
              {breakdown.isPending ? (
                <Skeleton className="h-full w-full" />
              ) : (
                slices.map((s, i) => (
                  <motion.span
                    key={s.id}
                    className="h-full origin-left first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${(s.tokens / total) * 100}%`, background: shade(s.id) }}
                    initial={{ opacity: 0, scaleX: 0.6 }}
                    animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.04 }}
                  />
                ))
              )}
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-1">
              {slices.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-footnote">
                  <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: shade(s.id) }} />
                  <span className="min-w-0 flex-1 truncate text-ink-2">{s.label}</span>
                  <span className="text-ink-3 tabular-nums">{tokensText(s.tokens)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {usage && (usage.cost !== undefined || usage.included || usage.work) && (
          <ListGroup footer={usage.work && `${agent.name} reads the chat again with every reply.`}>
            {usage.cost !== undefined && (
              <ListRow title="Spent" detail={<span className="tabular-nums">≈ {money(usage.cost)}</span>} />
            )}
            {usage.included && <ListRow title="Spent" detail="Covered by your plan" />}
            {usage.work && (
              <>
                <ListRow title="Read" detail={<span className="tabular-nums">{tokensText(usage.work.read)}</span>} />
                <ListRow
                  title="Written"
                  detail={<span className="tabular-nums">{tokensText(usage.work.written)}</span>}
                />
              </>
            )}
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}
