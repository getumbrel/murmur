import { useQuery } from '@tanstack/react-query'
import { BookmarkPlus, Gauge, Info, ListPlus, Shrink, Target, type LucideIcon } from 'lucide-react'
import { rpc } from '@/hermes/gateway'
import type { Command } from './commands'

type CatalogResult = {
  pairs?: [string, string][]
  canon?: Record<string, string>
  commands?: Record<string, { desktop?: string | null }>
}

export type Catalog = {
  /** Every name Hermes knows, aliases included → its canonical name. */
  canon: Map<string, string>
  /** Commands that don't belong in Murmur: terminal-only, or switches that would drop its safety nets. */
  elsewhere: Set<string>
  /** The few of Hermes's own that make sense here, in Murmur's words, for the palette. */
  commands: Command[]
}

/** Hermes's commands worth offering, in plain words. Typed ones not listed still go through. */
const OFFERED: Record<string, { title: string; description: string; icon: LucideIcon }> = {
  compress: { title: 'Tidy up', description: 'Make room in a long chat', icon: Shrink },
  queue: { title: 'Ask next', description: 'Send this after the current reply', icon: ListPlus },
  subgoal: { title: 'Add to the goal', description: 'One more thing the goal needs', icon: Target },
  refine: { title: 'Learn from this chat', description: 'Save what worked to memory', icon: BookmarkPlus },
  usage: { title: 'Usage', description: 'How much of your plan is left', icon: Gauge },
  version: { title: 'Version', description: 'Which Hermes this is', icon: Info },
}

/** Never from Murmur: they turn off approvals or reach into Hermes's insides. */
const BLOCKED = /^(yolo|approvals|tools|toolsets|reload.*|debug|logs|config|browser|import|export|codex-runtime|update)$/

/** Every slash command this agent's Hermes knows, for passthrough and checking names. */
export function useCatalog(profile?: string) {
  return useQuery({
    queryKey: ['commands', profile],
    enabled: !!profile,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Catalog> => {
      const res = await rpc<CatalogResult>('commands.catalog', { profile })
      const strip = (s: string) => s.replace(/^\//, '').toLowerCase()
      const canon = new Map(Object.entries(res.canon ?? {}).map(([k, v]) => [strip(k), strip(v)]))
      const names = (res.pairs ?? []).map(([name]) => strip(name))
      for (const name of names) if (!canon.has(name)) canon.set(name, name)
      const elsewhere = new Set(
        Object.entries(res.commands ?? {})
          .filter(([name, meta]) => meta.desktop === 'terminal' || meta.desktop === 'messaging' || BLOCKED.test(strip(name)))
          .map(([name]) => strip(name)),
      )
      for (const name of names) if (BLOCKED.test(name)) elsewhere.add(name)
      const commands = names
        .filter((name) => name in OFFERED)
        .map((name) => ({ name, ...OFFERED[name], passthrough: true }))
      return { canon, elsewhere, commands }
    },
  })
}
