import { useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetPin } from '@/ui/sheet'
import { SearchField } from '@/features/search/search-field'
import type { Agent } from '@/state/agents'
import { prettyModel } from '@/features/model/names'
import { ModelList } from '@/features/model/model-list'
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
  const [saving, setSaving] = useState<ModelPick>()

  const groups = options.data?.groups ?? []
  const current = options.data?.current
  const count = groups.reduce((n, g) => n + g.models.length, 0)

  const choose = async (pick: ModelPick) => {
    setSaving(pick)
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
          <SheetPin query={query}>
            <SearchField value={query} onValueChange={setQuery} placeholder="Search models" />
          </SheetPin>
        )}

        <ModelList
          options={options}
          query={query}
          selected={current}
          busy={saving}
          onPick={(pick) => void choose(pick)}
        />
      </div>
    </Sheet>
  )
}
