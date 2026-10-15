import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { toast } from 'sonner'
import { Check, Plus, Search } from 'lucide-react'
import { Sheet } from '@/ui/sheet'
import { Button } from '@/ui/button'
import { Buddy } from '@/ui/buddy'
import { Orb } from '@/ui/orb'
import { Grow } from '@/ui/grow'
import { Skeleton } from '@/ui/skeleton'
import { Spinner } from '@/ui/spinner'
import { Toggle } from '@/ui/toggle'
import { TextField, Label } from '@/ui/field'
import { ListGroup, ListRow } from '@/ui/list'
import { UmbrelIcon } from '@/ui/brand'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { useAgents, type Agent } from '@/state/agents'
import { useHermesOnUmbrel, UMBREL_SERVER } from '@/state/umbrel-mcp'
import {
  arrange,
  cancelConnect,
  clearConnection,
  connectApp,
  openSignInTab,
  removeApp,
  setAppEnabled,
  showSignIn,
  useAgentApps,
  useAppHealth,
  useCatalog,
  useConnection,
  useConnections,
  type AppServer,
  type CatalogApp,
  type Health,
} from '@/state/apps'
import { ask } from '@/features/settings/ask'
import { AppIcon, appName } from './app-icon'

// An agent's apps: the ones it can use, each with how it's doing and a
// switch, then a wall of apps to add. Tapping one opens its sign-in in a new
// tab and draws the link from the app to the agent while you finish there;
// when it's done the agent can use it. Apps are per agent, so a connection can
// be shared to the others from here in a tap (each signs in on its own).

type Props = { agent: Agent; open: boolean; onOpenChange: (open: boolean) => void }

const ease = [0.16, 1, 0.3, 1] as const
const pop = { type: 'spring', duration: 0.45, bounce: 0.45 } as const

