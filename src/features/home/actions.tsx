import { useQueryClient } from '@tanstack/react-query'
import { useState, type CSSProperties } from 'react'
import { useLocation } from 'wouter'
import { toast } from 'sonner'
import { AgentEditorSheet, type AgentDraft } from '@/features/agents/agent-editor'
import { NewGroupSheet } from '@/features/agents/new-group'
import { exportWithToast, useImportAgent } from '@/features/agents/import-agent'
import { NewAgentSheet } from '@/features/templates/new-agent-sheet'
import { Button } from '@/ui/button'
import { TextField } from '@/ui/field'
import { Orb, OrbStack } from '@/ui/orb'
import { Sheet } from '@/ui/sheet'
import {
  agentsKey,
  composeSoul,
  createAgent,
  deleteAgent,
  fetchSoul,
  readSoul,
  revealAgent,
  updateAgent,
  useAgents,
  type Agent,
} from '@/state/agents'
import { deleteGroup, renameGroup } from '@/state/groups'
import { HUES } from '@/lib/hues'
import { createGroup, useCanMakeGroups, type GroupRow } from './groups'

// Everything you can do to an agent from the roster, as one hook: call the
// returned actions, render `sheets` once.

type Editing = { agent: Agent; initial: AgentDraft; soul: string }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function useAgentActions() {
  const qc = useQueryClient()
  const [location, navigate] = useLocation()
  const { data: agents = [] } = useAgents()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState<Agent | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [grouping, setGrouping] = useState(false)
  const [group, setGroup] = useState<{ row: GroupRow; mode: 'rename' | 'delete' } | null>(null)
  const [groupOpen, setGroupOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [busy, setBusy] = useState(false)
  // Just made: the preview orb gets its moment before the sheet lets go.
  const [born, setBorn] = useState(false)
  const canGroup = useCanMakeGroups()
  // An agent from a file: once it's in, its page.
  const importer = useImportAgent((id) => navigate(`/agent/${id}`))

  const refresh = () => qc.invalidateQueries({ queryKey: agentsKey })
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Try again.')

  // A fresh agent gets a colour nobody else is wearing yet.
  const freeHue = HUES.find((h) => !agents.some((a) => a.hue === h)) ?? HUES[agents.length % HUES.length]

  // Creating is a small ceremony: the preview orb smiles, the sheet slips
  // away, the newcomer springs into the roster with a halo, then its chat opens.
  const create = async (draft: AgentDraft) => {
    setBusy(true)
    let id: string | undefined
    try {
      id = await createAgent({
        name: draft.name,
        hue: draft.hue,
        role: draft.role,
        soul: composeSoul(draft.name, draft.role, draft.personality, draft.custom),
        template: draft.template,
      })
      const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
      navigator.vibrate?.(10)
      setBusy(false)
      setBorn(true)
      await wait(calm ? 0 : 650)
      setCreating(false)
      await wait(calm ? 0 : 220)
      // Only now does it join the roster: in its place, with its halo.
      revealAgent(id)
      await refresh()
      await wait(calm ? 120 : 1000)
      navigate(`/chat/${id}`)
    } catch (e) {
      fail(e)
    } finally {
      if (id) revealAgent(id)
      setBusy(false)
      setBorn(false)
    }
  }

  const edit = async (agent: Agent) => {
    const soul = await fetchSoul(agent.id).catch(() => '')
    setEditing({ agent, soul, initial: { name: agent.name, hue: agent.hue, role: agent.role, ...readSoul(soul) } })
    setEditOpen(true)
  }

  const save = async (draft: AgentDraft) => {
    if (!editing) return
    const { agent, initial, soul } = editing
    // Rewrite SOUL.md only when it's ours or the personality changed, so a
    // hand-written one (like the main agent's) survives a rename.
    const ours = soul.startsWith('# ')
    const touched = draft.personality !== initial.personality || draft.custom !== initial.custom
    const nextSoul = composeSoul(draft.name, draft.role, draft.personality, draft.custom)
    setBusy(true)
    try {
      await updateAgent(agent, {
        name: draft.name,
        hue: draft.hue,
        role: draft.role,
        soul: ours || touched ? nextSoul : undefined,
      })
      await refresh()
      setEditOpen(false)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const askDelete = (agent: Agent) => {
    if (agent.isDefault) return
    setDeleting(agent)
    setDeleteOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteAgent(deleting)
      // Its chats and its page are gone with it.
      if (location.startsWith(`/chat/${deleting.id}`) || location === `/agent/${deleting.id}`) navigate('/', { replace: true })
      qc.setQueryData<Agent[]>(agentsKey, (list) => list?.filter((a) => a.id !== deleting.id))
      qc.removeQueries({ queryKey: ['chats', deleting.id] })
      setDeleteOpen(false)
      void refresh()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const makeGroup = async (group: { name?: string; memberIds: string[] }) => {
    setBusy(true)
    try {
      const id = await createGroup(group)
      if (!id) return
      setGrouping(false)
      navigate(`/group/${id}`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const askGroup = (row: GroupRow, mode: 'rename' | 'delete') => {
    setGroup({ row, mode })
    setGroupName(row.name)
    setGroupOpen(true)
  }

  const saveGroupName = async () => {
    if (!group) return
    const name = groupName.trim()
    if (!name || name === group.row.name) return setGroupOpen(false)
    setBusy(true)
    try {
      await renameGroup(group.row.id, name)
      setGroupOpen(false)
    } catch {
      toast.error('Couldn’t rename the group. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const confirmDeleteGroup = async () => {
    if (!group) return
    setBusy(true)
    try {
      await deleteGroup(group.row.id)
      if (location.startsWith(`/group/${group.row.id}`)) navigate('/', { replace: true })
      setGroupOpen(false)
    } catch {
      toast.error('Couldn’t delete the group. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const sheets = (
    <>
      <NewAgentSheet
        open={creating}
        onOpenChange={setCreating}
        defaultHue={freeHue}
        takenNames={agents.map((a) => a.name)}
        takenIds={agents.map((a) => a.id)}
        onSubmit={create}
        submitting={busy}
        born={born}
        onImport={() => {
          setCreating(false)
          importer.pick()
        }}
      />
      {importer.input}
      <AgentEditorSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={editing?.initial}
        seed={editing?.agent.id}
        names={agents.map((a) => a.name)}
        onSubmit={save}
        submitting={busy}
        onExport={editing ? () => exportWithToast(editing.agent) : undefined}
        onDelete={
          editing && !editing.agent.isDefault
            ? () => {
                setEditOpen(false)
                askDelete(editing.agent)
              }
            : undefined
        }
      />
      <NewGroupSheet
        open={grouping}
        onOpenChange={setGrouping}
        agents={agents}
        onCreate={makeGroup}
        submitting={busy}
      />
      <Sheet
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${deleting?.name ?? 'agent'}?`}
        hideTitle
        width={380}
      >
        {deleting && (
          <div
            className="hue-scope flex flex-col items-center pt-2 text-center"
            style={{ '--hue': deleting.hue } as CSSProperties}
          >
            <Orb hue={deleting.hue} size={64} seed={deleting.id} />
            <p aria-hidden className="mt-4 w-full text-title font-semibold tracking-[-0.02em] text-balance [overflow-wrap:anywhere]">
              Delete {deleting.name}?
            </p>
            <p className="mt-1 text-subhead text-pretty text-ink-2">Its chats and memory will be gone for good.</p>
            <div className="mt-7 w-full space-y-2">
              <Button variant="danger" size="lg" loading={busy} onClick={confirmDelete}>
                Delete
              </Button>
              <Button variant="ghost" size="lg" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Sheet>
      <Sheet
        open={groupOpen}
        onOpenChange={setGroupOpen}
        title={group?.mode === 'rename' ? 'Rename group' : `Delete ${group?.row.name ?? 'group'}?`}
        hideTitle={group?.mode === 'delete'}
        width={380}
      >
        {group?.mode === 'rename' && (
          <form
            className="flex flex-col items-center pt-1"
            onSubmit={(e) => {
              e.preventDefault()
              void saveGroupName()
            }}
          >
            <span className="[&_.buddy]:block">
              <OrbStack hues={group.row.memberHues} seeds={group.row.memberIds} size={64} />
            </span>
            <TextField
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              maxLength={60}
              autoComplete="off"
              aria-label="Group name"
              autoFocus
              className="mt-6 text-center"
            />
            <div className="mt-5 w-full">
              <Button type="submit" variant="accent" size="lg" loading={busy} disabled={!groupName.trim()}>
                Save
              </Button>
            </div>
          </form>
        )}
        {group?.mode === 'delete' && (
          <div className="flex flex-col items-center pt-2 text-center">
            <span className="[&_.buddy]:block">
              <OrbStack hues={group.row.memberHues} seeds={group.row.memberIds} size={64} />
            </span>
            <p aria-hidden className="mt-4 w-full text-title font-semibold tracking-[-0.02em] text-balance [overflow-wrap:anywhere]">
              Delete {group.row.name}?
            </p>
            <p className="mt-1 text-subhead text-pretty text-ink-2">The conversation will be gone for good. Your agents stay.</p>
            <div className="mt-7 w-full space-y-2">
              <Button variant="danger" size="lg" loading={busy} onClick={confirmDeleteGroup}>
                Delete
              </Button>
              <Button variant="ghost" size="lg" onClick={() => setGroupOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  )

  return {
    newAgent: () => setCreating(true),
    /** Only when groups are possible here. */
    newGroup: canGroup ? () => setGrouping(true) : undefined,
    renameGroup: (row: GroupRow) => askGroup(row, 'rename'),
    removeGroup: (row: GroupRow) => askGroup(row, 'delete'),
    edit: (agent: Agent) => void edit(agent),
    remove: askDelete,
    sheets,
  }
}
