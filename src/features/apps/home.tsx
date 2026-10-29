import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'wouter'
import { ListGroup, ListRow } from '@/ui/list'
import { UmbrelIcon } from '@/ui/brand'
import type { Agent } from '@/state/agents'
import { useHermesOnUmbrel, UMBREL_SERVER } from '@/state/umbrel-mcp'
import { useAppHealth, useConnections, type AppServer, type CatalogApp } from '@/state/apps'
import type { MailHealth, MailStatus } from '@/state/mail'
import type { ConnectedHostedApp, HostedApp, HostedCatalog } from '@/state/hosted-apps'
import { AppIcon, appName, EMAIL_ICON } from './app-icon'
import { AppRow, hostOf, isBusy } from './direct'
import { EmailRow } from './email'
import { HostedRow } from './hosted'
import { RowsLoading, SearchField, Tile, WallGrid, WallLoading } from './parts'
import { arrangeWall, itemHint, itemName, searchWall, type WallItem } from './wall'

// The sheet's first view: what the agent can use (its apps, its email, apps
// through Nous), each with how it's doing, then a wall of apps to add.

/** How long the wall waits for Nous's apps before showing without them (they join when they come). */
const NOUS_WAIT_MS = 2000

export function Home({
  agent,
  open,
  catalog,
  servers,
  failed,
  mail,
  mailMissing,
  mailHealth,
  hosted,
  connectedHosted,
  onOpenApp,
  onAddApp,
  onEmail,
  onHosted,
  onOpenHosted,
  onClose,
}: {
  agent: Agent
  open: boolean
  catalog: CatalogApp[] | undefined
  servers: AppServer[] | undefined
  failed: boolean
  /** The agent's email: undefined while Murmur asks, null when it has none to show. */
  mail: MailStatus | null | undefined
  /** The agent's Hermes doesn't have email yet: the Email tile still leads, and adds it. */
  mailMissing: boolean
  mailHealth: MailHealth | undefined
  /** Nous's apps: undefined while Murmur asks. */
  hosted: HostedCatalog | undefined
  connectedHosted: ConnectedHostedApp[] | undefined
  onOpenApp: (name: string) => void
  onAddApp: (app: CatalogApp) => void
  onEmail: () => void
  onHosted: (app: HostedApp) => void
  onOpenHosted: (connected: ConnectedHostedApp) => void
  onClose: () => void
}) {
  const [, navigate] = useLocation()
  const onUmbrel = useHermesOnUmbrel().data
  const [query, setQuery] = useState('')
  const health = useAppHealth(agent.id, servers, open)
  const connections = useConnections()
  const waited = useWaited(NOUS_WAIT_MS)

  const umbrel = servers?.find((s) => s.name === UMBREL_SERVER)
  const mine = (servers ?? []).filter((s) => s.name !== UMBREL_SERVER && !s.name.startsWith(`${UMBREL_SERVER}-`))
  const email = mail?.configured && mail.account ? mail : null
  const viaNous = connectedHosted ?? []
  const perApp = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of viaNous) counts.set(c.app.slug, (counts.get(c.app.slug) ?? 0) + 1)
    return counts
  }, [viaNous])

  const wall = useMemo(
    () =>
      arrangeWall({
        direct: catalog ?? [],
        hosted: hosted?.available ? hosted.apps : [],
        nameOf: appName,
        email: mail ? !mail.configured : mailMissing,
        added: new Set(servers?.map((s) => s.name)),
        connectedSlugs: new Set(viaNous.map((c) => c.app.slug)),
      }),
    [catalog, hosted, mail, mailMissing, servers, viaNous],
  )
  // The wall waits for what decides its order (email leads, Nous's apps sit among the rest), so nothing jumps.
  const ready = !!catalog && mail !== undefined && (hosted !== undefined || waited)

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

  const tile = (item: WallItem, i: number) => {
    const name = itemName(item, appName)
    const icon = item.kind === 'email' ? EMAIL_ICON : item.kind === 'direct' ? item.app.name : item.app.icon
    const onClick =
      item.kind === 'email' ? onEmail : item.kind === 'direct' ? () => onAddApp(item.app) : () => onHosted(item.app)
    return (
      <Tile key={item.key} name={name} hint={itemHint(item)} index={i} onClick={onClick}>
        <AppIcon name={icon} size={56} />
      </Tile>
    )
  }
  const words = query.trim()
  const found = words ? searchWall(wall, words, appName) : []
  const has = mine.length > 0 || !!umbrel || !!email || viaNous.length > 0
  const umbrelTile = onUmbrel && !umbrel && (
    <Tile key="umbrel" name="Umbrel" hint="Apps, files and more on your Umbrel" index={1} onClick={toUmbrel}>
      <UmbrelIcon size={56} />
    </Tile>
  )

  return (
    <div className="space-y-7 pt-1">
      {!servers ? (
        <RowsLoading />
      ) : (
        has && (
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
            {email && <EmailRow agent={agent} status={email} health={mailHealth} onOpen={onEmail} />}
            {mine.map((s) => (
              <AppRow
                key={s.name}
                agent={agent}
                server={s}
                description={catalog?.find((a) => a.name === s.name)?.description ?? (s.url ? hostOf(s.url) : '')}
                health={health[s.name]}
                busy={isBusy(connections[`${agent.id}\n${s.name}`]?.phase)}
                onOpen={() => onOpenApp(s.name)}
              />
            ))}
            {viaNous.map((c) => (
              <HostedRow
                key={c.account.id}
                app={c.app}
                account={c.account}
                label={(perApp.get(c.app.slug) ?? 0) > 1}
                onOpen={() => onOpenHosted(c)}
              />
            ))}
          </ListGroup>
        )
      )}

      <section>
        <div className="mb-4 flex items-center gap-3">
          <h3 className="min-w-0 flex-1 px-1 text-subhead font-semibold tracking-[-0.01em]">
            {has ? 'Add more' : `Give ${agent.name} an app`}
          </h3>
          <SearchField value={query} onChange={setQuery} />
        </div>

        {!ready ? (
          <WallLoading />
        ) : words ? (
          found.length ? (
            <WallGrid>{found.map(tile)}</WallGrid>
          ) : (
            <p className="py-8 text-center text-subhead text-ink-3">No apps match “{words}”</p>
          )
        ) : (
          <>
            <WallGrid>
              {withLead(wall.everyday.map(tile), umbrelTile, wall.everyday[0]?.kind === 'email' ? 1 : 0)}
            </WallGrid>
            {wall.developer.length > 0 && (
              <>
                <h3 className="mt-8 mb-4 px-1 text-footnote font-medium text-ink-2">For developers</h3>
                <WallGrid>{wall.developer.map(tile)}</WallGrid>
              </>
            )}
          </>
        )}
      </section>
    </div>
  )
}

/** The Umbrel tile, right after Email (or first without it). */
function withLead(tiles: ReactNode[], lead: ReactNode, at: number) {
  if (!lead) return tiles
  return [...tiles.slice(0, at), lead, ...tiles.slice(at)]
}

/** True once `ms` have passed since the view first showed. */
function useWaited(ms: number) {
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), ms)
    return () => clearTimeout(t)
  }, [ms])
  return waited
}