export function AppsSheet({ agent, open, onOpenChange }: Props) {
  const qc = useQueryClient()
  // Fetched with the page, so the wall is there the moment the sheet opens.
  const catalog = useCatalog()
  const servers = useAgentApps(agent.id, open)
  const [picked, setPicked] = useState<string | null>(null)

  // Closing tidies up: back to the list, and a connection that finished (or didn't) is forgotten.
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => {
      setPicked(null)
      const all = useConnections.getState()
      for (const key of Object.keys(all)) {
        const [profile, app] = key.split('\n')
        if (profile === agent.id && (all[key].phase === 'done' || all[key].phase === 'failed'))
          clearConnection(profile, app)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [open, agent.id])

  const byName = useMemo(() => new Map((catalog.data ?? []).map((a) => [a.name, a])), [catalog.data])

  const connect = (app: CatalogApp, env?: Record<string, string>) => {
    const name = appName(app.name)
    // Opened now, in the tap: a tab opened once Hermes is ready would be blocked.
    const tab = app.auth_type === 'oauth' ? openSignInTab(name) : null
    const added = !!servers.data?.some((s) => s.name === app.name)
    setPicked(app.name)
    void connectApp(qc, agent.id, app, { name, tab, env, added })
  }

  const back = () => {
    if (!picked) return
    setPicked(null)
    const phase = useConnections.getState()[`${agent.id}\n${picked}`]?.phase
    if (phase === 'done' || phase === 'failed') clearConnection(agent.id, picked)
  }

  const pickedApp = picked ? byName.get(picked) : undefined
  const pickedServer = picked ? servers.data?.find((s) => s.name === picked) : undefined

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={picked ? appName(picked) : 'Apps'}
      className="hue-scope"
      style={{ '--hue': agent.hue } as CSSProperties}
      back={picked ? { label: 'Apps', onBack: back } : undefined}
      width={520}
    >
      <Grow>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={picked ?? 'list'}
            initial={{ opacity: 0, x: picked ? 16 : -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: picked ? -16 : 16, transition: { duration: 0.14 } }}
            transition={{ duration: 0.3, ease }}
          >
            {picked ? (
              <AppView
                agent={agent}
                name={picked}
                app={pickedApp}
                server={pickedServer}
                onBack={back}
                onConnect={connect}
                onClose={() => onOpenChange(false)}
              />
            ) : (
              <Home
                agent={agent}
                catalog={catalog.data}
                servers={servers.data}
                failed={catalog.isError || servers.isError}
                open={open}
                onPick={setPicked}
                onAdd={(app) => (app.required_env.length ? setPicked(app.name) : connect(app))}
                onClose={() => onOpenChange(false)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </Grow>
    </Sheet>
  )
}

// ── The list ────────────────────────────────────────────────────────────────

function Home({
  agent,
  catalog,
  servers,
  failed,
  open,
  onPick,
  onAdd,
  onClose,
}: {
  agent: Agent
  catalog: CatalogApp[] | undefined
  servers: AppServer[] | undefined
  failed: boolean
  open: boolean
  onPick: (name: string) => void
  onAdd: (app: CatalogApp) => void
  onClose: () => void
}) {
  const [, navigate] = useLocation()
  const onUmbrel = useHermesOnUmbrel().data
  const [query, setQuery] = useState('')
  const health = useAppHealth(agent.id, servers, open)
  const connections = useConnections()

  const has = new Set(servers?.map((s) => s.name))
  const umbrel = servers?.find((s) => s.name === UMBREL_SERVER)
  const mine = (servers ?? []).filter((s) => s.name !== UMBREL_SERVER && !s.name.startsWith(`${UMBREL_SERVER}-`))
  const { everyday, developer } = arrange(catalog ?? [], appName)
  const fresh = (a: CatalogApp) => !has.has(a.name)

  const words = query.trim().toLowerCase()
  const matches = (a: CatalogApp) =>
    appName(a.name).toLowerCase().includes(words) || a.description.toLowerCase().includes(words)
  const toUmbrel = () => {
    onClose()
    navigate('/settings/umbrel')
  }

  if (failed && !servers)
    return (
      <div className="py-10 text-center">
        <p className="text-subhead text-ink-2">Couldn’t reach Hermes. Check that it’s running, then try again.</p>
      </div>
    )

  return (
    <div className="space-y-7 pt-1">
      {!servers ? (
        <RowsLoading />
      ) : (
        (mine.length > 0 || umbrel) && (
          <ListGroup>
            {umbrel && (
              <ListRow
                icon={<UmbrelIcon size={30} />}
                title="Umbrel"
                subtitle="Apps, files and more on your Umbrel"
                chevron
                onClick={toUmbrel}
              />
            )}
            {mine.map((s) => (
              <AppRow
                key={s.name}
                agent={agent}
                server={s}
                description={catalogDescription(catalog, s)}
                health={health[s.name]}
                busy={isBusy(connections[`${agent.id}\n${s.name}`]?.phase)}
                onOpen={() => onPick(s.name)}
              />
            ))}
          </ListGroup>
        )
      )}

      <section>
        <div className="mb-4 flex items-center gap-3">
          <h3 className="min-w-0 flex-1 px-1 text-subhead font-semibold tracking-[-0.01em]">
            {mine.length || umbrel ? 'Add more' : `Give ${agent.name} an app`}
          </h3>
          <SearchField value={query} onChange={setQuery} />
        </div>

        {!catalog ? (
          <WallLoading />
        ) : words ? (
          <Wall
            apps={[...everyday, ...developer].filter(fresh).filter(matches)}
            onAdd={onAdd}
            empty={`No apps match “${query.trim()}”`}
          />
        ) : (
          <>
            <Wall
              lead={onUmbrel && !umbrel ? <UmbrelTile onClick={toUmbrel} /> : undefined}
              apps={everyday.filter(fresh)}
              onAdd={onAdd}
            />
            <h3 className="mt-8 mb-4 px-1 text-footnote font-medium text-ink-2">For developers</h3>
            <Wall apps={developer.filter(fresh)} onAdd={onAdd} />
          </>
        )}
      </section>
    </div>
  )
}

const isBusy = (phase: string | undefined) => phase === 'adding' || phase === 'signing-in' || phase === 'blocked'

const catalogDescription = (catalog: CatalogApp[] | undefined, s: AppServer) =>
  catalog?.find((a) => a.name === s.name)?.description ?? (s.url ? hostOf(s.url) : '')

function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** One connected app: its icon, how it's doing (only when that's news), and its switch. */
function AppRow({
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
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={typeof status === 'string' ? status : 'signin'}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.2, ease }}
              className="block truncate text-footnote text-ink-2"
            >
              {status}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>
      {busy ? <Spinner /> : <Toggle checked={server.enabled} onChange={toggle} label={`${name} for ${agent.name}`} />}
    </div>
  )
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative flex h-9 w-40 flex-none items-center rounded-full bg-fill-1 transition-colors focus-within:bg-fill-2 sm:w-48">
      <Search size={15} strokeWidth={2.2} className="pointer-events-none absolute left-3 text-ink-3" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search"
        aria-label="Search apps"
        className="h-full w-full rounded-full bg-transparent pr-3 pl-8.5 text-subhead text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  )
}

