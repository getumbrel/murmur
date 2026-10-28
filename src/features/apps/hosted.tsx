import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowUpRight } from 'lucide-react'
import { Button } from '@/ui/button'
import { ConfirmCard } from '@/ui/confirm-card'
import { Buddy } from '@/ui/buddy'
import { Spinner } from '@/ui/spinner'
import { ListGroup, ListRow } from '@/ui/list'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { isDesktop } from '@/lib/desktop'
import { useAgents, type Agent } from '@/state/agents'
import { openSignInTab, showSignIn } from '@/state/apps'
import {
  agreeToHostedApps,
  cancelHostedConnect,
  connectHostedApp,
  disconnectHostedApp,
  NOUS_PRIVACY_URL,
  openHostedSignIn,
  useHostedConnection,
  useHostedConnections,
  type HostedAccount,
  type HostedApp,
} from '@/state/hosted-apps'
import { AppIcon } from './app-icon'
import { AppHeader, Heading, Link, Pair, RowStatus, ease, lift, OutLink } from './parts'

// Apps connected through Nous Research, the makers of Hermes (state/hosted-apps.ts):
// Slack, Asana, Box and the rest that Hermes can't sign in to itself. Nous
// signs the person in and calls the app for the agent, so the app's data
// passes through Nous's servers. That's asked once per Hermes, with the path
// drawn, before the first one connects. An app connected this way is there
// for every agent on this Hermes: there's no switch per agent, only
// Disconnect, which removes the account at Nous too.

const live = (phase: string | undefined) => phase === 'starting' || phase === 'signing-in' || phase === 'blocked'

/** Starts connecting an app through Nous, from a tap (its sign-in tab opens in the tap). */
export function startHosted(qc: ReturnType<typeof useQueryClient>, app: HostedApp, account?: HostedAccount) {
  if (live(useHostedConnections.getState()[app.slug]?.phase)) return
  const tab = openSignInTab(app.name)
  void connectHostedApp(qc, app, { tab, account }).catch(() => tab?.close())
}

// ── In the list ─────────────────────────────────────────────────────────────

/** An app connected through Nous: what it's for, quietly where it comes from, and the way in. */
export function HostedRow({
  app,
  account,
  label,
  onOpen,
}: {
  app: HostedApp
  account: HostedAccount
  /** Several accounts of one app: say which this is. */
  label?: boolean
  onOpen: () => void
}) {
  const busy = live(useHostedConnection(app.slug)?.phase)
  const what = label ? account.alias || account.label : app.summary || account.label
  const line: ReactNode = busy ? (
    'Signing in…'
  ) : account.state === 'signin' ? (
    <>
      <span className="text-accent">Sign in again</span>
      <span className="text-ink-3"> · via Nous</span>
    </>
  ) : (
    <>
      {what}
      <span className="text-ink-3">{what ? ' · ' : ''}via Nous</span>
    </>
  )
  return (
    <ListRow
      icon={<AppIcon name={app.icon} size={30} />}
      title={app.name}
      subtitle={<RowStatus id={busy ? 'busy' : account.state}>{line}</RowStatus>}
      onClick={onOpen}
      chevron
      className="min-h-15"
    />
  )
}

// ── One app ─────────────────────────────────────────────────────────────────

export function HostedView({
  agent,
  app,
  account,
  agreed,
  onBack,
  onClose,
}: {
  agent: Agent
  app: HostedApp
  account: HostedAccount | undefined
  /** The person agreed to apps through Nous on this Hermes (undefined while Murmur asks Hermes). */
  agreed: boolean | undefined
  onBack: () => void
  onClose: () => void
}) {
  const connection = useHostedConnection(app.slug)
  // Asked here: the question stays while the answer is kept and the path draws, until the sign-in takes over.
  const [asked, setAsked] = useState(agreed === false)
  if (agreed === false && !asked) setAsked(true)
  if (connection) return <Connecting agent={agent} app={app} account={account} onBack={onBack} onClose={onClose} />
  if (account) return <Manage agent={agent} app={app} account={account} onBack={onBack} />
  if (asked) return <Consent agent={agent} app={app} onBack={onBack} />
  if (agreed === undefined)
    return (
      <div className="grid min-h-60 place-items-center" aria-busy aria-label="Loading">
        <Spinner />
      </div>
    )
  return <Landing app={app} />
}

