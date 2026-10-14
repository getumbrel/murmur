import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import { serviceName } from './names'

export type ModelPick = { model: string; provider: string }

// Hermes answers a plain /api/model/options from each provider's model list
// as it last saw it (kept on disk for an hour) and only refreshes stale lists
// in the background, so a first look can miss models a service added since:
// the newest ChatGPT ones, say. The first time each list is shown, Murmur also
// asks Hermes to fetch them fresh, then shows what came back.
const freshened = new Set<string>()

/** Ask Hermes once per page load to fetch a list's models fresh, then reload it. */
export function freshenModels(path: string, reload: () => void) {
  if (freshened.has(path)) return
  freshened.add(path)
  const join = path.includes('?') ? '&' : '?'
  void api.get(`${path}${join}refresh=true`).then(reload, () => freshened.delete(path))
}

export type ModelGroup = {
  provider: string
  name: string
  models: { id: string; reasoning: boolean }[]
}

type Options = {
  model?: string
  provider?: string
  providers: {
    slug: string
    name: string
    authenticated?: boolean
    models: string[]
    capabilities?: Record<string, { reasoning?: boolean }>
  }[]
}

/** Every model this agent can use right now, grouped by the service it comes from. */
export function useModelOptions(profile: string | undefined) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['model-options', profile],
    enabled: Boolean(profile),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const path = `/api/model/options?profile=${encodeURIComponent(profile!)}`
      const res = await api.get<Options>(path)
      freshenModels(path, () => void qc.invalidateQueries({ queryKey: ['model-options', profile] }))
      const groups: ModelGroup[] = res.providers
        // "moa" is a virtual blend of other models, not something to pick.
        .filter((p) => p.slug !== 'moa' && p.authenticated !== false && p.models.length > 0)
        .map((p) => ({
          provider: p.slug,
          name: serviceName(p.slug, p.name),
          models: p.models.map((id) => ({ id, reasoning: p.capabilities?.[id]?.reasoning !== false })),
        }))
      const current: ModelPick | undefined = res.model && res.provider ? { model: res.model, provider: res.provider } : undefined
      return { groups, current }
    },
  })
}

/** The agent's own thinking level, which "Auto" means. */
export function useThinkingDefault(profile: string | undefined) {
  return useQuery({
    queryKey: ['thinking-default', profile],
    enabled: Boolean(profile),
    staleTime: 5 * 60_000,
    queryFn: async () => (await rpc<{ value?: string }>('config.get', { profile, key: 'reasoning' })).value ?? 'medium',
  })
}

/** Make a model (and optionally a thinking level) the default for an agent's new chats. */
export function useSetAgentDefault(profile: string) {
  const qc = useQueryClient()
  return async (pick: ModelPick, effort?: string) => {
    const body = { scope: 'main', profile, ...pick }
    const res = await api.post<{ ok?: boolean; confirm_required?: boolean }>('/api/model/set', body)
    if (res.confirm_required) await api.post('/api/model/set', { ...body, confirm_expensive_model: true })
    if (effort) await rpc('config.set', { profile, key: 'reasoning', value: effort, scope: 'global' })
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['model-options', profile] }),
      qc.invalidateQueries({ queryKey: ['thinking-default', profile] }),
      qc.invalidateQueries({ queryKey: ['agents'] }),
    ])
  }
}
