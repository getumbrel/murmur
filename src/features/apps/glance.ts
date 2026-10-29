import { useAgentApps, useConnections } from '@/state/apps'
import { MAIL_PROVIDERS, useMailStatus } from '@/state/mail'
import { useConnectedHostedApps, useHostedConnections } from '@/state/hosted-apps'
import { appName } from './app-icon'
import { mailIcon } from './email-form'
import type { Wall } from './wall'

// An agent's apps at a glance, where they show small: the Apps tile on its
// page and the Apps line in the composer's +. What it can use right now (its
// email, its own apps, and apps through Nous, which every agent shares), each
// as its icon and its name.

export type AppOn = { icon: string; name: string }

export function useAppsGlance(agentId: string, enabled = true) {
  const apps = useAgentApps(agentId, enabled).data
  const mail = useMailStatus(agentId, enabled).data
  const viaNous = useConnectedHostedApps(enabled).data
  const directBusy = useConnections((all) =>
    Object.entries(all).some(
      ([key, c]) => key.startsWith(`${agentId}\n`) && c.phase !== 'done' && c.phase !== 'failed',
    ),
  )
  const nousBusy = useHostedConnections((all) =>
    Object.values(all).some((c) => c.phase !== 'done' && c.phase !== 'failed'),
  )
  const account = mail?.account
  const on: AppOn[] = [
    ...(account && mail.enabled && !mail.off
      ? [
          {
            icon: mailIcon(account.provider),
            name: account.provider === 'other' ? 'Email' : MAIL_PROVIDERS[account.provider].name,
          },
        ]
      : []),
    ...(apps ?? [])
      .filter((a) => a.enabled && !a.name.startsWith('umbrel-'))
      .map((a) => ({ icon: a.name, name: appName(a.name) })),
    ...(viaNous ?? [])
      .filter((c) => c.account.state === 'connected')
      .map((c) => ({ icon: c.app.icon, name: c.app.name })),
  ]
  return {
    on,
    /** Everything it has, on or not. */
    any: (apps?.length ?? 0) + (account ? 1 : 0) + (viaNous?.length ?? 0),
    /** Its own apps are in (its email and Nous's join when they come). */
    loaded: !!apps,
    busy: directBusy || nousBusy,
  }
}

/** "Gmail", "Gmail and Slack", "Gmail, Slack and GitHub", "Gmail, Slack and 2 more". */
export function namesLine(names: readonly string[]) {
  const unique = [...new Set(names)]
  if (unique.length > 3) return `${unique.slice(0, 2).join(', ')} and ${unique.length - 2} more`
  if (unique.length === 3) return `${unique[0]}, ${unique[1]} and ${unique[2]}`
  return unique.join(' and ')
}

/** What an agent with no apps could have: the wall's first two ("Email, Notion and more"). */
export function offerLine(wall: Wall, nameOf: (item: Wall['everyday'][number]) => string) {
  const names = wall.everyday.map(nameOf)
  // Email covers Gmail, so after it, Gmail would say the same thing twice.
  const shown = (names[0] === 'Email' ? names.filter((n) => n !== 'Gmail') : names).slice(0, 2)
  return shown.length ? `${shown.join(', ')} and more` : undefined
}
