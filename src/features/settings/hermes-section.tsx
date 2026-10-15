import { useEffect, useState } from 'react'
import { LayoutGroup, motion } from 'motion/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Info, Plus, Server } from 'lucide-react'
import { Button } from '@/ui/button'
import { Buddy, BuddyStack } from '@/ui/buddy'
import { Label } from '@/ui/field'
import { ListGroup, ListRow } from '@/ui/list'
import { Sheet } from '@/ui/sheet'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import { tabHermes } from '@/hermes/instance'
import {
  connectionApi,
  connectionsKey,
  switchHermes,
  useHermesManager,
  type ConnectionRequest,
  type HermesConnection,
  type KnownHermes,
} from '@/state/connection'
import { addFoundHermes, BUILTIN_ID, fetchSetup, orderedAgents, plural, setupKey, type FoundHermes, type Setup } from '@/state/setup'
import {
  CurrentStatus,
  HermesConnectionForm,
  HermesConnectionFormView,
  ManagedHermes,
  isBuiltinHermes,
  isUmbrelHermes,
  useOnUmbrel,
} from '@/features/connection/hermes-connection-form'
import { Field } from '@/features/connection/fields'
import { hermesDetail, toneOf } from '@/features/connection/switcher'
import { StatusDot } from '@/features/connection/fields'
import { agentHue } from '@/features/onboarding/setup-copy'
import { ask } from './ask'
import { Tile } from './page'

// Settings → Server: every Hermes this Murmur knows, the way iOS lists Wi-Fi
// networks. A tap moves to that Hermes; (i) opens its details (name, address,
// password, Forget). "Add another server" connects one more and moves to it.
// Before any Hermes is set up, it's just the connection form. On screen each
// is a "server", named for where it is ("Built-in", "Hermes Agent", a host),
// so none reads like the main agent (whom Hermes also calls "Hermes").
// Under them, what Murmur found but hasn't added (the Hermes Agent app, or the
// built-in before it's been used) waits with an Add pill.

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback

/** What Murmur found and how the built-in is doing; it changes rarely, so it's kept for a while. */
function useSetupHere() {
  return useQuery({ queryKey: setupKey, queryFn: fetchSetup, staleTime: 30_000, retry: false })
}

