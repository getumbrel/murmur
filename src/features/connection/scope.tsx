// Which Hermes a screen is about, for what's set once per Hermes: the services
// it thinks with, its keys, the models it runs itself.
//
// With one Hermes there's nothing to say. With several, Settings → Models
// shows one at a time, chosen at its top (ServerChips), and everything under
// it reads that choice from here rather than each being told.

import { createContext, useContext } from 'react'
import { create } from 'zustand'
import { useHermesIds } from '@/state/connection'

const Scope = createContext<string | null | undefined>(undefined)

/** Everything inside is about this Hermes. */
export const HermesScope = Scope.Provider

/** The Hermes this part of the screen is about: the first, unless a HermesScope around it says. */
export function useScopeHermes(): string | null {
  const said = useContext(Scope)
  const first = useHermesIds()[0] ?? null
  return said === undefined ? first : said
}

// The one Settings is showing, for as long as this tab is open: a reload comes back to it.
const CHOICE = 'murmur:settings-hermes'

function chosen() {
  try {
    return sessionStorage.getItem(CHOICE) ?? undefined
  } catch {
    return undefined
  }
}

const useChoice = create<{ hermes?: string }>(() => ({ hermes: chosen() }))

/** Show a Hermes's settings (an agent's, on the way there from its chat). */
export const chooseSettingsHermes = (hermes: string | null | undefined) => {
  useChoice.setState({ hermes: hermes ?? undefined }, true)
  try {
    if (hermes) sessionStorage.setItem(CHOICE, hermes)
    else sessionStorage.removeItem(CHOICE)
  } catch {
    /* storage unavailable: it lasts until a reload */
  }
}

/** The Hermes Settings is showing: the one chosen, while the app still has it, else the first. */
export function useSettingsHermes(): string | null {
  const ids = useHermesIds()
  const said = useChoice((s) => s.hermes)
  return said && ids.includes(said) ? said : (ids[0] ?? null)
}
