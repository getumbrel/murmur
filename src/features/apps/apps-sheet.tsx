import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { Sheet } from '@/ui/sheet'
import { Grow } from '@/ui/grow'
import type { Agent } from '@/state/agents'
import {
  clearConnection,
  connectApp,
  connectOnUmbrel,
  openSignInTab,
  useAgentApps,
  useCatalog,
  useConnections,
  type CatalogApp,
} from '@/state/apps'
import { MAIL_PROVIDERS, useMailHealth, useMailStatus, type MailProviderId } from '@/state/mail'
import {
  clearHostedConnection,
  hostedAppFrom,
  useConnectedHostedApps,
  useHostedCatalog,
  useHostedConnections,
  useHostedConsent,
  type HostedApp,
} from '@/state/hosted-apps'
import { queueOpeningLine } from '@/features/chat-screen/opening-line'
import { appName } from './app-icon'
import { AppView } from './direct'
import {
  accountTitle,
  EmailConnected,
  EmailForm,
  EmailManage,
  EmailStart,
  emptyDraft,
  INBOX_QUESTION,
  mailOn,
  type Connected,
  type MailDraft,
} from './email'
import { Home } from './home'
import { HostedView, startHosted } from './hosted'
import { OtherApp } from './other'
import { ease } from './parts'

// An agent's apps: the ones it can use, each with how it's doing, then a wall
// of apps to add. Three kinds, one wall:
// - Hermes's own apps (direct.tsx): per agent, signed into in a new tab.
// - Email (email.tsx): the agent's own account, with an app password. It
//   leads the wall; on a Hermes without the plugin (Umbrel's image has it),
//   its first tap adds it.
// - Apps through Nous Research (hosted.tsx): Slack, Asana and others Hermes
//   can't sign in to itself, asked about once, for every agent at once.
// Each opens a view of its own; the sheet's title becomes a way back. Anything
// else with a website is Other (other.tsx): a login, saved in Passwords.

type Props = {
  agent: Agent
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Hands off to Passwords, on a new login: its website filled in when a search was one. */
  onAddLogin: (site?: string) => void
  /** Opened from a chat: a question to try (email's "What needs me in my inbox today?") is asked there, not in a new chat. */
  onAsk?: (question: string) => void
}

type Route =
  | { to: 'list' }
  | { to: 'app'; name: string }
  | { to: 'email' }
  | { to: 'email-form'; provider: MailProviderId }
  | { to: 'email-password' }
  | { to: 'hosted'; slug: string; account?: string }
  | { to: 'other' }

const depth = (r: Route) => (r.to === 'list' ? 0 : r.to === 'email-form' || r.to === 'email-password' ? 2 : 1)

