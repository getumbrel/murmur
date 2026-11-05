import { useState } from 'react'
import { useLocation } from 'wouter'
import { useMediaContext } from '@/features/media/context'
import { useAgent } from '@/state/agents'
import { useRoutines, type Routine } from '@/state/routines'
import { useAgentTimezone } from '@/state/timezone'
import { Glyph } from './glyph'
import { iconFor } from './templates'
import { capitalize, describeWhen } from './schedule'
import { RoutineDetailSheet } from './routine-detail'

/**
 * The routine an agent just set up, under the step that made it: what it is,
 * when it runs, and where what it finds goes. Tap it for the routine itself.
 */
export function RoutineCard({ agentId, routineId }: { agentId: string; routineId: string }) {
  const routine = useRoutines(agentId).data?.find((r) => r.id === routineId)
  const agent = useAgent(agentId)
  const zone = useAgentTimezone(agentId).data || undefined
  const chatId = useMediaContext().sessionId
  const [open, setOpen] = useState(false)
  const [, navigate] = useLocation()
  // Gone since (deleted), or not in yet: the step says it was set up.
  if (!routine) return null

  const when = routine.done
    ? 'Done'
    : !routine.enabled
      ? 'Off'
      : capitalize(describeWhen(routine.when, routine.scheduleText, zone))
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable flex w-full max-w-sm items-center gap-3 self-start rounded-2xl bg-fill-1 py-2.5 pr-4 pl-3 text-left transition-colors hover:bg-fill-2"
      >
        <Glyph icon={iconFor(routine.template, routine.name)} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-subhead font-semibold">{routine.name}</span>
          <span className="block truncate text-footnote text-ink-2">
            {[when, reportsWhere(routine, chatId)].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
      {agent && (
        <RoutineDetailSheet
          agent={agent}
          routineId={routine.id}
          open={open}
          onOpenChange={setOpen}
          onOpenRun={(runId) => {
            setOpen(false)
            navigate(`/chat/${encodeURIComponent(agentId)}/${encodeURIComponent(runId)}`)
          }}
        />
      )}
    </>
  )
}

const PLACES: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  email: 'email',
}

/** Where what it finds goes, from this chat: here, or the place Hermes sends it. */
function reportsWhere(routine: Routine, chatId: string | undefined) {
  if (routine.chat ? routine.chat === chatId : !routine.noted && routine.deliver === 'local') return 'Reports here'
  const place = PLACES[routine.deliver.split(',')[0].split(':')[0].trim().toLowerCase()]
  return place ? `Sends to ${place}` : ''
}
