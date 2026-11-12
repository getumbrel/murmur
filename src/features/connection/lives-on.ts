// Where a new agent lives: the one place a server is a choice. The last one
// chosen is offered next time, while the app still has it.

import { create } from 'zustand'
import { useHermesIds } from '@/state/connection'

const KEY = 'murmur:lives-on'

const kept = () => {
  try {
    return localStorage.getItem(KEY) ?? undefined
  } catch {
    return undefined // Private mode: the first, each time.
  }
}

const useChoice = create<{ hermes?: string }>(() => ({ hermes: kept() }))

/** Remember where the next new agent should live. */
export function chooseLivesOn(hermes: string) {
  useChoice.setState({ hermes })
  try {
    localStorage.setItem(KEY, hermes)
  } catch {
    // Private mode: remembered while the app is open.
  }
}

/** The Hermes a new agent would live on: the last one chosen, else the first. */
export function useLivesOn(): string | null {
  const ids = useHermesIds()
  const said = useChoice((s) => s.hermes)
  return said && ids.includes(said) ? said : (ids[0] ?? null)
}
