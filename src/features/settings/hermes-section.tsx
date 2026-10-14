import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Info, Plus } from 'lucide-react'
import { Button } from '@/ui/button'
import { Label } from '@/ui/field'
import { ListGroup, ListRow } from '@/ui/list'
import { Sheet } from '@/ui/sheet'
import { Spinner } from '@/ui/spinner'
import { tabHermes } from '@/hermes/instance'
import { connectionApi, switchHermes, useHermesManager, type ConnectionRequest, type HermesConnection, type KnownHermes } from '@/state/connection'
import { HermesConnectionForm, HermesConnectionFormView, ManagedHermes } from '@/features/connection/hermes-connection-form'
import { Field } from '@/features/connection/fields'
import { hermesDetail, toneOf } from '@/features/connection/switcher'
import { StatusDot } from '@/features/connection/fields'
import { Tile } from './page'

// Settings → Server: every Hermes this Murmur knows, the way iOS lists Wi-Fi
// networks. A tap moves to that Hermes; (i) opens its details (name, address,
// password, Forget). "Add another server" connects one more and moves to it.
// Before any Hermes is set up, it's just the connection form. On screen each
// is a "server", named for its machine, so none reads like the main agent
// (whom Hermes also calls "Hermes").

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback

export function HermesSection() {
  const { list } = useHermesManager()
  const [details, setDetails] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  if (list.isPending) {
    return (
      <div className="grid min-h-40 place-items-center text-ink-3">
        <Spinner />
      </div>
    )
  }
  const connections = list.data?.connections ?? []
  // Never set up (or Murmur's own server can't say): the one form, as before.
  if (!connections.length || (connections.length === 1 && connections[0].source === 'default')) {
    return <HermesConnectionForm embedded />
  }
  const inUse = tabHermes() ?? list.data!.active
  const open = connections.find((c) => c.id === details)

  return (
    <>
      <ListGroup
        title={connections.length > 1 ? 'Your servers' : undefined}
        footer={
          connections.length > 1
            ? 'Murmur uses one server at a time. Each keeps its own agents, chats and groups.'
            : 'Running Hermes somewhere else too, like on another computer? Add it, then switch between them.'
        }
      >
        {connections.map((c) => (
          <HermesRow key={c.id} hermes={c} inUse={c.id === inUse} onDetails={() => setDetails(c.id)} />
        ))}
      </ListGroup>

      <ListGroup>
        <ListRow
          icon={
            <Tile>
              <Plus size={16} strokeWidth={2.25} />
            </Tile>
          }
          title={<span className="text-accent">Add another server</span>}
          onClick={() => setAdding(true)}
        />
      </ListGroup>

      <DetailsSheet hermes={open} inUse={open?.id === inUse} onClose={() => setDetails(null)} />
      <AddSheet open={adding} onOpenChange={setAdding} />
    </>
  )
}

/** A row: tap to use it, (i) for its details. Two buttons side by side, so the row itself isn't one. */
function HermesRow({ hermes: c, inUse, onDetails }: { hermes: KnownHermes; inUse: boolean; onDetails: () => void }) {
  const use = () => {
    if (inUse) return onDetails()
    switchHermes(c).catch((e: unknown) => toast.error(errorText(e, 'Couldn’t switch. Try again.')))
  }
  return (
    <div data-has-icon="" className="flex items-center">
      <button
        type="button"
        onClick={use}
        aria-current={inUse || undefined}
        title={inUse ? `${c.name} (in use)` : `Use ${c.name}`}
        className="flex min-h-13 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2"
      >
        <span className="flex size-7 flex-none items-center justify-center">
          <StatusDot tone={toneOf(c)} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">{c.name}</span>
          <span className="block truncate text-footnote text-ink-2">{hermesDetail(c)}</span>
        </span>
        <span className="flex w-6 flex-none justify-end">
          {inUse && <Check size={20} strokeWidth={2.25} className="text-accent" aria-label="In use" />}
        </span>
      </button>
      <button
        type="button"
        onClick={onDetails}
        aria-label={`${c.name} details`}
        title="Details"
        className="grid min-h-13 w-13 flex-none place-items-center self-stretch text-accent transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2"
      >
        <Info size={20} strokeWidth={1.75} />
      </button>
    </div>
  )
}

