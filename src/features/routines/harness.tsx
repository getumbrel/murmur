import { useEffect, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Buddy } from '@/ui/buddy'
import { Spinner } from '@/ui/spinner'
import { rpc, startGateway } from '@/hermes/gateway'
import { toAgent, type Profile } from '@/state/agents'
import { useRoutineRuns, useRoutines } from '@/state/routines'
import { RoutinesRow } from './routines-row'
import { RoutinesSheet, type RoutinesSheetView } from './routines-sheet'
import { relativeDate, capitalize } from './schedule'

// Dev harness against the live Hermes: /routines.html?agent=murmur-test-atlas&open=…
//   open = list | new | template:<key> | custom | detail:<id> | detail:first
// It stands in for the agent sheet: the RoutinesRow, the sheet it opens, and
// the runs the lead can fold into the agent's chat list.

const params = new URLSearchParams(location.search)
const agentId = params.get('agent') ?? 'murmur-test-atlas'
const openParam = params.get('open') ?? ''

function viewFor(open: string, firstId?: string): RoutinesSheetView | null {
  if (!open) return null
  if (open === 'list') return { page: 'list' }
  if (open === 'new') return { page: 'new', start: { page: 'pick' } }
  if (open === 'custom') return { page: 'new', start: { page: 'custom' } }
  if (open.startsWith('template:')) return { page: 'new', start: { page: 'template', key: open.slice(9) } }
  if (open.startsWith('detail:')) {
    const id = open.slice(7)
    if (id === 'first') return firstId ? { page: 'detail', id: firstId } : null
    return { page: 'detail', id }
  }
  return null
}

export function RoutinesHarness() {
  useEffect(() => startGateway(), [])
  const agent = useQuery({
    queryKey: ['harness-agent', agentId],
    queryFn: async () => {
      const res = await rpc<{ profiles: Profile[] }>('profiles.list', { include_sessions: false })
      const p = res.profiles.find((x) => x.name === agentId)
      if (!p) throw new Error(`No agent “${agentId}”`)
      return toAgent(p)
    },
  })
  const routines = useRoutines(agent.data?.id)
  const runs = useRoutineRuns(agent.data?.id)
  const [view, setView] = useState<RoutinesSheetView | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open || view || !agent.data) return
    if (openParam.startsWith('detail:first') && !routines.data) return
    const v = viewFor(openParam, routines.data?.[0]?.id)
    if (v) {
      setView(v)
      setOpen(true)
    }
  }, [agent.data, routines.data, open, view])

  if (agent.isPending) {
    return (
      <div className="flex h-dvh items-center justify-center text-ink-3">
        <Spinner size={20} />
      </div>
    )
  }
  if (!agent.data) return <p className="p-6 text-ink-2">{String(agent.error)}</p>
  const a = agent.data

  return (
    <div
      className="hue-scope mx-auto max-w-md px-5 pt-[max(24px,env(safe-area-inset-top))] pb-10"
      style={{ '--hue': a.hue } as CSSProperties}
    >
      <div className="flex flex-col items-center pt-6 text-center">
        <Buddy hue={a.hue} size={80} seed={a.id} />
        <p className="mt-4 text-title font-semibold tracking-[-0.02em]">{a.name}</p>
        {a.role && <p className="mt-0.5 text-subhead text-ink-2">{a.role}</p>}
      </div>

      <section className="mt-8">
        <RoutinesRow
          agent={a}
          onOpen={() => {
            setView({ page: 'list' })
            setOpen(true)
          }}
        />
      </section>

      <section className="mt-8">
        <h3 className="mb-2 px-4 text-footnote font-medium text-ink-2">Chats</h3>
        {!runs.data?.length ? (
          <p className="rounded-xl bg-fill-1 px-4 py-6 text-center text-subhead text-ink-3">No chats yet.</p>
        ) : (
          <ul className="overflow-hidden rounded-xl bg-fill-1">
            {runs.data.slice(0, 6).map((r) => (
              <li
                key={r.id}
                className="flex min-h-15 items-center px-4 py-2.5 [&+&]:shadow-[inset_0_0.5px_0_var(--line)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body">{r.routineName}</span>
                  <span className="block truncate text-footnote text-ink-3">
                    Routine · {capitalize(relativeDate(r.at, { withTime: true }))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RoutinesSheet
        agent={a}
        open={open}
        onOpenChange={setOpen}
        initialView={view ?? undefined}
        onOpenRun={(id) => console.info('open run', id)}
      />
    </div>
  )
}
