import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/ui/button'
import { Label, TextField } from '@/ui/field'
import { CheckRow } from '@/ui/list'
import { Buddy, BuddyStack } from '@/ui/buddy'
import { Sheet } from '@/ui/sheet'
import { cn } from '@/lib/cn'
import { sectionOf, type Section } from '@/state/sections'
import type { Agent } from '@/state/agents'
import type { GroupRow } from './groups'

// Name a section and pick who's on it. The top of the sheet is the section
// itself, as it will sit in your list: its name, then the agents you pick,
// arriving as you tick them. A group's sheet shows a huddle; this shows a shelf.

export type SectionDraft = { name: string; agents: string[]; groups: string[] }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing this one; otherwise a new section. */
  section?: Section
  /** Ticked when it opens (the agent whose menu it came from, or the section's members). */
  initial: { agents: string[]; groups: string[] }
  agents: Agent[]
  groups: GroupRow[]
  sections: Section[]
  onSave: (draft: SectionDraft, into?: Section) => void
  submitting?: boolean
}

const spring = { type: 'spring', stiffness: 460, damping: 36 } as const

export function SectionSheet({
  open,
  onOpenChange,
  section,
  initial,
  agents,
  groups,
  sections,
  onSave,
  submitting,
}: Props) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [pickedGroups, setPickedGroups] = useState<string[]>([])

  // Start from what it was opened with, each time.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(section?.name ?? '')
      setPicked(initial.agents)
      setPickedGroups(initial.groups)
    }
  }

  const where = (id?: string) => sections.find((s) => s.id === id)
  const groupHome = (id: string) => sections.find((s) => s.groups?.includes(id))
  // A name you already have: a new section files them there instead of making a twin, and a renamed one can't take it.
  const twin = sections.find((s) => s.id !== section?.id && s.name.toLowerCase() === name.trim().toLowerCase())
  const members = picked.map((id) => agents.find((a) => a.id === id)!).filter(Boolean)
  const shelf = [
    ...members.map((a) => ({ key: a.id, name: a.name, face: <Buddy hue={a.hue} size={28} seed={a.id} /> })),
    ...pickedGroups.flatMap((id) => {
      const g = groups.find((x) => x.id === id)
      return g
        ? [
            {
              key: `group:${g.id}`,
              name: g.name,
              face: <BuddyStack hues={g.memberHues} seeds={g.memberIds} size={28} />,
            },
          ]
        : []
    }),
  ]
  const count = shelf.length
  // An edited section can be emptied and still renamed; a new one starts with someone in it.
  const ready = name.trim().length > 0 && (section ? !twin : count > 0)

  // Who's here already, then whoever is on no shelf yet (the likely picks), then the rest by where they are now.
  const rank = (place?: string) =>
    place === section?.id && section ? 0 : !where(place) ? 1 : 2 + sections.findIndex((s) => s.id === place)
  const listed = [...agents].sort((a, b) => rank(sectionOf(a)) - rank(sectionOf(b)))
  const listedGroups = [...groups].sort((a, b) => rank(groupHome(a.id)?.id) - rank(groupHome(b.id)?.id))

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const toggleGroup = (id: string) => setPickedGroups((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const save = () => ready && onSave({ name: name.trim(), agents: picked, groups: pickedGroups }, twin)

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={section ? 'Edit section' : 'New section'}
      footer={
        <Button size="lg" variant="accent" disabled={!ready} loading={submitting} onClick={save}>
          {section ? 'Save' : twin ? `Move to ${twin.name}` : 'Create section'}
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Shelf name={name.trim() || section?.name || ''} rows={shelf} />

        <div className="mt-6">
          <Label hint={twin ? `You have a ${twin.name} section` : undefined}>Name</Label>
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Clients"
            maxLength={32}
            autoComplete="off"
            autoFocus={!section}
            enterKeyHint="done"
          />
        </div>

        <div className="mt-7">
          <Label hint={count ? <span className="tabular-nums">{count}</span> : undefined}>In this section</Label>
          <div className="list-group overflow-hidden rounded-xl bg-fill-1">
            {/* Where each is now, when it's another section: ticking it moves it here. */}
            {listed.map((agent) => (
              <CheckRow
                key={agent.id}
                on={picked.includes(agent.id)}
                onToggle={() => toggle(agent.id)}
                icon={<Buddy hue={agent.hue} size={28} seed={agent.id} />}
                title={agent.name}
                detail={sectionOf(agent) !== section?.id ? where(sectionOf(agent))?.name : undefined}
              />
            ))}
            {listedGroups.map((group) => (
              <CheckRow
                key={group.id}
                on={pickedGroups.includes(group.id)}
                onToggle={() => toggleGroup(group.id)}
                icon={<BuddyStack hues={group.memberHues} seeds={group.memberIds} size={28} />}
                title={group.name}
                detail={groupHome(group.id)?.id !== section?.id ? groupHome(group.id)?.name : undefined}
              />
            ))}
          </div>
        </div>
      </form>
    </Sheet>
  )
}

/** The section as your list will show it, filling in as you pick. */
function Shelf({ name, rows }: { name: string; rows: { key: string; name: string; face: React.ReactNode }[] }) {
  const shown = rows.slice(0, 3)
  const more = rows.length - shown.length
  return (
    <div
      aria-hidden
      className="mx-auto w-full max-w-[17rem] rounded-2xl bg-fill-1 p-1.5 ring-[0.5px] ring-line ring-inset"
    >
      <div className="flex h-7 items-center justify-between gap-2 px-2.5">
        <span className={cn('truncate text-caption font-semibold', name ? 'text-ink-2' : 'text-ink-3')}>
          {name || 'New section'}
        </span>
        <ChevronDown size={13} strokeWidth={2.25} className="flex-none text-ink-3" />
      </div>
      <motion.ul layout transition={spring}>
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((row) => (
            <motion.li
              key={row.key}
              layout="position"
              initial={{ opacity: 0, scale: 0.9, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.14 } }}
              transition={spring}
              className="flex h-10 items-center gap-2.5 rounded-lg bg-elevated/60 px-2 [&+&]:mt-0.5 [&_.buddy]:block"
            >
              <span className="flex size-7 flex-none items-center justify-center">{row.face}</span>
              <span className="truncate text-footnote font-semibold tracking-[-0.01em]">{row.name}</span>
            </motion.li>
          ))}
          {/* Room for more, until there are three: the shelf fills in as you pick. */}
          {Array.from({ length: 3 - shown.length }, (_, i) => (
            <motion.li
              key={`room-${shown.length + i}`}
              layout="position"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              className="flex h-10 items-center gap-2.5 px-2 [&+&]:mt-0.5"
            >
              <span className="size-7 flex-none rounded-full border-[1.5px] border-dashed border-line-strong opacity-70" />
              <span className={cn('h-2.5 rounded-full bg-fill-2', (shown.length + i) % 2 ? 'w-14' : 'w-20')} />
            </motion.li>
          ))}
          {more > 0 && (
            <motion.li
              key="more"
              layout="position"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-2.5 pt-1.5 pb-0.5 text-caption text-ink-3"
            >
              and {more} more
            </motion.li>
          )}
        </AnimatePresence>
      </motion.ul>
    </div>
  )
}
