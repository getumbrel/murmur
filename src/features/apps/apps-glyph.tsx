import { UmbrelIcon } from '@/ui/brand'
import { AppsIcon, IconChip } from '@/ui/icons'
import { UMBREL_SERVER } from '@/state/umbrel-mcp'
import { AppIcon } from './app-icon'

// The Apps tile's icon on an agent's page: the apps it has, in a little
// folder like a phone's, or the lit chip beside it when it has none yet.

export function AppsGlyph({ names }: { names: string[] }) {
  if (!names.length) return <IconChip icon={AppsIcon} size={32} radius={10} />
  return (
    <span aria-hidden className="grid size-8 grid-cols-2 content-start gap-[3px] rounded-[10px] bg-fill-2 p-[4px]">
      {names
        .slice(0, 4)
        .map((name) =>
          name === UMBREL_SERVER ? (
            <UmbrelIcon key={name} size={10.5} className="rounded-[2.5px]" />
          ) : (
            <AppIcon key={name} name={name} size={10.5} className="shadow-none" />
          ),
        )}
    </span>
  )
}