/** Apps to add, as a phone's home screen lays them out. */
function Wall({
  apps,
  lead,
  onAdd,
  empty,
}: {
  apps: CatalogApp[]
  lead?: ReactNode
  onAdd: (app: CatalogApp) => void
  empty?: string
}) {
  if (!apps.length && !lead) return empty ? <p className="py-8 text-center text-subhead text-ink-3">{empty}</p> : null
  return (
    <div className="grid grid-cols-4 gap-x-2 gap-y-5 sm:grid-cols-5">
      {lead}
      {apps.map((app, i) => (
        <Tile key={app.name} name={appName(app.name)} hint={app.description} index={i} onClick={() => onAdd(app)}>
          <AppIcon name={app.name} size={56} />
        </Tile>
      ))}
    </div>
  )
}

function Tile({
  name,
  hint,
  index,
  onClick,
  children,
}: {
  name: string
  hint?: string
  index: number
  onClick: () => void
  children: ReactNode
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      title={hint}
      aria-label={hint ? `${name}: ${hint}` : name}
      // The wall settles in from the top, quickly, and only the first screenful takes turns.
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease, delay: Math.min(index, 16) * 0.012 }}
      className="group flex min-w-0 flex-col items-center gap-1.5 rounded-xl py-1 outline-offset-2 select-none"
    >
      <span className="transition-[scale,filter] duration-150 ease-out group-hover:brightness-105 group-active:scale-[.92]">
        {children}
      </span>
      <span className="max-w-full truncate px-0.5 text-caption text-ink">{name}</span>
    </motion.button>
  )
}

function UmbrelTile({ onClick }: { onClick: () => void }) {
  return (
    <Tile name="Umbrel" hint="Apps, files and more on your Umbrel" index={0} onClick={onClick}>
      <UmbrelIcon size={56} />
    </Tile>
  )
}

function RowsLoading() {
  return (
    <div className="list-group overflow-hidden rounded-xl bg-fill-1" aria-busy aria-label="Loading">
      {[0, 1].map((i) => (
        <div key={i} className="flex h-15 items-center gap-3 px-4">
          <Skeleton className="size-[30px] rounded-[7px]" />
          <span className="flex-1 space-y-2">
            <Skeleton className="block h-3 w-24 rounded-full" />
            <Skeleton className="block h-2.5 w-44 rounded-full" />
          </span>
        </div>
      ))}
    </div>
  )
}

function WallLoading() {
  return (
    <div className="grid grid-cols-4 gap-x-2 gap-y-5 sm:grid-cols-5" aria-busy aria-label="Loading">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex flex-col items-center gap-2 py-1">
          <Skeleton className="size-14 rounded-[12.5px]" />
          <Skeleton className="h-2 w-10 rounded-full" />
        </div>
      ))}
    </div>
  )
}

// ── One app ─────────────────────────────────────────────────────────────────

function AppView({
  agent,
  name,
  app,
  server,
  onBack,
  onConnect,
  onClose,
}: {
  agent: Agent
  name: string
  app: CatalogApp | undefined
  server: AppServer | undefined
  onBack: () => void
  onConnect: (app: CatalogApp, env?: Record<string, string>) => void
  onClose: () => void
}) {
  const connection = useConnection(agent.id, name)
  return (
    <div>
      {connection ? (
        <Connecting
          agent={agent}
          name={name}
          app={app}
          onBack={onBack}
          onClose={onClose}
          onRetry={app ? () => onConnect(app) : undefined}
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
        <Form app={app} onConnect={(env) => onConnect(app, env)} />
      ) : null}
    </div>
  )
}

