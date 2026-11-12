import { useEffect, useState } from 'react'
import { LayoutGroup, motion } from 'motion/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, ChevronRight, Plus } from 'lucide-react'
import { Buddy, BuddyStack } from '@/ui/buddy'
import { Label } from '@/ui/field'
import { ListGroup, ListRow } from '@/ui/list'
import { Sheet } from '@/ui/sheet'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import {
  connectionApi,
  connectionsKey,
  ssoOnly,
  useHermesManager,
  type ConnectionRequest,
  type HermesConnection,
  type KnownHermes,
  type SignInWay,
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
import { hermesDetail, toneOf } from '@/features/connection/describe'
import { StatusDot } from '@/features/connection/fields'
import { agentHue } from '@/features/onboarding/setup-copy'
import { ask } from './ask'
import { Tile } from './page'
import { ServerIcon } from '@/ui/icons'

// Settings → Server: every Hermes this Murmur has. All of them are in use at
// once, their agents side by side in the one list, so there's nothing to
// choose here: a tap opens a server's details (name, address, password,
// Forget), and "Add another server" brings one more's agents in.
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
  const [adding, setAdding] = useState<AddPrefill | null>(null)
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
  const open = connections.find((c) => c.id === details)
  const starting = setup?.builtin?.state === 'starting'
  const takenFound = new Set(Object.values(moved))

  return (
    <LayoutGroup>
      <ListGroup
        title={connections.length > 1 ? 'Your servers' : undefined}
        footer={
          connections.length > 1
            ? 'Their agents are side by side in Murmur. Each server keeps its own agents, chats and groups.'
            : 'Running Hermes somewhere else too, like on another computer? Add it, and its agents join these.'
        }
      >
        {connections.map((c) => (
          <motion.div key={c.id} layoutId={`hermes-${moved[c.id] ?? c.id}`} transition={{ type: 'spring', duration: 0.35, bounce: 0 }} data-has-icon="">
            <HermesRow hermes={c} starting={isBuiltinHermes(c) && starting} onDetails={() => setDetails(c.id)} />
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
          onNeedsSignIn={(f) => setAdding({ url: f.url, signIns: f.signIns })}
        />
      )}

      <DetailsSheet hermes={open} starting={starting} onClose={() => setDetails(null)} />
      <AddSheet open={!!adding} prefill={adding ?? undefined} onOpenChange={(o) => !o && setAdding(null)} />
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
  onNeedsSignIn,
}: {
  setup: Setup
  added: KnownHermes[]
  /** Found ids just added here, while the server catches up. */
  hidden: Set<string>
  onAdded: (foundId: string, connectionId: string) => void
  onNeedsSignIn: (found: FoundHermes) => void
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const items: Suggestion[] = [
    ...setup.found.filter((f) => !f.away && !hidden.has(f.id) && !added.some((c) => c.url === f.url)).map((hermes) => ({ kind: 'found' as const, hermes })),
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
        ? 'Your Hermes Agent app. Add it, and its agents join these.'
        : 'Add it, and its agents join these.'
      : 'Add one, and its agents join these.'

  const add = async (id: string, name: string) => {
    if (busy) return
    setBusy(id)
    try {
      const result = await addFoundHermes(id)
      if (!result.ok) {
        if (result.reason === 'failed' && result.connection.status === 'needs-login') {
          const f = setup.found.find((x) => x.id === id)
          if (f) onNeedsSignIn({ ...f, signIns: result.connection.signIns ?? f.signIns })
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
      toast(`Added ${connection.name}`)
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
              onAdd={() => (s.hermes.needsSignIn ? onNeedsSignIn(s.hermes) : void add(s.hermes.id, s.hermes.name))}
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
    `${ssoOnly(f.signIns) ? 'Signs in with SSO' : 'Needs a password'} · ${f.host}`
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
      <ServerIcon size={19} />
    </Tile>
  )
  // Too old to add: the row explains how to update it instead.
  const explain = () =>
    void ask({
      title: `${f.name} needs an update`,
      body:
        f.where === 'umbrel'
          ? 'Open the App Store on your Umbrel, find Hermes Agent and tap Update. Then add it here.'
          : f.fromImage
            ? 'On the computer running Hermes, pull the newer Hermes image, then restart it. Then add it here.'
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

/** A row: how it's doing, what it's called, where it is. A tap opens its details. */
function HermesRow({ hermes: c, starting, onDetails }: { hermes: KnownHermes; starting?: boolean; onDetails: () => void }) {
  return (
    <button
      type="button"
      onClick={onDetails}
      title={c.name}
      className="flex min-h-13 w-full items-center gap-3 py-2.5 pr-4 pl-4 text-left transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2"
    >
      <span className="flex size-7 flex-none items-center justify-center">
        <StatusDot tone={toneOf(c, starting)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{c.name}</span>
        {/* Two lines before it clips, so "Comes with Murmur · Hermes 0.23.1" keeps its version on a phone. */}
        <span className="line-clamp-2 block text-footnote text-pretty text-ink-2">{hermesDetail(c, { starting })}</span>
      </span>
      {/* The glyph sits inside its box; nudge it so its stroke, not its box, meets the edge. */}
      <ChevronRight size={18} className="-mr-1.5 flex-none text-ink-3" aria-hidden />
    </button>
  )
}

/** One Hermes: its name, how Murmur reaches it, and the ways out. */
function DetailsSheet({ hermes, starting, onClose }: { hermes?: KnownHermes; starting?: boolean; onClose: () => void }) {
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

/** A found Hermes that needs a sign-in: its address, and how it takes one. */
type AddPrefill = { url?: string; signIns?: SignInWay[] }

/** Connect one more: its agents join the list. `prefill`: a found Hermes, when it needs a sign-in. */
function AddSheet({ open, prefill, onOpenChange }: { open: boolean; prefill?: AddPrefill; onOpenChange: (open: boolean) => void }) {
  const { add, list } = useHermesManager()
  const onUmbrel = useOnUmbrel() || !!list.data?.connections.some(isUmbrelHermes)
  // A fresh form every time it opens.
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (open) setRound((r) => r + 1)
  }, [open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add another server" description="Pick one Murmur found, or enter its address. Murmur checks it, then its agents join yours.">
      <div className="pt-1">
        <HermesConnectionFormView
          key={round}
          embedded
          initial={
            prefill?.url
              ? {
                  url: prefill.url,
                  // Straight to the password fields, unless it signs in with single sign-on only.
                  showAuth: !ssoOnly(prefill.signIns),
                  ...(prefill.signIns && {
                    result: { url: prefill.url, managed: false, source: 'saved', mode: ssoOnly(prefill.signIns) ? 'sso' : 'password', status: 'needs-login', signIns: prefill.signIns },
                  }),
                }
              : undefined
          }
          // What's nearby, less what's added already (the server turns those away). Not on umbrelOS.
          suggest={!onUmbrel}
          added={list.data?.connections.map((c) => c.url)}
          onTest={connectionApi.test}
          onSave={async (req) => {
            const next = await add.mutateAsync(req)
            return next.connection
          }}
          onConnected={(connection: HermesConnection) => {
            if (!connection.id || !connection.name) return
            onOpenChange(false)
            toast(`Added ${connection.name}`)
          }}
        />
      </div>
    </Sheet>
  )
}
