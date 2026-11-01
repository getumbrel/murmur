import { useState, type CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetPin } from '@/ui/sheet'
import { Segmented } from '@/ui/segmented'
import { Button } from '@/ui/button'
import { SearchField } from '@/features/search/search-field'
import { EFFORT, THINKING_OPTIONS, prettyModel, thinkingOf, type Thinking } from './names'
import { useModelOptions, useSetAgentDefault, useThinkingDefault, type ModelPick } from './use-models'
import { ModelList } from './model-list'

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
          <SheetPin query={query}>
            <SearchField value={query} onValueChange={setQuery} placeholder="Search models" />
          </SheetPin>
        )}

        <ModelList options={options} query={query} selected={current} usual={fallback} onPick={onPick} />
      </div>
    </Sheet>
  )
}
