import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Plus } from 'lucide-react'
import { Button } from '@/ui/button'
import { ConfirmCard } from '@/ui/confirm-card'
import { Orb } from '@/ui/orb'
import { Spinner } from '@/ui/spinner'
import { Toggle } from '@/ui/toggle'
import { Segmented } from '@/ui/segmented'
import { TextField, Label } from '@/ui/field'
import { ListGroup, ListRow } from '@/ui/list'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { useAgents, type Agent } from '@/state/agents'
import { useHermesOnUmbrel } from '@/state/umbrel-mcp'
import {
  cancelConnect,
  clearConnection,
  connectApp,
  nextStep,
  onUmbrel as onUmbrelHere,
  openSignInTab,
  removeApp,
  setAppEnabled,
  showSignIn,
  useAgentApps,
  useAppHealth,
  useConnection,
  useConnections,
  type AppServer,
  type CatalogApp,
  type Health,
} from '@/state/apps'
import { AppIcon, appName } from './app-icon'
import { AppHeader, Heading, Pair, RowStatus, ease, pop } from './parts'

// Apps Hermes connects itself, from its own catalog (state/apps.ts): each is
// per agent, signed into in a new tab, and can be shared to the other agents
// from here in a tap (each signs in on its own).

export const isBusy = (phase: string | undefined) => phase === 'adding' || phase === 'signing-in' || phase === 'blocked'

export function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** One connected app: its icon, how it's doing (only when that's news), and its switch. */
export function AppRow({
  agent,
  server,
  description,
  health,
  busy,
  onOpen,
}: {
  agent: Agent
  server: AppServer
  description: string
  health: Health | undefined
  busy: boolean
  onOpen: () => void
}) {
  const qc = useQueryClient()
  const name = appName(server.name)
  const status: ReactNode = busy ? (
    'Signing in…'
  ) : !server.enabled ? (
    'Off'
  ) : health === 'signin' ? (
    <span className="text-accent">Sign in again</span>
  ) : health === 'down' ? (
    'Can’t reach it right now'
  ) : (
    description
  )
  const toggle = (on: boolean) =>
    void setAppEnabled(qc, agent.id, server.name, on).catch(() =>
      toast.error('Couldn’t reach Hermes. Check that it’s running, then try again.'),
    )
  return (
    <div data-has-icon="" className="flex min-h-15 items-center gap-3 pr-4">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-2.5 pl-4 text-left transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2"
      >
        <AppIcon
          name={server.name}
          size={30}
          className={cn('transition-opacity duration-200', !server.enabled && 'opacity-45')}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">{name}</span>
          <RowStatus id={typeof status === 'string' ? status : 'signin'}>{status}</RowStatus>
        </span>
      </button>
      {busy ? <Spinner /> : <Toggle checked={server.enabled} onChange={toggle} label={`${name} for ${agent.name}`} />}
    </div>
  )
}

// ── One app ─────────────────────────────────────────────────────────────────

export function AppView({
  agent,
  name,
  app,
  server,
  onBack,
  onConnect,
  onConnectHere,
  onClose,
}: {
  agent: Agent
  name: string
  app: CatalogApp | undefined
  server: AppServer | undefined
  onBack: () => void
  onConnect: (app: CatalogApp, env?: Record<string, string>) => void
  onConnectHere: (app: CatalogApp, token: string) => void
  onClose: () => void
}) {
  const connection = useConnection(agent.id, name)
  // Kept while the app is open, so trying again comes back to what was typed.
  const [draft, setDraft] = useState<Draft>({ here: true, values: {}, token: '' })
  // One that asked for something goes back to its form to try again; the rest just go again.
  const retry = app && (app.required_env.length ? () => clearConnection(agent.id, name) : () => onConnect(app))
  return (
    <div>
      {connection ? (
        <Connecting
          agent={agent}
          name={name}
          app={app}
          onBack={onBack}
          onClose={onClose}
          onRetry={retry || undefined}
        />
      ) : server ? (
        <Manage
          agent={agent}
          server={server}
          app={app}
          onBack={onBack}
          onSignIn={app ? () => onConnect(app) : undefined}
        />
      ) : app ? (
        <Form
          app={app}
          draft={draft}
          onDraft={setDraft}
          onConnect={(env) => onConnect(app, env)}
          onConnectHere={(token) => onConnectHere(app, token)}
        />
      ) : null}
    </div>
  )
}

