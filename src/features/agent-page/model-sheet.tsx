import { useMemo, useState, type CSSProperties } from 'react'
import { Check, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet } from '@/ui/sheet'
import { Skeleton } from '@/ui/skeleton'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import type { Agent } from '@/state/agents'
import { prettyModel } from '@/features/model/names'
import { useModelOptions, useSetAgentDefault, type ModelPick } from '@/features/model/use-models'

// The model an agent starts every new chat with. A tap picks it; chats
// already going keep whatever they use (each chat's own picker changes those).

export function AgentModelSheet({
  agent,
  open,
  onOpenChange,
}: {
  agent: Agent
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const options = useModelOptions(open ? agent.id : undefined)
  const setDefault = useSetAgentDefault(agent.id)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState<string>()

  const groups = options.data?.groups ?? []
  const current = options.data?.current
  const count = groups.reduce((n, g) => n + g.models.length, 0)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map((g) => ({
        ...g,
        models: g.models.filter((m) => `${m.id} ${prettyModel(m.id)} ${g.name}`.toLowerCase().includes(q)),
      }))
      .filter((g) => g.models.length)
  }, [groups, query])

  const choose = async (pick: ModelPick) => {
    const key = `${pick.provider}/${pick.model}`
    setSaving(key)
    try {
      await setDefault(pick)
      toast(`${agent.name} will use ${prettyModel(pick.model)} for new chats`)
      onOpenChange(false)
    } catch {
      toast.error('Couldn’t change the model. Try again.')
    } finally {
      setSaving(undefined)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setQuery('')
      }}
      title="Model"
      description={`What ${agent.name} uses for new chats.`}
    >
      <div className="hue-scope space-y-6 pt-3" style={{ '--hue': agent.hue } as CSSProperties}>
        {count > 12 && (
          <label className="relative block">
            <Search
              size={16}
              strokeWidth={2}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models"
              aria-label="Search models"
              type="search"
              className="h-10 w-full rounded-full bg-fill-2 pr-4 pl-10 text-body text-ink outline-none placeholder:text-ink-3 focus:bg-fill-3 [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
        )}

        {options.isPending ? (
          <section role="status">
            <span className="sr-only">Loading models</span>
            <span className="mb-2 flex h-4.5 items-center px-4">
              <Skeleton className="h-2.5 w-16 rounded-full" />
            </span>
            <div className="list-group overflow-hidden rounded-xl bg-fill-1">
              {[44, 58, 36, 50].map((w, i) => (
                <div key={i} className="flex min-h-12 items-center px-4">
                  <Skeleton className="h-3.5 rounded-full" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          </section>
        ) : options.isError ? (
          <p className="py-8 text-center text-subhead text-ink-2">
            Can’t load models right now. Check that Hermes is running.
          </p>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-subhead text-ink-3">
            {query.trim() ? `No models match “${query.trim()}”.` : 'No models are set up yet.'}
          </p>
        ) : (
          shown.map((group) => (
            <section key={group.provider}>
              <h3 className="mb-2 px-4 text-footnote font-medium text-ink-2">{group.name}</h3>
              <div role="radiogroup" aria-label={group.name} className="list-group overflow-hidden rounded-xl bg-fill-1">
                {group.models.map((m) => {
                  const selected = current?.model === m.id && current.provider === group.provider
                  const busy = saving === `${group.provider}/${m.id}`
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={!!saving}
                      onClick={() => !selected && void choose({ model: m.id, provider: group.provider })}
                      className="flex min-h-12 w-full items-center gap-3 px-4 text-left transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2"
                    >
                      <span className={cn('min-w-0 flex-1 truncate text-body', selected && 'font-medium')}>
                        {prettyModel(m.id)}
                      </span>
                      {busy ? (
                        <Spinner size={16} className="flex-none text-ink-3" />
                      ) : (
                        <Check
                          size={18}
                          strokeWidth={2.5}
                          aria-hidden
                          className={cn('flex-none text-accent transition-opacity duration-200', !selected && 'opacity-0')}
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </Sheet>
  )
}