export function HermesSection() {
  const { list } = useHermesManager()
  const setup = useSetupHere().data
  const [details, setDetails] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ url?: string } | null>(null)
  // Just added: their suggestion rows leave as their server rows arrive (the same row, moving).
  const [moved, setMoved] = useState<Record<string, string>>({})

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
  const starting = setup?.builtin?.state === 'starting'
  const takenFound = new Set(Object.values(moved))

  return (
    <LayoutGroup>
      <ListGroup
        title={connections.length > 1 ? 'Your servers' : undefined}
        footer={
          connections.length > 1
            ? 'Murmur uses one server at a time. Each keeps its own agents, chats and groups.'
            : 'Running Hermes somewhere else too, like on another computer? Add it, then switch between them.'
        }
      >
        {connections.map((c) => (
          <motion.div key={c.id} layoutId={`hermes-${moved[c.id] ?? c.id}`} transition={{ type: 'spring', duration: 0.35, bounce: 0 }} data-has-icon="">
            <HermesRow hermes={c} inUse={c.id === inUse} starting={isBuiltinHermes(c) && starting} onDetails={() => setDetails(c.id)} />
          </motion.div>
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
          onClick={() => setAdding({})}
        />
      </ListGroup>


      {setup && (
        <Suggestions
          setup={setup}
          added={connections}
          hidden={takenFound}
          onAdded={(foundId, connection) => setMoved((m) => ({ ...m, [connection]: foundId }))}
          onNeedsPassword={(url) => setAdding({ url })}
        />
      )}

      <DetailsSheet hermes={open} inUse={open?.id === inUse} starting={starting} onClose={() => setDetails(null)} />
      <AddSheet open={!!adding} prefill={adding?.url} onOpenChange={(o) => !o && setAdding(null)} />
    </LayoutGroup>
  )
}

// ── Found, not added ────────────────────────────────────────────────────────

type Suggestion = { kind: 'found'; hermes: FoundHermes } | { kind: 'builtin' }

/** "Found on this Umbrel": a Hermes Murmur found, or the built-in before it's been used, one tap from being added. */
function Suggestions({
  setup,
  added,
  hidden,
  onAdded,
  onNeedsPassword,
}: {
  setup: Setup
  added: KnownHermes[]
  /** Found ids just added here, while the server catches up. */
  hidden: Set<string>
  onAdded: (foundId: string, connectionId: string) => void
  onNeedsPassword: (url: string) => void
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const items: Suggestion[] = [
    ...setup.found.filter((f) => !hidden.has(f.id) && !added.some((c) => c.url === f.url)).map((hermes) => ({ kind: 'found' as const, hermes })),
    ...(setup.builtin && !setup.builtin.added && !hidden.has(BUILTIN_ID) && !added.some(isBuiltinHermes) ? [{ kind: 'builtin' as const }] : []),
  ]
  if (!items.length) return null

  const umbrelOnly = items.every((s) => s.kind === 'builtin' || s.hermes.where === 'umbrel') && (setup.umbrel || items.some((s) => s.kind === 'found'))
  const builtinOnly = items.every((s) => s.kind === 'builtin')
  const title = builtinOnly ? 'Start fresh' : umbrelOnly ? 'Found on this Umbrel' : 'Found nearby'
  const one = items.length === 1 && items[0].kind === 'found' ? items[0].hermes : undefined
  const footer = builtinOnly
    ? 'A Hermes that comes with Murmur, for a separate set of agents.'
    : one
      ? one.where === 'umbrel'
        ? 'Your Hermes Agent app. Add it to switch between its agents and these.'
        : 'Add it to switch between its agents and these.'
      : 'Add one to switch between them.'

  const add = async (id: string, name: string) => {
    if (busy) return
    setBusy(id)
    try {
      const result = await addFoundHermes(id)
      if (!result.ok) {
        if (result.reason === 'failed' && result.connection.status === 'needs-login') {
          const f = setup.found.find((x) => x.id === id)
          if (f) onNeedsPassword(f.url)
          return
        }
        if (result.reason === 'gone') void qc.invalidateQueries({ queryKey: setupKey })
        toast.error(result.reason === 'failed' ? (result.connection.error ?? `Couldn’t add ${name}. Try again.`) : result.reason === 'gone' ? result.error : `Couldn’t add ${name}. Try again.`)
        return
      }
      const connection = result.connection
      // One render: the suggestion goes, its server row arrives in its place, and they spring as one.
      onAdded(id, connection.id)
      qc.setQueryData(connectionsKey, { active: result.active, connections: result.connections })
      void qc.invalidateQueries({ queryKey: setupKey })
      toast(`Added ${connection.name}`, {
        action: {
          label: 'Switch',
          onClick: () => void switchHermes(connection).catch((e: unknown) => toast.error(errorText(e, 'Couldn’t switch. Try again.'))),
        },
      })
    } catch (e) {
      toast.error(errorText(e, `Couldn’t add ${name}. Try again.`))
    } finally {
      setBusy(null)
    }
  }

  return (
    <ListGroup title={title} footer={footer}>
      {items.map((s) =>
        s.kind === 'builtin' ? (
          <motion.div key={BUILTIN_ID} layoutId={`hermes-${BUILTIN_ID}`} transition={{ type: 'spring', duration: 0.35, bounce: 0 }} data-has-icon="">
            <ListRow
              icon={<Buddy hue={278} size={28} seed="builtin" />}
              title="Built-in"
              subtitle="Comes with Murmur · A clean slate"
              trailing={<AddPill label="Add Built-in" busy={busy === BUILTIN_ID} onClick={() => void add(BUILTIN_ID, 'Built-in')} />}
            />
          </motion.div>
        ) : (
          <motion.div key={s.hermes.id} layoutId={`hermes-${s.hermes.id}`} transition={{ type: 'spring', duration: 0.35, bounce: 0 }} data-has-icon="">
            <FoundRow
              hermes={s.hermes}
              busy={busy === s.hermes.id}
              onAdd={() => (s.hermes.needsSignIn ? onNeedsPassword(s.hermes.url) : void add(s.hermes.id, s.hermes.name))}
            />
          </motion.div>
        ),
      )}
    </ListGroup>
  )
}

function FoundRow({ hermes: f, busy, onAdd }: { hermes: FoundHermes; busy: boolean; onAdd: () => void }) {
  const agents = orderedAgents(f).slice(0, 3)
  const count = Math.max(f.agentCount ?? 0, f.agents?.length ?? 0)
  const subtitle = f.outdated ? (
    <>
      <span className="font-medium text-warning">Needs an update</span>
      {f.version && ` · Hermes ${f.version}`}
    </>
  ) : f.needsSignIn ? (
    `Needs a password · ${f.host}`
  ) : (
    [count > 0 && plural(count, 'agent'), f.chats ? plural(f.chats, 'chat') : null].filter(Boolean).join(' · ') || (f.where === 'umbrel' ? 'On this Umbrel' : f.host)
  )
  const icon = agents.length ? (
    <BuddyStack
      size={28}
      hues={agents.map(agentHue)}
      seeds={agents.map((a) => a.id)}
      states={agents.map(() => (f.outdated ? 'offline' : 'idle'))}
    />
  ) : (
    <Tile>
      <Server size={16} strokeWidth={2} />
    </Tile>
  )
  // Too old to add: the row explains how to update it instead.
  const explain = () =>
    void ask({
      title: `${f.name} needs an update`,
      body:
        f.where === 'umbrel'
          ? 'Open the App Store on your Umbrel, find Hermes Agent and tap Update. Then add it here.'
          : 'On the computer running Hermes, run “hermes update”, then restart it. Then add it here.',
      action: 'OK',
      notice: true,
    })
  return (
    <ListRow
      icon={<span className={cn(f.outdated && 'opacity-60')}>{icon}</span>}
      title={f.name}
      subtitle={subtitle}
      onClick={f.outdated ? explain : undefined}
      chevron={f.outdated}
      trailing={f.outdated ? undefined : <AddPill label={`Add ${f.name}`} busy={busy} onClick={onAdd} />}
    />
  )
}

/** The suggestion's one action: a soft pill with a full-size target. */
function AddPill({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={busy ? undefined : onClick}
      aria-label={label}
      aria-busy={busy || undefined}
      className={cn(
        'pressable relative -mr-1 inline-flex h-8 min-w-14 flex-none items-center justify-center rounded-full bg-accent-soft px-3.5 text-subhead font-semibold text-accent select-none',
        'hover:brightness-105 active:brightness-95',
        // A 44px target around the 32px pill.
        "before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-['']",
      )}
    >
      {busy ? <Spinner size={14} /> : 'Add'}
    </button>
  )
}

/** A row: tap to use it, (i) for its details. Two buttons side by side, so the row itself isn't one. */
function HermesRow({ hermes: c, inUse, starting, onDetails }: { hermes: KnownHermes; inUse: boolean; starting?: boolean; onDetails: () => void }) {
  const use = () => {
    if (inUse) return onDetails()
    switchHermes(c).catch((e: unknown) => toast.error(errorText(e, 'Couldn’t switch. Try again.')))
  }
  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={use}
        aria-current={inUse || undefined}
        title={inUse ? `${c.name} (in use)` : `Use ${c.name}`}
        className="flex min-h-13 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2"
      >
        <span className="flex size-7 flex-none items-center justify-center">
          <StatusDot tone={toneOf(c, starting)} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">{c.name}</span>
          {/* Two lines before it clips, so "Comes with Murmur · Hermes 0.22.0" keeps its version on a phone. */}
          <span className="line-clamp-2 block text-footnote text-pretty text-ink-2">{hermesDetail(c, { starting })}</span>
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
function DetailsSheet({ hermes, inUse, starting, onClose }: { hermes?: KnownHermes; inUse: boolean; starting?: boolean; onClose: () => void }) {
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
          {c.managed || isBuiltinHermes(c) ? (
            // The built-in, or set by the environment: nothing to change, nothing to forget.
            <ManagedHermes connection={c} starting={isBuiltinHermes(c) && starting} />
          ) : isUmbrelHermes(c) ? (
            // The Hermes Agent app: its address is a container's name, never something to edit.
            <CurrentStatus
              connection={c}
              footer="The Hermes Agent app on this Umbrel. Murmur connects to it for you."
              forgetAsk={{ title: `Forget ${c.name}?`, body: 'Murmur will stop using it. Your agents and chats stay in the Hermes Agent app.' }}
              onForget={async () => {
                try {
                  await remove.mutateAsync(c.id)
                  onClose()
                } catch (e) {
                  toast.error(errorText(e, 'Couldn’t forget this server. Try again.'))
                  throw e
                }
              }}
            />
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

/** Connect one more, then move to it. `prefill`: a found Hermes's address, when it needs a password. */
function AddSheet({ open, prefill, onOpenChange }: { open: boolean; prefill?: string; onOpenChange: (open: boolean) => void }) {
  const { add, list } = useHermesManager()
  const onUmbrel = useOnUmbrel() || !!list.data?.connections.some(isUmbrelHermes)
  // A fresh form every time it opens.
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (open) setRound((r) => r + 1)
  }, [open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add another server" description="Pick one Murmur found, or enter its address. Murmur checks it, then switches to it.">
      <div className="pt-1">
        <HermesConnectionFormView
          key={round}
          embedded
          initial={prefill ? { url: prefill, showAuth: true } : undefined}
          // What's nearby, less what's added already (the server turns those away). Not on umbrelOS.
          suggest={!onUmbrel}
          added={list.data?.connections.map((c) => c.url)}
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
