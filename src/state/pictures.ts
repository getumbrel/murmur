// "Let agents make pictures": Hermes' image tool, drawing through the ChatGPT
// sign-in (gpt-image-2 on the person's plan, no extra key).
//
// Hermes keeps the picture service per agent: each profile's config.yaml has
// its own image_gen.provider and its own tool list, and a new agent starts
// from fresh config rather than a copy of the main one. So one switch here
// means writing every agent, and agents made later are caught up by
// usePicturesSync() / ensurePicturesFor(), quietly in the background (see
// lib/upkeep). The main agent is the source of truth for the switch's state.
//
//   on  → PUT /api/tools/toolsets/image_gen/provider {provider: <ChatGPT row>}
//         and make sure the image_gen tool is switched on
//   off → PUT /api/tools/toolsets/image_gen {enabled: false}
//         (Hermes has no "no provider" choice, so off means the tool is off)
//
// Pictures land as files the agent mentions in its reply (Hermes' image cache).
//
// Hermes hides some tools behind its tool search (config tools.tool_search.defer)
// and image_generate is on that list by default, so an agent only finds it when
// asked outright. With pictures on, each agent's list is rewritten without it so
// the agent knows it can draw. An explicit list replaces Hermes's default
// wholesale, freezing the defaults of the Hermes that wrote it, so the list is
// rebuilt from this Hermes's defaults (plus anything the agent added) each time
// it falls out of step, e.g. after a Hermes update.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import { rememberedSet, upkeep } from '@/lib/upkeep'
import { scoped } from '@/hermes/instance'
import { listProfileNames } from '@/hermes/compat'

type ProviderRow = { name: string; post_setup?: string | null; is_active: boolean; status: string }
type ImageConfig = { providers: ProviderRow[] }
type ToolsetRow = { name: string; enabled: boolean }

const MAIN = 'default'
const q = (profile: string) => `?profile=${encodeURIComponent(profile)}`

/** The ChatGPT row in Hermes' picture-service list ("OpenAI (Codex auth)" in v0.21). */
const chatgptRow = (c: ImageConfig) =>
  c.providers.find((p) => p.post_setup === 'openai_codex') ?? c.providers.find((p) => /codex/i.test(p.name))

async function read(profile: string) {
  const [toolsets, config] = await Promise.all([
    api.get<ToolsetRow[]>(`/api/tools/toolsets${q(profile)}`),
    api.get<ImageConfig>(`/api/tools/toolsets/image_gen/config${q(profile)}`),
  ])
  const row = chatgptRow(config)
  const tool = !!toolsets.find((t) => t.name === 'image_gen')?.enabled
  return { row, tool, chatgpt: !!row?.is_active, on: tool && !!row?.is_active }
}

const IMAGE_TOOL = 'image_generate'
type ToolConfig = { tools?: { tool_search?: { defer?: unknown } } }

/** Tools an older Hermes deferred by default and a newer one no longer has on the list (or at all). */
const FORMER_DEFAULTS = ['apply_layout']

/**
 * The agent's tool-search list with the image tool always to hand: this
 * Hermes's defaults plus whatever else the agent defers, minus image_generate.
 * Null when the current list is already that. Without the defaults (an older
 * Hermes that didn't say), only the image tool comes out.
 */
export function nextDefer(current: unknown, defaults: unknown): string[] | null {
  if (!Array.isArray(current)) return null
  const names = current.filter((n): n is string => typeof n === 'string')
  let next: string[]
  if (Array.isArray(defaults)) {
    const base = defaults.filter((n): n is string => typeof n === 'string')
    const extras = names.filter((n) => !base.includes(n) && !FORMER_DEFAULTS.includes(n))
    next = [...base, ...extras].filter((n) => n !== IMAGE_TOOL)
  } else {
    next = names.filter((n) => n !== IMAGE_TOOL)
  }
  const same = next.length === names.length && next.every((n) => names.includes(n))
  return same ? null : next
}

let defaultDefer: Promise<unknown> | null = null

/** This Hermes's default tool-search list (public, and the same for every agent). */
const readDefaultDefer = () =>
  (defaultDefer ??= api.get<ToolConfig>('/api/config/defaults').then(
    (d) => d.tools?.tool_search?.defer,
    () => (defaultDefer = null),
  ))