/** Where the app's data goes, drawn: the app, Nous in the middle, the agent. It fills once the person agrees. */
function Path({ agent, app, agreeing }: { agent: Agent; app: HostedApp; agreeing: boolean }) {
  return (
    <div className="flex items-start justify-center pt-3" role="img" aria-label={`${app.name}, then Nous Research, then ${agent.name}`}>
      <Node label={app.name}>
        <AppIcon name={app.icon} size={60} className={lift} />
      </Node>
      <span className="mx-2 mt-[29px]">
        <Link state={agreeing ? 'linked' : 'linking'} width="w-6" />
      </span>
      <Node label="Nous Research">
        <span className="grid size-[60px] place-items-center">
          <AppIcon name="nous" size={44} />
        </span>
      </Node>
      <span className="mx-2 mt-[29px]">
        <Link state={agreeing ? 'linked' : 'linking'} width="w-6" delay={0.22} />
      </span>
      <Node label={agent.name}>
        <Buddy hue={agent.hue} seed={agent.id} size={60} state={agreeing ? 'done' : 'waiting'} />
      </Node>
    </div>
  )
}

const Node = ({ label, children }: { label: string; children: ReactNode }) => (
  <span aria-hidden className="flex w-[88px] flex-col items-center gap-2">
    {children}
    <span className="max-w-full truncate text-caption text-ink-2">{label}</span>
  </span>
)

/** The first app through Nous: where its data goes, asked once for this Hermes. */
function Consent({ agent, app, onBack }: { agent: Agent; app: HostedApp; onBack: () => void }) {
  const qc = useQueryClient()
  const reduce = useReducedMotion()
  const agents = useAgents().data
  const [agreeing, setAgreeing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agree = async () => {
    if (agreeing) return
    // Opened now, in the tap: a tab opened once Hermes is ready would be blocked.
    const tab = openSignInTab(app.name)
    setAgreeing(true)
    setError(null)
    const drawn = new Promise((r) => setTimeout(r, reduce ? 0 : 720))
    try {
      await agreeToHostedApps(qc, (agents ?? [agent]).map((a) => a.id))
    } catch {
      tab?.close()
      setAgreeing(false)
      return setError('Couldn’t save your answer. Check that Hermes is running, then try again.')
    }
    haptic('tick')
    // The path draws itself before the sign-in takes over.
    await drawn
    void connectHostedApp(qc, app, { tab }).catch(() => tab?.close())
  }

  return (
    <div className="pb-1">
      <Path agent={agent} app={app} agreeing={agreeing} />
      <Heading title={`${app.name} connects through Nous Research`}>
        Nous Research makes Hermes. {app.name}’s data passes through their servers on its way to {agent.name}.
      </Heading>
      <div className="mt-3 text-center">
        <OutLink href={NOUS_PRIVACY_URL}>
          How Nous handles your data
          <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden />
        </OutLink>
      </div>
      <div className="mt-7 grid gap-2">
        <Button variant="accent" size="lg" onClick={() => void agree()} loading={agreeing}>
          Continue
        </Button>
        <Button size="lg" variant="ghost" className="text-ink-2" onClick={onBack} disabled={agreeing}>
          Not now
        </Button>
      </div>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease }}
            className="mt-2 px-4 text-center text-footnote text-pretty text-danger"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
      <p className="mt-1 text-center text-footnote text-pretty text-ink-3">
        Asked once. Other apps like this connect straight away.
      </p>
    </div>
  )
}

/** An app through Nous, agreed to but not connected (back from a cancelled sign-in). */
function Landing({ app }: { app: HostedApp }) {
  const qc = useQueryClient()
  return (
    <div className="pb-1">
      <AppHeader icon={app.icon} title={app.name}>
        {app.description || `Connects through Nous Research.`}
      </AppHeader>
      <div className="mt-7">
        <Button variant="accent" size="lg" onClick={() => startHosted(qc, app)}>
          Connect
        </Button>
      </div>
      {app.description && <p className="mt-3 text-center text-footnote text-ink-3">Connects through Nous Research.</p>}
    </div>
  )
}

