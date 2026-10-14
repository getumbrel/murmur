import { useId, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Sheet } from '@/ui/sheet'
import { Button } from '@/ui/button'
import { TextField } from '@/ui/field'
import { ListGroup, ListRow } from '@/ui/list'
import { Buddy } from '@/ui/buddy'
import { Grow } from '@/ui/grow'
import { ConfirmCard } from '@/ui/confirm-card'
import type { Group } from '@/state/groups'
import { MemberRow } from './member-row'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: Group
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  onOpenMember: (id: string) => void
}

/** Who's in the group, its name, and the way out. */
export function GroupSheet({ open, onOpenChange, group, onRename, onDelete, onOpenMember }: Props) {
  const [name, setName] = useState(group.name)
  const [saving, setSaving] = useState(false)
  const nameId = useId()

  // Fresh each time it opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(group.name)
    }
  }

  const changed = name.trim() && name.trim() !== group.name

  const rename = async () => {
    if (!changed) return
    setSaving(true)
    try {
      await onRename(name.trim())
    } catch {
      toast.error('Couldn’t rename the group. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      await onDelete()
    } catch (e) {
      toast.error('Couldn’t delete the group. Try again.')
      throw e
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={group.name} hideTitle>
      <Grow>
        <div className="flex flex-col items-center pt-2 text-center">
          <MemberRow members={group.members} size={60} max={6} />
          <p
            className="mt-4 line-clamp-2 max-w-full px-4 text-title font-semibold tracking-[-0.02em] text-balance break-words"
            title={group.name}
          >
            {group.name}
          </p>
          <p className="mt-0.5 text-subhead text-ink-2">{group.members.length} agents</p>
        </div>

        <form
          className="mt-7"
          onSubmit={(e) => {
            e.preventDefault()
            void rename()
          }}
        >
          {/* Inset like the Members heading below, so both line up with the text they label. */}
          <label htmlFor={nameId} className="mb-2 block px-4 text-footnote font-medium text-ink-2">
            Group name
          </label>
          <div className="flex">
            <TextField
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoComplete="off"
              id={nameId}
              className="flex-1"
            />
            <AnimatePresence initial={false}>
              {changed && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.92, width: 0 }}
                  animate={{ opacity: 1, scale: 1, width: 'auto' }}
                  exit={{ opacity: 0, scale: 0.92, width: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                  // The gap lives inside, so it closes with the button.
                  className="flex flex-none items-center overflow-hidden pl-2"
                >
                  <Button type="submit" variant="accent" className="h-12" loading={saving}>
                    Save
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </form>

        <ListGroup title="Members" className="mt-7" footer="To change who’s here, start a new group.">
          {group.members.map((m) => (
            <ListRow
              key={m.id}
              icon={<Buddy hue={m.hue} size={28} seed={m.id} />}
              title={m.name}
              subtitle={m.role || undefined}
              onClick={() => onOpenMember(m.profile)}
              chevron
            />
          ))}
        </ListGroup>

        <ConfirmCard
          className="mt-7"
          label="Delete group"
          title="Delete this group?"
          body="The conversation will be gone for good. Your agents stay."
          confirm="Delete"
          onConfirm={remove}
        />
      </Grow>
    </Sheet>
  )
}
