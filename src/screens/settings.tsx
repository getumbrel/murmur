import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { ArrowUpRight, ChevronRight, Import, LogOut, Server, Sparkles, Users } from 'lucide-react'
import { ListGroup, ListRow } from '@/ui/list'
import { Segmented } from '@/ui/segmented'
import { Orb } from '@/ui/orb'
import { ByUmbrel, MurmurMark, UmbrelIcon } from '@/ui/brand'
import { useIsWide } from '@/lib/use-media'
import { api } from '@/hermes/rest'
import { useConnection } from '@/hermes/gateway'
import { useAgents, type Agent } from '@/state/agents'
import { modelName, useModels } from '@/state/models'
import { Page, Tile } from '@/features/settings/page'
import { Bone } from '@/features/home/bone'
import { Stack } from '@/features/settings/stack'
import { useAgentActions } from '@/features/home/actions'
import { useImportAgent } from '@/features/agents/import-agent'
import { Spinner } from '@/ui/spinner'
import { usePicturesSync } from '@/state/pictures'
import { ModelsSection } from '@/features/settings/models-section'
import { UmbrelSection } from '@/features/settings/umbrel-section'
import { useHermesOnUmbrel, useUmbrelMcp } from '@/state/umbrel-mcp'
import { AskHost } from '@/features/settings/ask'
import { isBuiltinHermes, isUmbrelHermes, useOnUmbrel } from '@/features/connection/hermes-connection-form'
import { HermesSection } from '@/features/settings/hermes-section'
import { StatusDot } from '@/features/connection/fields'
import { useHermesConnection, useMurmurSession } from '@/state/connection'
import { useTheme, type ThemePref } from '@/features/settings/theme'
import { NotificationsSetting } from '@/features/notifications/notify'

// Settings, the Apple way: a short list of sections, each its own page.

/** package.json's, baked in at build time (vite.config.ts). */
const VERSION = __MURMUR_VERSION__

/** Where Murmur lives. Help goes to its issues; the rest follow from here. */
const SOURCE_URL = 'https://github.com/getumbrel/murmur'
const HELP_URL = `${SOURCE_URL}/issues`
const LICENSE_URL = `${SOURCE_URL}/blob/master/LICENSE`

const SECTIONS = {
  models: { title: 'Models', body: ModelsSection },
  agents: { title: 'Agents', body: AgentsSection },
  // Where Hermes runs. Not "Hermes": that's also the main agent's name, right above it.
  hermes: { title: 'Server', body: HermesSection },
  umbrel: { title: 'Umbrel', body: UmbrelSection },
  about: { title: 'About', body: AboutSection },
} as const

type Section = keyof typeof SECTIONS

export function SettingsScreen({ section }: { section?: string }) {
  const [, navigate] = useLocation()
  const wide = useIsWide()
  const top = section && section in SECTIONS ? (section as Section) : null
  // Agents made elsewhere get the same picture setting as the main agent.
  usePicturesSync(useAgents().data?.map((a) => a.id))

  return (
    <>
      <Stack
        top={top}
        onBack={() => navigate('/settings')}
        root={
          <Page title="Settings" back={wide ? undefined : { label: 'Murmur', onClick: () => navigate('/') }}>
            <Root />
          </Page>
        }
        render={(key) => {
          const { title, body: Body } = SECTIONS[key as Section]
          return (
            <Page title={title} back={{ label: 'Settings', onClick: () => navigate('/settings') }}>
              <Body />
            </Page>
          )
        }}
      />
      <AskHost />
    </>
  )
}

