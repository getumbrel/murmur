import { useMemo } from 'react'
import type { Agent } from '@/state/agents'
import { useCatalog } from '@/state/apps'
import { useMailStatus } from '@/state/mail'
import { useHostedCatalog } from '@/state/hosted-apps'
import { AppsIcon, IconChip } from '@/ui/icons'
import { PlusAside, PlusLine, type PlusItem } from '@/features/chat/plus-menu'
import { appName } from './app-icon'
import { AppStack } from './apps-glyph'
import { namesLine, offerLine, useAppsGlance } from './glance'
import { arrangeWall, itemName } from './wall'

// Apps in the composer's +, so they're found where you talk: the ones the
// agent uses now, named underneath and their icons at the end; with none
// yet, the first it could have. It opens the Apps sheet over the chat.

export function useAppsPlusItem(agent: Agent | undefined, onOpen: () => void): PlusItem | undefined {
  const on = !!agent
  const id = agent?.id ?? ''
  const glance = useAppsGlance(id, on)
  // What the wall would offer first, for an agent with nothing yet.
  const catalog = useCatalog(on)
  const mail = useMailStatus(id, on)
  const hosted = useHostedCatalog(on).data
  const offer = useMemo(() => {
    if (!catalog.data || mail.isPending) return undefined
    const status = mail.isError ? null : mail.data
    const wall = arrangeWall({
      direct: catalog.data,
      hosted: hosted?.available ? hosted.apps : [],
      nameOf: appName,
      email: !!status && !status.configured,
      added: new Set(),
      connectedSlugs: new Set(),
    })
    return offerLine(wall, (item) => itemName(item, appName)) ?? null
  }, [catalog.data, mail.isPending, mail.isError, mail.data, hosted])

  if (!agent) return undefined
  const none = `Give ${agent.name} an app`
  const line = () => {
    if (glance.busy) return 'Connecting…'
    if (!glance.loaded) return undefined
    if (glance.on.length) return namesLine(glance.on.map((a) => a.name))
    if (glance.any) return 'All off'
    if (catalog.isError) return none
    return offer === undefined ? undefined : (offer ?? none)
  }
  return {
    key: 'apps',
    label: 'Apps',
    icon: <IconChip icon={AppsIcon} size={32} radius={10} />,
    detail: <PlusLine text={line()} />,
    aside: <PlusAside>{glance.on.length > 0 && <AppStack names={glance.on.map((a) => a.icon)} />}</PlusAside>,
    onSelect: onOpen,
  }
}