/** One Hermes: its name, how Murmur reaches it, and the ways out. */
function DetailsSheet({ hermes, inUse, onClose }: { hermes?: KnownHermes; inUse: boolean; onClose: () => void }) {
  // Kept while the sheet animates out.
  const [shown, setShown] = useState(hermes)
  useEffect(() => {
    if (hermes) setShown(hermes)
  }, [hermes])
  const c = hermes ?? shown
  const { update, remove } = useHermesManager()

  return (
    <Sheet
      open={!!hermes}
      onOpenChange={(o) => !o && onClose()}
      title={c?.name ?? 'Server'}
      footer={
        c && !inUse ? (
          <Button
            size="lg"
            variant="accent"
            onClick={() => {
              // Out of the way first: the sheet slides down as the curtain comes over it.
              onClose()
              switchHermes(c).catch((e: unknown) => toast.error(errorText(e, 'Couldn’t switch. Try again.')))
            }}
          >
            Use this server
          </Button>
        ) : undefined
      }
    >
      {c && (
        <div className="space-y-8 pt-1">
          <NameField hermes={c} />
          {c.managed ? (
            <ManagedHermes connection={c} />
          ) : (
            <HermesConnectionFormView
              key={c.id}
              embedded
              current={c}
              onTest={connectionApi.test}
              onSave={async (req: ConnectionRequest) => {
                const next = await update.mutateAsync({ id: c.id, ...req })
                return next.connection
              }}
              onReset={async () => {
                try {
                  await remove.mutateAsync(c.id)
                  onClose()
                } catch (e) {
                  toast.error(errorText(e, 'Couldn’t forget this server. Try again.'))
                  throw e
                }
              }}
            />
          )}
        </div>
      )}
    </Sheet>
  )
}

/** Rename in place: saved on Return or on leaving the field. */
function NameField({ hermes: c }: { hermes: KnownHermes }) {
  const { rename } = useHermesManager()
  const [name, setName] = useState(c.name)
  const [saved, setSaved] = useState(false)
  useEffect(() => setName(c.name), [c.id, c.name])
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 1600)
    return () => clearTimeout(t)
  }, [saved])

  const commit = async () => {
    const next = name.replace(/\s+/g, ' ').trim()
    if (!next) return setName(c.name)
    if (next === c.name) return
    try {
      await rename.mutateAsync({ id: c.id, name: next })
      setSaved(true)
    } catch (e) {
      setName(c.name)
      toast.error(errorText(e, 'Couldn’t rename it. Try again.'))
    }
  }

  return (
    <div>
      <Label
        hint={
          saved ? (
            <span className="inline-flex animate-fade items-center gap-1 text-ink-2">
              <Check size={12} strokeWidth={2.5} /> Saved
            </span>
          ) : undefined
        }
      >
        Name
      </Label>
      <Field
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setName(c.name)
        }}
        placeholder="Name"
        aria-label="Name"
        autoComplete="off"
        enterKeyHint="done"
      />
    </div>
  )
}

/** Connect one more, then move to it. */
function AddSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { add } = useHermesManager()
  // A fresh form every time it opens.
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (open) setRound((r) => r + 1)
  }, [open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add another server" description="Enter the address of its Hermes dashboard. Murmur checks it, then switches to it.">
      <div className="pt-1">
        <HermesConnectionFormView
          key={round}
          embedded
          onTest={connectionApi.test}
          onSave={async (req) => {
            const next = await add.mutateAsync({ ...req, activate: true })
            return next.connection
          }}
          onConnected={(connection: HermesConnection) => {
            if (!connection.id || !connection.name) return
            onOpenChange(false)
            void switchHermes({ id: connection.id, name: connection.name }, { activated: true })
          }}
        />
      </div>
    </Sheet>
  )
}