/** The app and the agent, side by side, and the link between them. */
function Pair({ agent, name, state }: { agent: Agent; name: string; state: 'linking' | 'linked' | 'broken' }) {
  const linked = state === 'linked'
  return (
    <div className="flex items-center justify-center pt-3">
      <span className="relative">
        <AppIcon
          name={name}
          size={68}
          className="shadow-[inset_0_0_0_0.5px_var(--line-strong),0_8px_20px_rgb(0_0_0/0.14)]"
        />
        <AnimatePresence>
          {linked && (
            <motion.span
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...pop, delay: 0.35 }}
              className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full bg-success text-white ring-3 ring-elevated"
            >
              <Check size={14} strokeWidth={3} aria-hidden />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      {/* Dotted and drifting while it's only a promise, drawn solid once it's real. */}
      <span
        aria-hidden
        className={cn(
          'relative mx-4 h-[3px] w-14 overflow-hidden rounded-full',
          state === 'linking' ? 'umbrel-link' : 'bg-fill-3',
        )}
      >
        <motion.span
          className="umbrel-link-fill absolute inset-0 origin-left rounded-full"
          initial={false}
          animate={{ scaleX: linked ? 1 : 0 }}
          transition={{ type: 'spring', duration: 0.7, bounce: 0 }}
        />
      </span>
      <Buddy
        hue={agent.hue}
        seed={agent.id}
        size={68}
        state={linked ? 'done' : state === 'broken' ? 'idle' : 'waiting'}
      />
    </div>
  )
}

function Heading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mt-6 text-center">
      <h2 className="text-title font-semibold tracking-[-0.02em] text-balance">{title}</h2>
      {children && <p className="mx-auto mt-1.5 max-w-80 text-subhead text-balance text-ink-2">{children}</p>}
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
      <Pair agent={agent} name={name} state={done ? 'linked' : phase === 'failed' ? 'broken' : 'linking'} />
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
                {app?.auth_type === 'oauth' ? 'Its sign-in opens in a new tab.' : 'One moment.'}
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
              <Heading title={`${agent.name} can now use ${label}`}>{app?.description}</Heading>
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

  const remove = async () => {
    const yes = await ask({
      title: `Remove ${label}?`,
      body: `${agent.name} won’t be able to use it. You can add it again any time.`,
      action: 'Remove',
      destructive: true,
    })
    if (!yes) return
    onBack()
    removeApp(qc, agent.id, server.name).catch(fail)
  }

  return (
    <div className="pb-1">
      <div className="flex flex-col items-center pt-3 text-center">
        <AppIcon
          name={server.name}
          size={72}
          className="shadow-[inset_0_0_0_0.5px_var(--line-strong),0_8px_20px_rgb(0_0_0/0.14)]"
        />
        <h2 className="mt-4 text-title font-semibold tracking-[-0.02em]">{label}</h2>
        <p className="mx-auto mt-1 max-w-80 text-subhead text-balance text-ink-2">
          {app?.description ?? (server.url ? hostOf(server.url) : '')}
        </p>
      </div>
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
        <ListGroup>
          <ListRow title={`Remove from ${agent.name}`} destructive onClick={() => void remove()} />
        </ListGroup>
      </div>
    </div>
  )
}

/** The few apps that need something first (n8n's address): one tidy field each. */
function Form({ app, onConnect }: { app: CatalogApp; onConnect: (env: Record<string, string>) => void }) {
  const label = appName(app.name)
  const [values, setValues] = useState<Record<string, string>>({})
  const ready = app.required_env.every((e) => !e.required || values[e.name]?.trim())
  return (
    <form
      className="pb-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onConnect(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])))
      }}
    >
      <div className="flex flex-col items-center pt-3 text-center">
        <AppIcon
          name={app.name}
          size={72}
          className="shadow-[inset_0_0_0_0.5px_var(--line-strong),0_8px_20px_rgb(0_0_0/0.14)]"
        />
        <h2 className="mt-4 text-title font-semibold tracking-[-0.02em]">{label}</h2>
        <p className="mx-auto mt-1 max-w-80 text-subhead text-balance text-ink-2">{app.description}</p>
      </div>
      <div className="mt-7 space-y-4">
        {app.required_env.map((env, i) => (
          <div key={env.name}>
            <Label>{fieldLabel(env.prompt)}</Label>
            <TextField
              autoFocus={i === 0}
              autoComplete="off"
              spellCheck={false}
              placeholder={/url/i.test(env.name) ? 'https://' : undefined}
              inputMode={/url/i.test(env.name) ? 'url' : undefined}
              value={values[env.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [env.name]: e.target.value }))}
            />
            {fieldHint(env.prompt) && <p className="mt-2 px-4 text-footnote text-ink-3">{fieldHint(env.prompt)}</p>}
          </div>
        ))}
      </div>
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
