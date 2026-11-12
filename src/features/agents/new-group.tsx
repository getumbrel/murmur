import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Label, TextField } from '@/ui/field'
import { CheckRow } from '@/ui/list'
import { Orb, OrbStack } from '@/ui/orb'
import { Sheet } from '@/ui/sheet'
import { cn } from '@/lib/cn'
import { joinNames } from '@shared/groups.ts'
import { useServers } from '@/state/connection'
import { hermesOf } from '@/hermes/instance'

// Pick a few agents to talk to at once. A group's agents all live on one
// server (Hermes runs the conversation), so with several servers the list is
// one shelf per server, and picking from one sets the others aside.

export type GroupCandidate = { id: string; name: string; hue: number }

const MIN = 2
const MAX = 6

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agents: GroupCandidate[]
  onCreate: (group: { name?: string; memberIds: string[] }) => void
  submitting?: boolean
}

export function NewGroupSheet({ open, onOpenChange, agents, onCreate, submitting }: Props) {
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')

  // Start fresh each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setPicked([])
      setName('')
    }
  }

  const members = picked.map((id) => agents.find((a) => a.id === id)!).filter(Boolean)
  const full = picked.length >= MAX
  const ready = picked.length >= MIN

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX ? [...p, id] : p))

  // With several servers: a shelf for each that has agents to pick, and the group stays on the first one picked from.
  const servers = useServers()
  const shelves = servers
    .map((server) => ({ server, agents: agents.filter((a) => hermesOf(a.id) === server.id) }))
    .filter((shelf) => shelf.agents.length)
  const several = shelves.length > 1
  const home = picked.length ? hermesOf(picked[0]) : undefined
  const row = (agent: GroupCandidate) => {
    const on = picked.includes(agent.id)
    const disabled = (full && !on) || (home !== undefined && hermesOf(agent.id) !== home)
    return (
      <CheckRow
        key={agent.id}
        on={on}
        disabled={disabled}
        onToggle={() => toggle(agent.id)}
        icon={<Orb hue={agent.hue} size={28} seed={agent.id} className={cn('transition-opacity', disabled && 'opacity-40')} />}
        title={agent.name}
      />
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="New group" footer={
      <Button
        size="lg"
        variant="accent"
        disabled={!ready}
        loading={submitting}
        onClick={() => onCreate({ name: name.trim() || undefined, memberIds: picked })}
      >
        {ready ? 'Create group' : `Pick ${MIN - picked.length} more`}
      </Button>
    }>
      <div className="flex flex-col items-center pt-2 pb-6">
        <div className="grid size-20 place-items-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={members.map((m) => m.id).slice(0, 3).join() || 'empty'}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              // BuddyStack nests buddies in plain spans; make them blocks so they size.
              className="flex [&_.buddy]:block"
            >
              {members.length === 0 ? (
                <span className="block size-14 rounded-full border-[1.5px] border-dashed border-line-strong" />
              ) : members.length === 1 ? (
                <Orb hue={members[0].hue} size={56} seed={members[0].id} />
              ) : (
                <OrbStack hues={members.map((m) => m.hue)} seeds={members.map((m) => m.id)} size={80} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <p
          className={cn(
            'mt-3 h-6 max-w-full truncate text-body font-semibold tracking-[-0.015em]',
            !members.length && 'font-normal text-ink-3',
          )}
        >
          {name.trim() || (members.length ? joinNames(members.map((m) => m.name)) : 'Nobody yet')}
        </p>
      </div>

      <Label hint={<span className="tabular-nums">{`${picked.length} of ${MAX}`}</span>}>Members</Label>
      {/* The shared grouped list (src/ui/list.tsx): inset separators, a 28px icon gutter. */}
      {several ? (
        <div className="space-y-4">
          {shelves.map(({ server, agents }) => (
            <div key={server.id} role="group" aria-label={server.name}>
              <p
                className={cn(
                  'px-4 pb-1.5 text-footnote transition-colors duration-300',
                  home === undefined || home === server.id ? 'text-ink-2' : 'text-ink-3',
                )}
              >
                {server.name}
              </p>
              <div className="list-group overflow-hidden rounded-xl bg-fill-1">{agents.map(row)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="list-group overflow-hidden rounded-xl bg-fill-1">{agents.map(row)}</div>
      )}
      <p className="mt-2 px-4 text-footnote text-ink-3">
        {several ? (
          `Pick ${MIN} to ${MAX} agents on one server to talk with together.`
        ) : (
          // Written as it always was: one string would set a hair differently.
          <>
            Pick {MIN} to {MAX} agents to talk with together.
          </>
        )}
      </p>

      <div className="mt-7">
        <Label hint="Optional">Group name</Label>
        <TextField
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={members.length >= MIN ? joinNames(members.map((m) => m.name)) : 'Weekend planning'}
          maxLength={40}
          autoComplete="off"
        />
      </div>
    </Sheet>
  )
}
