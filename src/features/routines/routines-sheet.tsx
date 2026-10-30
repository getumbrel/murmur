import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet } from '@/ui/sheet'
import { Button } from '@/ui/button'
import { Buddy } from '@/ui/buddy'
import { Grow } from '@/ui/grow'
import { Spinner } from '@/ui/spinner'
import type { Agent } from '@/state/agents'
import { useBlueprints, useRoutineActions, useRoutines, type Routine } from '@/state/routines'
import { useAgentTimezone } from '@/state/timezone'
import { RoutineItem } from './routine-item'
import { NewRoutineSheet, type NewRoutineView } from './new-routine'
import { RoutineDetailSheet } from './routine-detail'
import { tiles } from './templates'
import { Glyph } from './glyph'
import { useIsWide } from '@/lib/use-media'
import { GatewayOff } from '@/features/hermes-gateway/gateway-off'

export type RoutinesSheetView =
  { page: 'list' } | { page: 'new'; start?: NewRoutineView } | { page: 'detail'; id: string }

type Props = {
  agent: Agent
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Open a routine's run as a chat. Without it, results are read in place only. */
  onOpenRun?: (runId: string) => void
  /** Land somewhere specific when opening (deep links, screenshots). */
  initialView?: RoutinesSheetView
}

/** An agent's routines: what it does on its own, when, and a way to add more. */
export function RoutinesSheet({ agent, open, onOpenChange, onOpenRun, initialView }: Props) {
  const routines = useRoutines(open ? agent.id : undefined, { live: open })
  // Make sure this agent schedules on local time before anything is added.
  useAgentTimezone(open ? agent.id : undefined)
  const actions = useRoutineActions(agent.id)
  // Warm the template gallery, so "New routine" opens on it rather than a spinner.
  useBlueprints(open ? agent.id : undefined)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [adding, setAdding] = useState<NewRoutineView | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [born, setBorn] = useState<string | null>(null)
  // On wide screens a dialog never stacks on a dialog: this one steps aside
  // while a routine (or a new one) has the floor, and comes back after.
  const wide = useIsWide()
  const aside = wide && (adding !== null || detail !== null)

  useEffect(() => {
    if (!open) return
    setRevealed(null)
    setAdding(initialView?.page === 'new' ? (initialView.start ?? { page: 'pick' }) : null)
    setDetail(initialView?.page === 'detail' ? initialView.id : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const runNow = (r: Routine) => {
    const id = toast.loading(`${agent.name} is working on “${r.name}”…`)
    actions.runNow(r).then(
      () =>
        toast.success(`${r.name} is ready`, {
          id,
          action: { label: 'See it', onClick: () => setDetail(r.id) },
        }),
      () => toast.error(`${agent.name} couldn’t run that just now. Try again in a moment.`, { id }),
    )
  }

  const remove = (r: Routine) => {
    setRevealed(null)
    actions.remove(r).then(
      () => toast(`Deleted “${r.name}”`),
      () => toast.error('Couldn’t delete that routine. Try again.'),
    )
  }

  const list = routines.data ?? []

  return (
    <>
      <Sheet
        open={open && !aside}
        onOpenChange={onOpenChange}
        title="Routines"
        description={`Things ${agent.name} does on its own, on a schedule.`}
      >
        <Grow className="hue-scope" style={{ '--hue': agent.hue } as CSSProperties}>
          <GatewayOff
            agentId={agent.id}
            title="Routines won’t run"
            className="mb-4"
          />
          {routines.isPending ? (
            <div className="flex justify-center py-12 text-ink-3">
              <Spinner size={20} />
            </div>
          ) : !list.length ? (
            <Empty agent={agent} onAdd={(start) => setAdding(start ?? { page: 'pick' })} />
          ) : (
            <>
              <ul className="overflow-hidden rounded-xl bg-fill-1">
                <AnimatePresence initial={false}>
                  {list.map((r) => (
                    <RoutineItem
                      key={r.id}
                      routine={r}
                      born={born === r.id}
                      revealed={revealed === r.id}
                      onReveal={(on) => setRevealed(on ? r.id : null)}
                      onOpen={() => setDetail(r.id)}
                      onToggle={(on) =>
                        actions.setEnabled(r, on).catch(() => toast.error('Couldn’t change that. Try again.'))
                      }
                      onRunNow={() => runNow(r)}
                      onDelete={() => remove(r)}
                    />
                  ))}
                </AnimatePresence>
              </ul>
              <p className="mt-2 px-4 text-footnote text-pretty text-ink-3 [@media(hover:hover)_and_(pointer:fine)]:hidden">
                Swipe left on a routine to run it now or delete it.
              </p>
              <Button variant="secondary" size="lg" className="mt-6" onClick={() => setAdding({ page: 'pick' })}>
                <Plus size={18} strokeWidth={2.25} aria-hidden />
                New routine
              </Button>
            </>
          )}
        </Grow>
      </Sheet>

      <NewRoutineSheet
        agent={agent}
        open={open && adding !== null}
        initialView={adding ?? undefined}
        onOpenChange={(o) => !o && setAdding(null)}
        onCreated={(id) => {
          // Once the sheet above has gone, so the welcome is actually seen.
          setTimeout(() => setBorn(id), 300)
          setTimeout(() => setBorn((b) => (b === id ? null : b)), 2000)
        }}
      />
      <RoutineDetailSheet
        agent={agent}
        routineId={detail ?? undefined}
        open={open && detail !== null}
        onOpenChange={(o) => !o && setDetail(null)}
        onOpenRun={
          onOpenRun
            ? (runId) => {
                setDetail(null)
                onOpenChange(false)
                onOpenRun(runId)
              }
            : undefined
        }
      />
    </>
  )
}

/** Nothing yet: the agent, a promise, and three one-tap starting points. */
function Empty({ agent, onAdd }: { agent: Agent; onAdd: (start?: NewRoutineView) => void }) {
  const reduce = useReducedMotion()
  const blueprints = useBlueprints(agent.id)
  const picks = useMemo(
    () => tiles(blueprints.data, blueprints.isError).slice(0, 3),
    [blueprints.data, blueprints.isError],
  )
  return (
    <div className="pb-1">
      <div className="flex flex-col items-center px-4 pt-2 pb-6 text-center">
        <Buddy hue={agent.hue} size={64} seed={agent.id} />
        <p className="mt-4 text-body font-medium">Nothing scheduled yet</p>
        <p className="mt-1 max-w-72 text-subhead text-balance text-ink-2">
          {agent.name} can brief you in the morning, remind you of things, or keep an eye on the news.
        </p>
      </div>
      <ul className="overflow-hidden rounded-xl bg-fill-1">
        {picks.map((t, i) => (
          <motion.li
            key={t.key}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: 0.06 + i * 0.04 }}
            className="[&+&]:shadow-[inset_0_0.5px_0_var(--line)]"
          >
            <button
              type="button"
              onClick={() => onAdd({ page: 'template', key: t.key })}
              className="flex min-h-15 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-fill-1 active:bg-fill-2"
            >
              <Glyph icon={t.icon} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block text-body">{t.title}</span>
                <span className="line-clamp-2 text-footnote text-ink-2">{t.description}</span>
              </span>
              <Plus size={18} strokeWidth={2} className="flex-none text-accent" aria-hidden />
            </button>
          </motion.li>
        ))}
      </ul>
      <Button variant="accent" size="lg" className="mt-6" onClick={() => onAdd()}>
        <Plus size={18} strokeWidth={2.25} aria-hidden />
        New routine
      </Button>
    </div>
  )
}