/** Take the image tool out of the agent's tool search so it's always to hand. */
async function surface(profile: string) {
  const [config, defaults] = await Promise.all([api.get<ToolConfig>(`/api/config${q(profile)}`), readDefaultDefer()])
  const next = nextDefer(config.tools?.tool_search?.defer, defaults)
  if (next) await api.put(`/api/config${q(profile)}`, { config: { tools: { tool_search: { defer: next } } } })
}

async function apply(profile: string, on: boolean) {
  const s = await read(profile)
  if (on) {
    if (!s.row) throw new Error('This version of Hermes can’t make pictures with ChatGPT.')
    if (!s.chatgpt) await api.put(`/api/tools/toolsets/image_gen/provider${q(profile)}`, { provider: s.row.name })
    if (!s.tool) await api.put(`/api/tools/toolsets/image_gen${q(profile)}`, { enabled: true })
    // Best effort: drawing still works without it, just less often unprompted.
    await surface(profile).catch(() => {})
  } else if (s.tool) {
    await api.put(`/api/tools/toolsets/image_gen${q(profile)}`, { enabled: false })
  }
}

const profileNames = listProfileNames

// Agents already brought in line, remembered across reloads (for a day), so
// most page loads cost Hermes nothing. Cleared when the switch flips.
const synced = rememberedSet(scoped('murmur:pictures-synced'))

export const picturesKey = ['pictures'] as const

/** Can agents make pictures? (The main agent's setting.) */
export function usePictures(enabled = true) {
  return useQuery({
    queryKey: picturesKey,
    enabled,
    queryFn: async () => (await read(MAIN)).on,
    staleTime: 60_000,
  })
}

/** Turns pictures on or off for every agent. Optimistic; rolls back on failure. */
export function useSetPictures() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (on: boolean) => {
      // The main agent first: if Hermes says no, nothing else has changed.
      await apply(MAIN, on)
      if (on) {
        const { available } = await rpc<{ available: boolean }>('image.generate', { probe: true }, 15_000)
        if (!available) {
          await apply(MAIN, false).catch(() => {})
          throw new Error('ChatGPT can’t make pictures right now. Check that you’re still signed in, then try again.')
        }
      }
      synced.clear()
      synced.add(MAIN)
      // The rest follow in the background, one at a time (best effort: an
      // agent being deleted mid-way shouldn't fail the switch).
      void upkeep(async () => {
        for (const p of await profileNames()) {
          if (p !== MAIN)
            await apply(p, on).then(
              () => synced.add(p),
              () => {},
            )
        }
      })
      return on
    },
    onMutate: async (on) => {
      await qc.cancelQueries({ queryKey: picturesKey })
      const before = qc.getQueryData<boolean>(picturesKey)
      qc.setQueryData(picturesKey, on)
      return { before }
    },
    onError: (_e, _on, ctx) => qc.setQueryData(picturesKey, ctx?.before),
    onSettled: () => qc.invalidateQueries({ queryKey: picturesKey }),
  })
}

/** Gives one agent the same picture setting as the main agent. Call after creating an agent. */
export async function ensurePicturesFor(agentId: string) {
  if (agentId === MAIN) return
  const on = (await read(MAIN)).on
  if (on) await apply(agentId, true)
  synced.add(agentId)
}

/** Brings agents not yet in step into line with the main agent, one at a time. */
async function catchUp(ids: string[]) {
  const missing = ids.filter((id) => !synced.has(id))
  if (!missing.length) return
  const on = (await read(MAIN)).on
  for (const id of missing) {
    // (The main agent is the setting; with pictures on it only needs the
    // image tool surfaced. Failures are left for the next load.)
    const done = id !== MAIN ? apply(id, on) : on ? surface(MAIN) : Promise.resolve()
    await done.then(
      () => synced.add(id),
      () => {},
    )
  }
}

/**
 * Keeps every agent in step with the main agent's picture setting, catching
 * agents made since it was switched on (here or in another app). Mount once.
 * Quiet: nothing at all when every agent is already in step, and otherwise
 * idle-time requests one at a time, so the person's own never wait.
 */
export function usePicturesSync(agentIds: readonly string[] | undefined) {
  const key = agentIds?.join('\n') ?? ''
  useEffect(() => {
    const ids = key ? key.split('\n') : []
    if (ids.some((id) => !synced.has(id))) void upkeep(() => catchUp(ids)).catch(() => {})
  }, [key])
}
