import { useMemo, useState, type CSSProperties } from 'react'
import { Check, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet } from '@/ui/sheet'
import { Segmented } from '@/ui/segmented'
import { Button } from '@/ui/button'
import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import { EFFORT, THINKING_OPTIONS, prettyModel, thinkingOf, type Thinking } from './names'
import { useModelOptions, useSetAgentDefault, useThinkingDefault, type ModelPick } from './use-models'

const HINTS: Record<Thinking, (name: string) => string> = {
  auto: (name) => `${name}’s usual amount of thought.`,
  quick: () => 'Fast answers for everyday things.',
  deep: () => 'Takes longer on harder problems.',
  max: () => 'Thinks as long as it needs. Slowest.',
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: { id: string; name: string; hue: number }
  /** What this chat uses now. */
  pick?: ModelPick
  effort?: string
  onPick: (pick: ModelPick) => void
  onThinking: (thinking: Thinking) => void
}

export function ModelSheet({ open, onOpenChange, agent, pick, effort, onPick, onThinking }: Props) {
  const options = useModelOptions(open ? agent.id : undefined)
  const agentEffort = useThinkingDefault(agent.id).data
  const setDefault = useSetAgentDefault(agent.id)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  const groups = options.data?.groups ?? []
  const fallback = options.data?.current
  const current = pick ?? fallback
  const thinking = thinkingOf(effort, agentEffort)
  const count = groups.reduce((n, g) => n + g.models.length, 0)
  const canReason =
    groups.find((g) => g.provider === current?.provider)?.models.find((m) => m.id === current?.model)?.reasoning ?? true

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

  const isDefault =
    !!current && !!fallback && current.model === fallback.model && current.provider === fallback.provider && thinking === 'auto'

  const makeDefault = async () => {
    if (!current) return
    setSaving(true)
    try {
      await setDefault(current, thinking === 'auto' ? undefined : EFFORT[thinking])
      toast(`${agent.name} will use ${prettyModel(current.model)} for new chats`)
    } catch {
      toast.error('Couldn’t save that. Try again.')
    } finally {
      setSaving(false)
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
      description="Changes apply to this chat."
      footer={
        isDefault ? (
          <p className="flex h-13 items-center justify-center gap-2 text-subhead text-ink-2">
            <Check size={17} strokeWidth={2.25} aria-hidden className="flex-none" />
            <span className="truncate">{agent.name}’s default for new chats</span>
          </p>
        ) : (
          <Button size="lg" variant="secondary" onClick={makeDefault} loading={saving} disabled={!current} className="[&>span]:max-w-full">
            <span className="truncate">Use for all of {agent.name}’s new chats</span>
          </Button>
        )
      }
    >
      <div className="hue-scope space-y-6 pt-3" style={{ '--hue': agent.hue } as CSSProperties}>
        {canReason && (
          <section>
            <h3 className="mb-2 px-4 text-footnote font-medium text-ink-2">Thinking</h3>
            <Segmented value={thinking} options={THINKING_OPTIONS} onChange={onThinking} />
            <p className="mt-2 px-4 text-footnote text-ink-3">{HINTS[thinking](agent.name)}</p>
          </section>
        )}

        {count > 12 && (
          <label className="relative block">
            <Search size={16} strokeWidth={2} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" />
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
          // The list's own shape while it loads: a group label over a few rows.
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
          <p className="py-8 text-center text-subhead text-ink-2">Can’t load models right now. Check that Hermes is running.</p>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-subhead text-ink-3">No models match “{query.trim()}”.</p>
        ) : (
          shown.map((group) => (
            <section key={group.provider}>
              <h3 className="mb-2 px-4 text-footnote font-medium text-ink-2">{group.name}</h3>
              <div role="radiogroup" aria-label={group.name} className="list-group overflow-hidden rounded-xl bg-fill-1">
                {group.models.map((m) => {
                  const selected = current?.model === m.id && current.provider === group.provider
                  const usual = fallback?.model === m.id && fallback.provider === group.provider
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => !selected && onPick({ model: m.id, provider: group.provider })}
                      className="flex min-h-12 w-full items-center gap-3 px-4 text-left transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2"
                    >
                      <span className={cn('min-w-0 flex-1 truncate text-body', selected && 'font-medium')}>{prettyModel(m.id)}</span>
                      {usual && <span className="flex-none text-footnote text-ink-3">Default</span>}
                      <Check
                        size={18}
                        strokeWidth={2.5}
                        aria-hidden
                        className={cn('flex-none text-accent transition-opacity duration-200', !selected && 'opacity-0')}
                      />
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