/** A connection under way, or how it went. */
function Connecting({
  agent,
  name,
  app,
  onBack,
  onClose,
  onRetry,
}: {
  agent: Agent
  name: string
  app: CatalogApp | undefined
  onBack: () => void
  onClose: () => void
  onRetry?: () => void
}) {
  const qc = useQueryClient()
  const connection = useConnection(agent.id, name)!
  const label = appName(name)
  const phase = connection.phase
  const done = phase === 'done'

  // The moment it lands.
  const landed = useRef(false)
  useEffect(() => {
    if (done && !landed.current) haptic('success')
    landed.current = done
  }, [done])

  return (
    <div className="pb-1">
      <Pair agent={agent} icon={name} state={done ? 'linked' : phase === 'failed' ? 'broken' : 'linking'} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={phase === 'blocked' ? 'signing-in' : phase}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.14 } }}
          transition={{ duration: 0.32, ease }}
        >
          {phase === 'adding' && (
            <>
              <Heading title={`Adding ${label}`}>
                {app?.auth_type === 'oauth' && !connection.token ? 'Its sign-in opens in a new tab.' : 'One moment.'}
              </Heading>
              <div className="mt-7 grid place-items-center">
                <Spinner />
              </div>
            </>
          )}
          {(phase === 'signing-in' || phase === 'blocked') && (
            <>
              <Heading title={`Sign in to ${label}`}>
                {phase === 'blocked'
                  ? `Then ${agent.name} can use it.`
                  : `Finish in the new tab, and ${agent.name} can use it.`}
              </Heading>
              <div className="mt-7 grid gap-2">
                <Button
                  variant={phase === 'blocked' ? 'accent' : 'secondary'}
                  size="lg"
                  onClick={() => connection.url && showSignIn(connection.url)}
                >
                  {phase === 'blocked' ? `Continue to ${label}` : `Open ${label} again`}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="text-ink-2"
                  onClick={() => {
                    void cancelConnect(qc, agent.id, name)
                    onBack()
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
          {done && (
            <>
              <Heading title={`${agent.name} can now use ${label}`}>{nextStep(name) ?? app?.description}</Heading>
              <AlsoFor agent={agent} app={app} />
              <div className="mt-7 grid">
                <Button variant="accent" size="lg" onClick={onClose}>
                  Done
                </Button>
              </div>
            </>
          )}
          {phase === 'failed' && (
            <>
              <Heading title={`Couldn’t connect ${label}`}>{connection.message}</Heading>
              <div className="mt-7 grid gap-2">
                {onRetry && (
                  <Button variant="accent" size="lg" onClick={onRetry}>
                    Try again
                  </Button>
                )}
                <Button size="lg" variant="ghost" className="text-ink-2" onClick={onBack}>
                  Back to apps
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** A connected app: on or off, signed in or not, shared, or taken away. */
function Manage({
  agent,
  server,
  app,
  onBack,
  onSignIn,
}: {
  agent: Agent
  server: AppServer
  app: CatalogApp | undefined
  onBack: () => void
  onSignIn?: () => void
}) {
  const qc = useQueryClient()
  const label = appName(server.name)
  const health = useAppHealth(agent.id, [server])[server.name]
  const fail = () => toast.error('Couldn’t reach Hermes. Check that it’s running, then try again.')

  const remove = () => {
    onBack()
    removeApp(qc, agent.id, server.name).catch(fail)
  }

  return (
    <div className="pb-1">
      <AppHeader icon={server.name} title={label}>
        {app?.description ?? (server.url ? hostOf(server.url) : '')}
      </AppHeader>
      <div className="mt-7 space-y-6">
        <ListGroup>
          <ListRow
            title={`On for ${agent.name}`}
            trailing={
              <Toggle
                checked={server.enabled}
                onChange={(on) => void setAppEnabled(qc, agent.id, server.name, on).catch(fail)}
                label={`${label} for ${agent.name}`}
              />
            }
          />
          {server.auth === 'oauth' && onSignIn && (
            <ListRow
              title="Sign in again"
              subtitle={health === 'signin' ? `${label} needs you to sign in` : undefined}
              onClick={onSignIn}
              chevron
            />
          )}
        </ListGroup>
        {app && <AlsoFor agent={agent} app={app} />}
        <ConfirmCard
          label={`Remove from ${agent.name}`}
          title={`Remove ${label}?`}
          body={`${agent.name} won’t be able to use it. You can add it again any time.`}
          confirm="Remove"
          onConfirm={remove}
        />
      </div>
    </div>
  )
}

type Draft = { here: boolean; values: Record<string, string>; token: string }

/**
 * The few apps that need something first (n8n's address): one tidy field
 * each. One that can run on this Umbrel asks which: here, it only needs its
 * token; elsewhere, what it always asks for.
 */
function Form({
  app,
  draft,
  onDraft,
  onConnect,
  onConnectHere,
}: {
  app: CatalogApp
  draft: Draft
  onDraft: (next: Draft) => void
  onConnect: (env: Record<string, string>) => void
  onConnectHere: (token: string) => void
}) {
  const label = appName(app.name)
  const local = onUmbrelHere(app.name)
  const hermesOnUmbrel = useHermesOnUmbrel().data === true
  const here = !!local && hermesOnUmbrel && draft.here
  const { values, token } = draft
  const ready = here ? !!token.trim() : app.required_env.every((e) => !e.required || values[e.name]?.trim())
  return (
    <form
      className="pb-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        if (here) onConnectHere(token)
        else onConnect(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])))
      }}
    >
      <AppHeader icon={app.name} title={label}>
        {app.description}
      </AppHeader>
      {local && hermesOnUmbrel && (
        <Segmented
          className="mt-7"
          label={`Where ${label} runs`}
          value={draft.here ? 'here' : 'elsewhere'}
          options={[
            { value: 'here', label: 'On this Umbrel' },
            { value: 'elsewhere', label: 'Elsewhere' },
          ]}
          onChange={(v) => onDraft({ ...draft, here: v === 'here' })}
        />
      )}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={here ? 'here' : 'elsewhere'}
          className={cn('space-y-4', local && hermesOnUmbrel ? 'mt-5' : 'mt-7')}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.28, ease }}
        >
          {here ? (
            <div>
              <Label>Access token</Label>
              <TextField
                autoFocus
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Paste it here"
                value={token}
                onChange={(e) => onDraft({ ...draft, token: e.target.value })}
              />
              <p className="mt-2 px-4 text-footnote text-pretty text-ink-3">{local.steps}</p>
            </div>
          ) : (
            app.required_env.map((env, i) => (
              <div key={env.name}>
                <Label>{fieldLabel(env.prompt)}</Label>
                <TextField
                  autoFocus={i === 0}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={/url/i.test(env.name) ? 'https://' : undefined}
                  inputMode={/url/i.test(env.name) ? 'url' : undefined}
                  value={values[env.name] ?? ''}
                  onChange={(e) => onDraft({ ...draft, values: { ...values, [env.name]: e.target.value } })}
                />
                {fieldHint(env.prompt) && <p className="mt-2 px-4 text-footnote text-ink-3">{fieldHint(env.prompt)}</p>}
              </div>
            ))
          )}
        </motion.div>
      </AnimatePresence>
      <div className="mt-7">
        <Button type="submit" variant="accent" size="lg" disabled={!ready}>
          Connect
        </Button>
      </div>
    </form>
  )
}