function Root() {
  const [, navigate] = useLocation()
  const { data: agents, isPending } = useAgents()
  const models = useModels().data
  const main = agents?.find((a) => a.isDefault)
  const connection = useHermesConnection().connection
  const session = useMurmurSession()
  // Only where Hermes runs on an Umbrel: that's where umbrelOS's MCP server is.
  const onUmbrel = useHermesOnUmbrel().data === true
  const umbrel = useUmbrelMcp(agents?.map((a) => a.id), onUmbrel)

  return (
    <>
      {isPending && <MainCardSkeleton />}
      {main && (
        <button
          type="button"
          onClick={() => navigate(`/chat/${main.id}`)}
          title={main.name}
          className="pressable hue-scope flex w-full items-center gap-3 rounded-xl bg-fill-1 p-4 text-left select-none hover:bg-fill-2 focus-visible:-outline-offset-2 active:bg-fill-2"
          style={{ '--hue': main.hue } as React.CSSProperties}
        >
          {/* The buddy's body is narrower than its box: pull it out so the body
              lines up with the icon tiles below, and the name with their titles. */}
          <span className="-ml-2 flex-none">
            <Orb hue={main.hue} size={52} seed={main.id} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-title font-semibold tracking-[-0.02em]">{main.name}</span>
            <span className="block truncate text-subhead text-ink-2">
              {models?.model ? `Thinking with ${modelName(models.model)}` : 'Your main agent'}
            </span>
          </span>
          <ChevronRight size={18} className="-mr-1.5 flex-none text-ink-3" />
        </button>
      )}

      <ListGroup>
        <ListRow
          icon={
            <Tile>
              <Sparkles size={16} strokeWidth={2} />
            </Tile>
          }
          title="Models"
          detail={models?.model ? modelName(models.model) : undefined}
          chevron
          onClick={() => navigate('/settings/models')}
        />
        <ListRow
          icon={
            <Tile>
              <Users size={16} strokeWidth={2} />
            </Tile>
          }
          title="Agents"
          detail={agents ? String(agents.length) : undefined}
          chevron
          onClick={() => navigate('/settings/agents')}
        />
        <ListRow
          icon={
            <Tile>
              <Server size={16} strokeWidth={2} />
            </Tile>
          }
          title="Server"
          detail={
            connection ? (
              <span className="block max-w-[11rem] truncate sm:max-w-[16rem]">{connection.name ?? hostOf(connection.url)}</span>
            ) : undefined
          }
          chevron
          onClick={() => navigate('/settings/hermes')}
        />
        {onUmbrel && (
          <ListRow
            icon={
              <UmbrelIcon size={29} />
            }
            title="Umbrel"
            detail={umbrel.data ? (umbrel.data.connected.length ? 'Connected' : 'Not connected') : undefined}
            chevron
            onClick={() => navigate('/settings/umbrel')}
          />
        )}
        <ListRow icon={<AppIcon size={29} />} title="About" chevron onClick={() => navigate('/settings/about')} />
      </ListGroup>

      <Appearance />

      <NotificationsSetting />

      {session.session?.required && (
        <ListGroup>
          <ListRow
            icon={
              <Tile>
                <LogOut size={16} strokeWidth={2} />
              </Tile>
            }
            title="Sign out"
            onClick={() => session.signOut()}
          />
        </ListGroup>
      )}

      <Signature />
    </>
  )
}

/** Murmur's own icon, the way iOS Settings shows an app's: the tile with a hairline edge. */
function AppIcon({ size }: { size: number }) {
  return (
    <span
      className="relative block flex-none overflow-hidden shadow-[0_0_0_0.5px_var(--line-strong)]"
      style={{ width: size, height: size, borderRadius: size < 40 ? 7 : size * 0.225 }}
    >
      <MurmurMark tile size={size} still={size < 40} label="" />
    </span>
  )
}

