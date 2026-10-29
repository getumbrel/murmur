import type { Agent } from '@/state/agents'
import { cardFromLabel, hostOf, useVault, type CardBrand, type VaultEntry, type VaultKind } from '@/state/vault'
import { CardIcon, IconChip, PasswordsIcon } from '@/ui/icons'
import { PlusAside, PlusLine, type PlusItem } from '@/features/chat/plus-menu'
import { AppStack } from '@/features/apps/apps-glyph'
import { namesLine } from '@/features/apps/glance'
import { MARKS } from '@/features/apps/marks'
import { CardFace } from './card-face'
import { SiteIcon, siteKey } from './site-icon'

// Passwords and cards in the composer's +, after the apps: the sites the
// agent can sign in to and the cards it can pay with, named underneath and
// shown at the end; with none yet, what one would let it do. Each opens the
// Passwords sheet over the chat, straight to its form while there are none.

export function useVaultPlusItems(agent: Agent | undefined, onOpen: (start?: VaultKind) => void): PlusItem[] {
  const vault = useVault(agent?.id ?? '', { enabled: !!agent })
  if (!agent) return []
  // Unread, the lines wait. Unreadable, they say what each is for, and the sheet says what's wrong.
  const { logins, cards } = vaultGlance(vault.isError ? [] : vault.data, agent.name)
  const fresh = (kind: { none: boolean } | undefined) => vault.isSuccess && !!kind?.none
  return [
    {
      key: 'passwords',
      label: 'Passwords',
      icon: <IconChip icon={PasswordsIcon} size={32} radius={10} />,
      detail: <PlusLine text={logins?.line} />,
      aside: (
        <PlusAside>
          {!!logins?.sites.length && (
            <AppStack names={logins.sites} icon={(host, size) => <SiteIcon host={host} size={size} />} />
          )}
        </PlusAside>
      ),
      onSelect: () => onOpen(fresh(logins) ? 'login' : undefined),
    },
    {
      key: 'cards',
      label: 'Cards',
      icon: <IconChip icon={CardIcon} size={32} radius={10} />,
      detail: <PlusLine text={cards?.line} />,
      aside: <PlusAside>{cards && !cards.none && <CardFace size="row" brand={cards.brand} />}</PlusAside>,
      onSelect: () => onOpen(fresh(cards) ? 'payment' : undefined),
    },
  ]
}

type Glance = { line: string; none: boolean }

/** What the two say and show, from an agent's items (nothing while they're read). */
export function vaultGlance(
  entries: VaultEntry[] | undefined,
  agentName: string,
): { logins?: Glance & { sites: string[] }; cards?: Glance & { brand?: CardBrand } } {
  if (!entries) return {}
  const logins = entries.filter((e) => e.kind === 'login')
  const cards = entries.filter((e) => e.kind === 'payment')
  const hosts = logins.map((e) => hostOf(e.origin ?? e.label))
  return {
    logins: {
      line: logins.length ? namesLine(hosts.map(siteName)) : `Let ${agentName} sign in for you`,
      none: !logins.length,
      // The first saved for each site.
      sites: hosts.filter((host, i) => hosts.findIndex((h) => siteKey(h) === siteKey(host)) === i),
    },
    cards: {
      line: !cards.length
        ? `Let ${agentName} check out for you`
        : cards.length > 1
          ? `${cards[0].label} and ${cards.length - 1} more`
          : cards[0].label,
      none: !cards.length,
      brand: cards[0] && cardFromLabel(cards[0].label).brand,
    },
  }
}

/** A site as people say it: "GitHub" for github.com, or its host when Murmur has no name for it. */
const siteName = (host: string) => MARKS[siteKey(host)]?.[0] ?? host