/** "MCP Server URL (n8n Settings > …)" → the label, and what's in brackets as where to find it. */
const fieldLabel = (prompt: string) => prompt.replace(/\s*\(.*\)\s*$/, '')
const fieldHint = (prompt: string) => prompt.match(/\((.*)\)\s*$/)?.[1].replace(/;\s*/g, ', ') ?? ''

// ── Sharing ─────────────────────────────────────────────────────────────────

/** The other agents, each a tap from having this app too. */
function AlsoFor({ agent, app }: { agent: Agent; app: CatalogApp | undefined }) {
  const others = (useAgents().data ?? []).filter((a) => a.id !== agent.id)
  if (!others.length || !app) return null
  return (
    <motion.div
      className="mt-6"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease, delay: 0.25 }}
    >
      <p className="mb-2.5 text-center text-footnote text-ink-3">Also for</p>
      <div className="flex flex-wrap justify-center gap-2">
        {others.map((other) => (
          <ShareChip key={other.id} agent={other} app={app} />
        ))}
      </div>
    </motion.div>
  )
}

function ShareChip({ agent, app }: { agent: Agent; app: CatalogApp }) {
  const qc = useQueryClient()
  const servers = useAgentApps(agent.id)
  const connection = useConnection(agent.id, app.name)
  const has = !!servers.data?.some((s) => s.name === app.name) && !isBusy(connection?.phase)
  const busy = isBusy(connection?.phase)
  const label = appName(app.name)

  const share = () => {
    if (has || busy) return
    if (app.required_env.length) return void toast(`Add ${label} from ${agent.name}’s page; it needs a few details.`)
    const tab = app.auth_type === 'oauth' ? openSignInTab(label) : null
    void connectApp(qc, agent.id, app, { name: label, tab, added: false }).then(() => {
      const after = useConnections.getState()[`${agent.id}\n${app.name}`]
      if (after?.phase === 'failed') toast.error(after.message ?? `Couldn’t connect ${label}.`)
    })
  }

  return (
    <button
      type="button"
      onClick={share}
      disabled={!servers.data}
      aria-pressed={has}
      className={cn(
        'pressable hue-scope flex h-9 items-center gap-1.5 rounded-full pr-3.5 pl-1.5 text-subhead transition-colors select-none',
        has ? 'bg-accent-soft text-ink' : 'bg-fill-1 text-ink hover:bg-fill-2',
      )}
      style={{ '--hue': agent.hue } as CSSProperties}
    >
      <Orb hue={agent.hue} seed={agent.id} size={24} state={connection?.phase === 'done' ? 'done' : 'idle'} />
      <span className="max-w-28 truncate font-medium">{agent.name}</span>
      <span className="grid size-4 place-items-center text-ink-3">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={busy ? 'busy' : has ? 'has' : 'add'}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={pop}
            className="grid place-items-center"
          >
            {busy ? (
              <Spinner size={14} />
            ) : has ? (
              <Check size={15} strokeWidth={2.75} className="text-accent" aria-label="Has it" />
            ) : (
              <Plus size={15} strokeWidth={2.5} aria-label="Add" />
            )}
          </motion.span>
        </AnimatePresence>
      </span>
    </button>
  )
}