/** The quiet sign-off at the foot of Settings and About (on phones; wide screens sign the sidebar). */
function Signature() {
  if (useIsWide()) return null
  return (
    <footer className="flex justify-center pt-2">
      <ByUmbrel />
    </footer>
  )
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Every agent; a tap edits it right here. */
function AgentsSection() {
  const { data, isPending } = useAgents()
  const actions = useAgentActions()
  const importer = useImportAgent()
  if (isPending) return <Loading />
  return (
    <>
      <ListGroup>
        {(data ?? []).map((a) => (
          <ListRow
            key={a.id}
            icon={<Orb hue={a.hue} size={28} seed={a.id} />}
            title={a.name}
            subtitle={subtitleFor(a)}
            chevron
            onClick={() => actions.edit(a)}
          />
        ))}
      </ListGroup>
      <ListGroup>
        <ListRow
          icon={
            <Tile>
              <Import size={16} strokeWidth={2} />
            </Tile>
          }
          title={<span className="text-accent">Import an agent</span>}
          trailing={importer.busy ? <Spinner className="text-ink-2" /> : undefined}
          onClick={importer.busy ? undefined : importer.pick}
        />
      </ListGroup>
      {importer.input}
      {actions.sheets}
    </>
  )
}

const subtitleFor = (a: Agent) =>
  [a.isDefault ? 'Main agent' : a.role, a.model && modelName(a.model)].filter(Boolean).join(' · ')

function AboutSection() {
  const version = useHermesVersion()
  const umbrel = useOnUmbrel()
  const current = useHermesConnection().connection
  const builtin = isBuiltinHermes(current)
  const hermesAgent = isUmbrelHermes(current)
  const conn = useConnection()
  const where = useWhereChatsLive()
  const status =
    conn.state === 'open'
      ? { label: 'Connected', tone: 'success' as const }
      : conn.everOpened
        ? { label: 'Reconnecting…', tone: 'warning' as const }
        : { label: 'Not connected', tone: 'danger' as const }

  return (
    <>
      <div className="flex flex-col items-center pt-2 pb-1 text-center">
        <AppIcon size={88} />
        <p className="mt-5 text-title font-semibold tracking-[-0.02em]">Murmur</p>
        <p className="mt-0.5 text-subhead text-ink-2">A beautiful way to use Hermes</p>
        <p className="mt-2 text-footnote text-ink-3 tabular-nums">Version {VERSION}</p>
      </div>
      <ListGroup
        footer={
          builtin
            ? 'Murmur keeps things simple, and its built-in Hermes does the rest.'
            : `Murmur keeps things simple. For everything else Hermes can do, open ${umbrel && hermesAgent ? 'the Hermes Agent app on your Umbrel' : 'Hermes Agent itself'}.`
        }
      >
        <ListRow title="Hermes" detail={version ?? '—'} />
        <ListRow
          title="Connection"
          trailing={
            <span className="flex flex-none items-center gap-2 text-subhead text-ink-2">
              <StatusDot tone={status.tone} />
              {status.label}
            </span>
          }
        />
        {/* The one row that's a sentence: it wraps instead of truncating. */}
        <div className="px-4 py-3">
          <p className="text-body">Where your chats live</p>
          <p className="mt-0.5 text-footnote text-pretty text-ink-2">{builtin ? where : `${where} Murmur keeps nothing.`}</p>
        </div>
      </ListGroup>
      <ListGroup
        footer={
          <>
            Free to use, change and share.{' '}
            <a
              href={LICENSE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-2 underline-offset-2 hover:underline"
            >
              Read the license
            </a>
          </>
        }
      >
        <LinkRow href={HELP_URL} title="Get help" />
        <LinkRow href={SOURCE_URL} title="Open source" detail="MIT" />
      </ListGroup>
      <Signature />
    </>
  )
}

/** Light, dark, or the device's own. Takes effect at once, for every Hermes. */
function Appearance() {
  const [theme, setTheme] = useTheme()
  return (
    <section className="space-y-2">
      <h3 className="px-4 text-footnote font-medium text-ink-2">Appearance</h3>
      <Segmented<ThemePref>
        label="Appearance"
        value={theme}
        onChange={setTheme}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
    </section>
  )
}

/** A ListRow that leaves Murmur: a real link, so it can be long-pressed, copied or opened in a new tab. */
function LinkRow({ href, title, detail }: { href: string; title: string; detail?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-13 w-full items-center gap-3 px-4 py-2.5 transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2"
    >
      <span className="min-w-0 flex-1 truncate text-body">{title}</span>
      {detail && <span className="flex-none text-subhead text-ink-2">{detail}</span>}
      <ArrowUpRight size={18} strokeWidth={2} className="-mr-1 flex-none text-ink-3" aria-label="Opens in a new tab" />
    </a>
  )
}

/** Where a person's chats are kept, in their words: their Umbrel, their computer, or just their Hermes. */
function useWhereChatsLive() {
  const umbrel = useOnUmbrel()
  const connection = useHermesConnection().connection
  const url = connection?.url
  const host = url ? hostOf(url).replace(/:\d+$/, '') : ''
  if (isBuiltinHermes(connection)) return umbrel ? 'On your Umbrel, inside Murmur’s built-in Hermes.' : 'Inside Murmur’s built-in Hermes, kept with Murmur’s data.'
  if (umbrel || /(^|\.)umbrel\.local$/.test(host)) return 'On your Umbrel, inside Hermes.'
  if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|host\.docker\.internal)$/.test(host))
    return 'On your computer, inside Hermes.'
  return 'Inside your Hermes.'
}

function useHermesVersion() {
  return useQuery({
    queryKey: ['hermes-status'],
    queryFn: () => api.get<{ version?: string }>('/api/status'),
    staleTime: 5 * 60_000,
  }).data?.version
}

function MainCardSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="flex animate-fade items-center gap-3 rounded-xl bg-fill-1 p-4 [animation-delay:120ms]"
    >
      {/* Same footprint as the card: a 52px buddy box holding a body-sized arch. */}
      <span className="-ml-2 grid size-13 flex-none place-items-center">
        <Bone className="h-11 w-9 rounded-t-full rounded-b-lg" />
      </span>
      <span className="flex-1">
        <span className="flex h-[26px] items-center">
          <Bone className="h-4 w-2/5 rounded-full" />
        </span>
        <span className="flex h-[22px] items-center">
          <Bone className="h-3 w-3/5 rounded-full opacity-60" />
        </span>
      </span>
    </div>
  )
}

function Loading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="list-group animate-fade overflow-hidden rounded-xl bg-fill-1 [animation-delay:120ms]"
    >
      {[0.5, 0.36, 0.44].map((w, i) => (
        <div key={i} data-has-icon="" className="flex min-h-13 items-center gap-3 px-4 py-2.5">
          <span className="grid size-7 flex-none place-items-center">
            <Bone className="h-6 w-5 rounded-t-full rounded-b-md" />
          </span>
          {/* Line boxes as tall as a name and its subtitle, so nothing shifts when they land. */}
          <span className="flex-1">
            <span className="flex h-6 items-center">
              <Bone className="h-3 rounded-full" style={{ width: `${w * 100}%` }} />
            </span>
            <span className="flex h-[18px] items-center">
              <Bone className="h-2.5 rounded-full opacity-60" style={{ width: `${w * 140}%` }} />
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
