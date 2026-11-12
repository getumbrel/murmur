import { cn } from '@/lib/cn'
import { useServers } from '@/state/connection'
import { hermesDetail, hostOf } from './describe'

// Choosing among the app's servers: a row of pills, the way a new agent's
// personality is chosen, with where the chosen one is underneath. Only ever
// shown where there's more than one.

type Props = {
  /** What's being chosen, for screen readers ("Lives on", "Server"). */
  label: string
  /** The chosen Hermes's id. */
  value: string | null
  onChange: (hermes: string) => void
  /** Leave out where it is ("umbrel.local · Hermes 0.23.1"), where the screen already says. */
  plain?: boolean
  className?: string
}

export function ServerChips({ label, value, onChange, plain, className }: Props) {
  const servers = useServers()
  const chosen = servers.find((s) => s.id === value)
  return (
    <div className={className}>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {servers.map((s) => {
          const selected = s.id === value
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(s.id)}
              className={cn(
                'pressable h-11 max-w-full truncate rounded-full px-4 text-subhead font-medium select-none',
                selected ? 'bg-accent text-accent-ink' : 'bg-fill-2 text-ink-2 hover:text-ink',
              )}
            >
              {s.name}
            </button>
          )
        })}
      </div>
      {!plain && chosen && (
        <p className="mt-2.5 truncate pl-4 text-footnote text-ink-3">
          {/* Its status once the list is in; where it is meanwhile. */}
          {chosen.status ? hermesDetail({ ...chosen, status: chosen.status } as Parameters<typeof hermesDetail>[0]) : hostOf(chosen.url)}
        </p>
      )}
    </div>
  )
}
