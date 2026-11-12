import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { agentsKey, mainAgentFor, useAgents, type Agent } from '@/state/agents'
import { agentsIn, settle, writeRecord } from '@/state/records'
import { prettyModel } from './names'
import type { ModelGroup, ModelPick } from './use-models'

// Pinned models: the few you switch between, on top of every model list.
//
// One list for the whole Hermes, kept on its main agent
// (ui_meta['murmur-pinned-models']) so every device and browser shows the same
// pins, and every agent there: a model one agent can't use just isn't there for it.
// Each pin is `provider::model`, in the order they were pinned, as Hermes
// Desktop writes its favourites. A pin whose service isn't connected right now
// is kept for when it is.

const PINS = 'murmur-pinned-models'

export const pinKey = (pick: ModelPick) => `${pick.provider}::${pick.model}`

export function pinsOf(main: Agent | undefined): string[] {
  const raw = main?.pinsMeta
  return Array.isArray(raw)
    ? [...new Set(raw.filter((k): k is string => typeof k === 'string' && k.includes('::')))]
    : []
}

/** The pins `agent` sees: its Hermes's. */
export function usePins(agent: string) {
  return pinsOf(mainAgentFor(useAgents().data, agent))
}

export async function setPinned(qc: QueryClient, agent: string, pick: ModelPick, on: boolean) {
  await qc.cancelQueries({ queryKey: agentsKey })
  const main = mainAgentFor(agentsIn(qc), agent)
  if (!main) return
  const key = pinKey(pick)
  await writeRecord(qc, main.id, PINS, (a) => [...pinsOf(a).filter((k) => k !== key), ...(on ? [key] : [])])
}

export function useSetPinned(agent: string) {
  const qc = useQueryClient()
  return async (pick: ModelPick, on: boolean) => {
    try {
      await setPinned(qc, agent, pick, on)
    } catch {
      toast.error(`Couldn’t ${on ? 'pin' : 'unpin'} ${prettyModel(pick.model)}. Try again.`)
    } finally {
      settle(qc)
    }
  }
}

// ── The list ────────────────────────────────────────────────────────────────

export type Model = ModelGroup['models'][number]
export type PinnedModel = Model & { provider: string; service: string }

/**
 * The pinned models, in the order they were pinned, then every service's, the
 * pinned ones too (to compare a service's whole range). A search narrows both.
 * `mixed`: the pins come from more than one service, so each says which (two
 * can serve one model).
 */
export function arrange(groups: ModelGroup[], pins: string[], query = '') {
  const q = query.trim().toLowerCase()
  const matches = (id: string, service: string) => !q || `${id} ${prettyModel(id)} ${service}`.toLowerCase().includes(q)
  const all = new Map<string, PinnedModel>()
  for (const g of groups) {
    for (const m of g.models) {
      // A service that's resting says so over its models; up here, each says it.
      all.set(pinKey({ provider: g.provider, model: m.id }), {
        ...m,
        resting: m.resting ?? g.resting,
        provider: g.provider,
        service: g.name,
      })
    }
  }
  const pinned = pins.flatMap((k) => all.get(k) ?? [])
  return {
    pinned: pinned.filter((m) => matches(m.id, m.service)),
    groups: groups
      .map((g) => ({
        ...g,
        models: g.models.filter((m) => matches(m.id, g.name)),
      }))
      .filter((g) => g.models.length),
    mixed: new Set(pinned.map((m) => m.provider)).size > 1,
  }
}
