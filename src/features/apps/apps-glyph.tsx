import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { UmbrelIcon } from '@/ui/brand'
import { AppsIcon, IconChip } from '@/ui/icons'
import { UMBREL_SERVER } from '@/state/umbrel-mcp'
import { AppIcon } from './app-icon'

// An agent's apps as their icons (its email and apps through Nous among
// them). On its page, the Apps tile's icon: a little folder like a phone's,
// or the lit chip beside it when it has none yet. In the composer's +, a
// small overlapping stack at the end of the Apps row (and of Passwords', as
// its sites).

export function AppsGlyph({ names }: { names: string[] }) {
  if (!names.length) return <IconChip icon={AppsIcon} size={32} radius={10} />
  return (
    <span aria-hidden className="grid size-8 grid-cols-2 content-start gap-[3px] rounded-[10px] bg-fill-2 p-[4px]">
      {names
        .slice(0, 4)
        .map((name, i) =>
          name === UMBREL_SERVER ? (
            <UmbrelIcon key={`${name}-${i}`} size={10.5} className="rounded-[2.5px]" />
          ) : (
            <AppIcon key={`${name}-${i}`} name={name} size={10.5} className="shadow-none" />
          ),
        )}
    </span>
  )
}

/**
 * Up to three, each cut out of the surface it sits on so they read apart where they overlap:
 * the menu, with its row's tint over it while the row (`group/item`) is lit. (Each positioned
 * like the icon in it, so its ring is drawn over the icon before.)
 */
export function AppStack({
  names,
  icon,
}: {
  names: string[]
  /** Draws each instead of as an app (Passwords' sites). */
  icon?: (name: string, size: number) => ReactNode
}) {
  return (
    <span aria-hidden className="flex flex-none -space-x-1.5">
      {names.slice(0, 3).map((name, i) => (
        <span
          key={`${name}-${i}`}
          className={cn(
            'relative flex rounded-[5.5px] shadow-[0_0_0_2px_var(--bg-elevated)] ring-2 ring-transparent transition-shadow duration-150',
            'group-hover/item:ring-fill-2 group-focus-visible/item:ring-fill-2 group-active/item:ring-fill-2',
          )}
        >
          {icon ? (
            icon(name, 20)
          ) : name === UMBREL_SERVER ? (
            <UmbrelIcon size={20} className="rounded-[4.5px]" />
          ) : (
            <AppIcon name={name} size={20} />
          )}
        </span>
      ))}
    </span>
  )
}