/** A connection under way, or how it went. */
function Connecting({
  agent,
  app,
  account,
  onBack,
  onClose,
}: {
  agent: Agent
  app: HostedApp
  account: HostedAccount | undefined
  onBack: () => void
  onClose: () => void
}) {
  const qc = useQueryClient()
  const connection = useHostedConnection(app.slug)!
  const others = (useAgents().data ?? []).filter((a) => a.id !== agent.id).length
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
      <Pair agent={agent} icon={app.icon} state={done ? 'linked' : phase === 'failed' ? 'broken' : 'linking'} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={phase === 'blocked' ? 'signing-in' : phase}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.14 } }}
          transition={{ duration: 0.32, ease }}
          aria-live="polite"
        >
          {phase === 'starting' && (
            <>
              <Heading title={`Connecting ${app.name}`}>
                {isDesktop ? 'Its sign-in opens in your browser.' : 'Its sign-in opens in a new tab.'}
              </Heading>
              <div className="mt-7 grid place-items-center">
                <Spinner />
              </div>
              <div className="mt-5 grid">
                <Button
                  size="lg"
                  variant="ghost"
                  className="text-ink-2"
                  onClick={() => {
                    void cancelHostedConnect(qc, app.slug)
                    onBack()
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
          {(phase === 'signing-in' || phase === 'blocked') && (
            <>
              <Heading title={`Sign in to ${app.name}`}>
                {phase === 'blocked' ? `Then ${agent.name} can use it.` : `Finish in the new tab, and ${agent.name} can use it.`}
              </Heading>
              <div className="mt-7 grid gap-2">
                <Button
                  variant={phase === 'blocked' ? 'accent' : 'secondary'}
                  size="lg"
                  onClick={() =>
                    phase === 'blocked' ? openHostedSignIn(app.slug) : connection.url && showSignIn(connection.url)
                  }
                >
                  {phase === 'blocked' ? `Continue to ${app.name}` : `Open ${app.name} again`}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="text-ink-2"
                  onClick={() => {
                    void cancelHostedConnect(qc, app.slug)
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
              <Heading title={`${agent.name} can now use ${app.name}`}>
                {[app.description, others ? (others === 1 ? 'So can your other agent.' : 'So can your other agents.') : '']
                  .filter(Boolean)
                  .join(' ')}
              </Heading>
              <div className="mt-7 grid">
                <Button variant="accent" size="lg" onClick={onClose}>
                  Done
                </Button>
              </div>
            </>
          )}
          {phase === 'failed' && (
            <>
              <Heading title={`Couldn’t connect ${app.name}`}>{connection.message}</Heading>
              <div className="mt-7 grid gap-2">
                <Button variant="accent" size="lg" onClick={() => startHosted(qc, app, account?.state === 'signin' ? account : undefined)}>
                  Try again
                </Button>
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

/** A connected app through Nous: where it comes from, signing in again, and disconnecting it everywhere. */
function Manage({ agent, app, account, onBack }: { agent: Agent; app: HostedApp; account: HostedAccount; onBack: () => void }) {
  const qc = useQueryClient()
  const others = (useAgents().data ?? []).length > 1

  const disconnect = () => {
    onBack()
    disconnectHostedApp(qc, account, app.name).catch((e: Error) => toast.error(e.message))
  }

  return (
    <div className="pb-1">
      <AppHeader icon={app.icon} title={app.name}>
        {account.label || app.description}
      </AppHeader>
      <div className="mt-7 space-y-6">
        {account.state === 'signin' && (
          <ListGroup>
            <ListRow
              title="Sign in again"
              subtitle={<span className="text-accent">{app.name} needs you to sign in</span>}
              onClick={() => startHosted(qc, app, account)}
              chevron
            />
          </ListGroup>
        )}
        <ListGroup>
          <ListRow
            icon={<AppIcon name="nous" size={30} />}
            title="Through Nous Research"
            subtitle={others ? 'All your agents can use it' : `${agent.name} can use it`}
          />
          <ListRow
            title="How Nous handles your data"
            onClick={() => window.open(NOUS_PRIVACY_URL, '_blank', 'noopener,noreferrer')}
            trailing={<ArrowUpRight size={18} strokeWidth={2} className={cn('-mr-1 flex-none text-ink-3')} aria-hidden />}
          />
        </ListGroup>
        <ConfirmCard
          label="Disconnect"
          title={`Disconnect ${app.name}?`}
          body={`${others ? 'None of your agents will' : `${agent.name} won’t`} be able to use it, and the account is removed from Nous Research. You can connect it again any time.`}
          confirm="Disconnect"
          onConfirm={disconnect}
        />
      </div>
    </div>
  )
}
