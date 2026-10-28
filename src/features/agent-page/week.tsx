import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/cn'
import type { Agent } from '@/state/agents'
import { money, useWeek, type Day, type Week } from '@/state/insights'
import { ToolIcon } from '@/features/chat/tool-icon'
import type { ToolCategory } from '@/features/chat/tool-labels'

// Your week with an agent, at a glance: how many chats, which days, what it
// cost this month and what it reached for most. Nothing at all until there's
// been a chat this week.

const KIND: Partial<Record<ToolCategory, string>> = {
  web: 'Web',
  browser: 'Browser',
  terminal: 'Commands',
  file: 'Files',
  code: 'Code',
  helper: 'Helpers',
  memory: 'Memory',
  playbook: 'Skills',
  plan: 'Plans',
  vision: 'Images',
  image: 'Pictures',
  voice: 'Voice',
  message: 'Messages',
  schedule: 'Routines',
  history: 'Past chats',
  mail: 'Email',
  app: 'Apps',
}

const ease = [0.16, 1, 0.3, 1] as const

export function WeekCard({ agent }: { agent: Agent }) {
  const week = useWeek(agent.id).data
  if (!week) return null
  return <Card week={week} agent={agent} />
}

function Card({ week, agent }: { week: Week; agent: Agent }) {
  const reduce = useReducedMotion()
  const spend = week.month.amount >= 0.005
  return (
    <motion.section
      aria-labelledby="agent-week"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease }}
    >
      <h2 id="agent-week" className="mb-2 px-4 text-footnote font-medium text-ink-2">
        This week
      </h2>
      <div className="rounded-xl bg-fill-1 px-4 pt-3.5 pb-4">
        <div className="flex items-start justify-between gap-4">
          <p className="min-w-0">
            <span className="text-title font-semibold tracking-[-0.02em] tabular-nums">{week.chats}</span>
            <span className="ml-1.5 text-subhead text-ink-2">{week.chats === 1 ? 'chat' : 'chats'}</span>
          </p>
          {spend && (
            <p
              className="flex-none text-right"
              title={week.month.estimated ? 'Hermes’s estimate from what each model charges' : undefined}
            >
              <span className="block text-subhead font-medium tabular-nums">
                {week.month.estimated && <span className="text-ink-3">≈ </span>}
                {money(week.month.amount)}
              </span>
              <span className="block text-caption text-ink-3">this month</span>
            </p>
          )}
        </div>

        <Bars days={week.days} name={agent.name} />

        {week.tools.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 hairline-t pt-3">
            <span className="w-full pb-0.5 text-caption text-ink-3">Most used</span>
            {week.tools.map((t) => (
              <span
                key={t.category}
                className="inline-flex h-7 items-center gap-1.5 rounded-full bg-fill-2 pr-2.5 pl-2 text-footnote text-ink-2"
              >
                <span className="text-accent">
                  <ToolIcon category={t.category} size={13} />
                </span>
                {KIND[t.category] ?? 'Tools'}
                <span className="text-ink-3 tabular-nums">{t.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.section>
  )
}

const H = 44

/** Seven columns, one a day, today's in the agent's colour. */
function Bars({ days, name }: { days: Day[]; name: string }) {
  const reduce = useReducedMotion()
  const most = Math.max(1, ...days.map((d) => d.chats))
  const busiest = days.reduce((a, b) => (b.chats > a.chats ? b : a))
  const weekday = (d: Date, style: 'narrow' | 'long') => d.toLocaleDateString(undefined, { weekday: style })
  return (
    <div
      role="img"
      aria-label={`Chats with ${name} each day this week. Busiest: ${weekday(busiest.date, 'long')}, ${busiest.chats}.`}
      className="mt-3 grid grid-cols-7 gap-2"
    >
      {days.map((d, i) => {
        const today = i === days.length - 1
        const h = d.chats ? Math.max(6, Math.round((d.chats / most) * H)) : 4
        return (
          <div key={d.key} className="flex flex-col items-center gap-1.5">
            <div className="flex w-full items-end justify-center" style={{ height: H }}>
              <motion.span
                className={cn(
                  'block w-full max-w-6 origin-bottom rounded-[5px]',
                  !d.chats ? 'bg-fill-3' : today ? 'bg-accent' : 'bg-accent/35',
                )}
                style={{ height: h }}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scaleY: 0.2 }}
                animate={{ opacity: 1, scaleY: 1 }}
                transition={
                  reduce ? { duration: 0.15 } : { type: 'spring', duration: 0.5, bounce: 0.15, delay: 0.08 + i * 0.035 }
                }
              />
            </div>
            <span aria-hidden className={cn('text-caption', today ? 'font-medium text-ink' : 'text-ink-3')}>
              {weekday(d.date, 'narrow')}
            </span>
          </div>
        )
      })}
    </div>
  )
}
