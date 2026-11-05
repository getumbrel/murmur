import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import type { ChatItem } from '@/features/chat/types'
import { relativeDay } from '@/features/chat-screen/relative-day'
import { useAgent } from '@/state/agents'
import { couldntRun } from '@shared/routines.ts'
import { Glyph } from './glyph'
import { iconFor } from './templates'
import { RoutineDetailSheet } from './routine-detail'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

/**
 * What opens the agent speaking up with what one of the chat's routines
 * found: the routine, by its face and name, and when. It opens that run,
 * where the agent's work on it is.
 */
export function FindingLine({ item, agentId }: { item: Of<'finding'>; agentId?: string }) {
  const line = <Heading item={item} />
  const look = '-mx-1 flex h-8 max-w-full items-center gap-2 self-start rounded-lg px-1 text-subhead text-ink-3'
  if (!agentId) return <p className={look}>{line}</p>
  return (
    <Link
      href={`/chat/${encodeURIComponent(agentId)}/${encodeURIComponent(item.id)}`}
      className={`${look} transition-colors duration-150 hover:text-ink-2 focus-visible:text-ink-2`}
    >
      {line}
    </Link>
  )
}

/**
 * One of the chat's routines couldn't run (its newest runs, `failed` of them
 * in a row): the routine and when, as a finding opens, then why, in Murmur's
 * words rather than the agent's. It opens the routine, to try it again.
 */
export function FailedLine({ item, agentId }: { item: Of<'finding'>; agentId?: string }) {
  const agent = useAgent(agentId)
  const [open, setOpen] = useState(false)
  const [, navigate] = useLocation()
  return (
    <>
      <button
        type="button"
        disabled={!agent}
        onClick={() => setOpen(true)}
        className="group -mx-1 flex max-w-full flex-col self-start rounded-lg px-1 text-left"
      >
        <span className="flex h-8 max-w-full items-center gap-2 text-subhead text-ink-3 transition-colors duration-150 group-hover:text-ink-2">
          <Heading item={item} />
        </span>
        <span className="line-clamp-3 pl-7 text-subhead text-ink-2">{couldntRun(item.text, item.failed)}</span>
      </button>
      {agent && (
        <RoutineDetailSheet
          agent={agent}
          routineId={item.routineId}
          open={open}
          onOpenChange={setOpen}
          onOpenRun={(runId) => {
            setOpen(false)
            navigate(`/chat/${encodeURIComponent(agent.id)}/${encodeURIComponent(runId)}`)
          }}
        />
      )}
    </>
  )
}

/** The routine, by its face and name, and when. */
function Heading({ item }: { item: Of<'finding'> }) {
  return (
    <>
      <Glyph icon={iconFor(item.template, item.routine)} size={20} className="flex-none" />
      <span className="truncate">{item.routine}</span>
      <span aria-hidden className="flex-none">
        ·
      </span>
      <time dateTime={new Date(item.at).toISOString()} className="flex-none">
        {relativeDay(item.at)}
      </time>
    </>
  )
}
