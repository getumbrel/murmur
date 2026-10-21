import { AppIcon } from '@/features/apps/app-icon'
import { MARKS } from '@/features/apps/marks'
import { IconChip, PasswordsIcon } from '@/ui/icons'

// A site the way a saved login shows it: its brand's mark when Murmur draws
// one (Notion, Stripe, PayPal), otherwise its initial on a colour that's
// always the same for that site. Nothing is fetched: no favicon service hears
// which sites an agent signs in to.

/** The part of a host that names the site: "app.notion.so" → "notion", "github.com" → "github". */
export function siteKey(host: string) {
  const labels = host.replace(/:\d+$/, '').split('.')
  const named = labels.slice(0, -1).reverse().find((label) => MARKS[label])
  return named ?? labels.find((label) => label !== 'www' && label !== 'm') ?? labels[0]
}

export function SiteIcon({ host, size = 28 }: { host?: string; size?: number }) {
  if (!host) return <IconChip icon={PasswordsIcon} size={size} radius={Math.round(size * 0.2237)} />
  return <AppIcon name={siteKey(host)} size={size} />
}