export function AppsSheet({ agent, open, onOpenChange, onAddLogin, onAsk }: Props) {
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const reduce = useReducedMotion()
  // Fetched with the page, so the wall is there the moment the sheet opens.
  const catalog = useCatalog()
  const [route, setRoute] = useState<Route>({ to: 'list' })
  // Watched while Email is open on a Hermes without it, so a plugin added by hand shows by itself.
  const mail = useMailStatus(agent.id, true, { watch: open && route.to === 'email' })
  const hosted = useHostedCatalog()
  const servers = useAgentApps(agent.id, open)
  const connectedHosted = useConnectedHostedApps(open)
  const consent = useHostedConsent(open && hosted.data?.available === true)
  const status = mail.isError ? null : mail.data
  // Hermes said the agent has no email (no plugin), rather than not answering.
  const missing = mail.data === null
  const mailConfigured = !!status?.configured && !!status.account
  // Each check is a real sign-in: only while the sheet is open, and only for an account that's on.
  const mailHealth = useMailHealth(agent.id, open && mailConfigured && !!status && mailOn(status)).data

  const [dir, setDir] = useState(1)
  const [draft, setDraft] = useState<MailDraft>(emptyDraft)
  const [connected, setConnected] = useState<Connected | null>(null)

  const go = (next: Route) => {
    setDir(depth(next) >= depth(route) ? 1 : -1)
    setRoute(next)
    setConnected(null)
  }

  // Closing tidies up: back to the list, and a connection that finished (or didn't) is forgotten.
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => {
      setRoute({ to: 'list' })
      setConnected(null)
      setDraft(emptyDraft())
      const all = useConnections.getState()
      for (const key of Object.keys(all)) {
        const [profile, app] = key.split('\n')
        if (profile === agent.id && (all[key].phase === 'done' || all[key].phase === 'failed')) clearConnection(profile, app)
      }
      for (const [slug, c] of Object.entries(useHostedConnections.getState()))
        if (c.phase === 'done' || c.phase === 'failed') clearHostedConnection(slug)
    }, 400)
    return () => clearTimeout(t)
  }, [open, agent.id])

  const byName = useMemo(() => new Map((catalog.data ?? []).map((a) => [a.name, a])), [catalog.data])

  const connect = (app: CatalogApp, env?: Record<string, string>) => {
    const name = appName(app.name)
    // Opened now, in the tap: a tab opened once Hermes is ready would be blocked.
    const tab = app.auth_type === 'oauth' ? openSignInTab(name) : null
    const added = !!servers.data?.some((s) => s.name === app.name)
    go({ to: 'app', name: app.name })
    void connectApp(qc, agent.id, app, { name, tab, env, added })
  }

  const connectHere = (app: CatalogApp, token: string) => {
    go({ to: 'app', name: app.name })
    void connectOnUmbrel(qc, agent.id, app, appName(app.name), token)
  }

  const hostedApp = (slug: string): HostedApp =>
    hosted.data?.apps.find((a) => a.slug === slug) ??
    connectedHosted.data?.find((c) => c.app.slug === slug)?.app ??
    hostedAppFrom({ slug })

  const back = () => {
    if (route.to === 'app') {
      const phase = useConnections.getState()[`${agent.id}\n${route.name}`]?.phase
      if (phase === 'done' || phase === 'failed') clearConnection(agent.id, route.name)
    }
    if (route.to === 'hosted') {
      const phase = useHostedConnections.getState()[route.slug]?.phase
      if (phase === 'done' || phase === 'failed') clearHostedConnection(route.slug)
    }
    go(route.to === 'email-form' || route.to === 'email-password' ? { to: 'email' } : { to: 'list' })
  }

  const close = () => onOpenChange(false)
  const askInbox = () => {
    close()
    if (onAsk) return onAsk(INBOX_QUESTION)
    queueOpeningLine(agent.id, INBOX_QUESTION)
    navigate(`/chat/${agent.id}/new`)
  }

  const account = status?.account
  const title =
    route.to === 'list'
      ? 'Apps'
      : route.to === 'app'
        ? appName(route.name)
        : route.to === 'email'
          ? 'Email'
          : route.to === 'email-form'
            ? MAIL_PROVIDERS[route.provider].name
            : route.to === 'email-password'
              ? account
                ? accountTitle(account.provider)
                : 'Email'
              : route.to === 'other'
                ? 'Other'
                : hostedApp(route.slug).name
  const backLabel = route.to === 'email-form' || route.to === 'email-password' ? 'Email' : 'Apps'

  // One step deeper slides in from the right, one back from the left (a crossfade under reduced motion).
  const slide: Variants = {
    enter: (d: number) => ({ opacity: 0, x: reduce ? 0 : 16 * d }),
    center: { opacity: 1, x: 0, transition: { duration: reduce ? 0.15 : 0.3, ease } },
    exit: (d: number) => ({ opacity: 0, x: reduce ? 0 : -16 * d, transition: { duration: 0.14 } }),
  }
  const key = `${JSON.stringify(route)}${connected ? ':connected' : ''}`
  // Each view opens at its top, however far down the last one was (Other is the wall's last tile).
  const toTop = useCallback((el: HTMLElement | null) => {
    const body = el?.closest<HTMLElement>('[data-sheet-body]')
    if (body) body.scrollTop = 0
  }, [])

  const view = () => {
    switch (route.to) {
      case 'list':
        return (
          <Home
            agent={agent}
            open={open}
            catalog={catalog.data}
            servers={servers.data}
            failed={catalog.isError || servers.isError}
            mail={mail.isPending ? undefined : status}
            mailMissing={missing}
            mailHealth={mailHealth}
            hosted={hosted.isError ? { available: false, apps: [] } : hosted.data}
            connectedHosted={connectedHosted.data}
            onOpenApp={(name) => go({ to: 'app', name })}
            onAddApp={(app) => (app.required_env.length ? go({ to: 'app', name: app.name }) : connect(app))}
            onEmail={() => go({ to: 'email' })}
            onHosted={(app) => {
              if (consent.data === true) startHosted(qc, app)
              go({ to: 'hosted', slug: app.slug })
            }}
            onOpenHosted={(c) => go({ to: 'hosted', slug: c.app.slug, account: c.account.id })}
            onOther={() => go({ to: 'other' })}
            onAddLogin={onAddLogin}
            onClose={close}
          />
        )
      case 'app':
        return (
          <AppView
            agent={agent}
            name={route.name}
            app={byName.get(route.name)}
            server={servers.data?.find((s) => s.name === route.name)}
            onBack={back}
            onConnect={connect}
            onConnectHere={connectHere}
            onClose={close}
          />
        )
      case 'email':
        return status?.configured && status.account ? (
          <EmailManage
            agent={agent}
            status={status}
            health={mailHealth}
            onChangePassword={() => go({ to: 'email-password' })}
            onRemoved={() => go({ to: 'list' })}
          />
        ) : (
          <EmailStart agent={agent} missing={missing} onPick={(provider) => go({ to: 'email-form', provider })} />
        )
      case 'email-form':
      case 'email-password': {
        if (connected) return <EmailConnected agent={agent} connected={connected} again={route.to === 'email-password'} onAsk={askInbox} onDone={close} />
        const provider = route.to === 'email-form' ? route.provider : (account?.provider ?? 'other')
        return (
          <EmailForm
            agent={agent}
            provider={provider}
            draft={draft}
            onDraft={setDraft}
            onSwitch={(next) => {
              setDir(1)
              setRoute({ to: 'email-form', provider: next })
            }}
            onConnected={(result) => {
              setDir(1)
              setConnected(result)
            }}
            change={route.to === 'email-password' ? account?.address : undefined}
          />
        )
      }
      case 'other':
        return <OtherApp agent={agent} onAddLogin={onAddLogin} />
      case 'hosted': {
        const app = hostedApp(route.slug)
        const accounts = connectedHosted.data?.filter((c) => c.app.slug === route.slug) ?? []
        const account = (accounts.find((c) => c.account.id === route.account) ?? accounts[0])?.account
        return (
          <HostedView
            agent={agent}
            app={app}
            account={account}
            agreed={consent.isError ? false : consent.data}
            onBack={back}
            onClose={close}
          />
        )
      }
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      className="hue-scope"
      style={{ '--hue': agent.hue } as CSSProperties}
      back={route.to === 'list' ? undefined : { label: backLabel, onBack: back }}
      width={520}
    >
      <Grow>
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div key={key} ref={toTop} custom={dir} variants={slide} initial="enter" animate="center" exit="exit">
            {view()}
          </motion.div>
        </AnimatePresence>
      </Grow>
    </Sheet>
  )
}
