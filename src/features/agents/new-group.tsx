import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/ui/button'
import { Label, TextField } from '@/ui/field'
import { Orb, OrbStack } from '@/ui/orb'
import { Sheet } from '@/ui/sheet'
import { cn } from '@/lib/cn'

// Pick a few agents to talk to at once.

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
      <div className="list-group overflow-hidden rounded-xl bg-fill-1">
        {agents.map((agent) => {
          const on = picked.includes(agent.id)
          const disabled = full && !on
          return (
            <button
              key={agent.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={disabled}
              onClick={() => toggle(agent.id)}
              data-has-icon=""
              className="flex min-h-13 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors select-none focus-visible:-outline-offset-2 enabled:hover:bg-fill-1 enabled:active:bg-fill-2 disabled:cursor-default"
            >
              <span className="flex size-7 flex-none items-center justify-center">
                <Orb hue={agent.hue} size={28} seed={agent.id} className={cn('transition-opacity', disabled && 'opacity-40')} />
              </span>
              <span className={cn('min-w-0 flex-1 truncate text-body', disabled && 'text-ink-3')}>{agent.name}</span>
              <span
                className={cn(
                  'grid size-6 flex-none place-items-center rounded-full transition-[background-color,box-shadow] duration-200',
                  on ? 'bg-accent text-accent-ink' : 'ring-[1.5px] ring-line-strong ring-inset',
                )}
              >
                {on && <Check size={14} strokeWidth={3} className="animate-pop" />}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 px-4 text-footnote text-ink-3">Pick {MIN} to {MAX} agents to talk with together.</p>

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

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('')
  if (names.length > 3) return `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`
  return `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`
}
