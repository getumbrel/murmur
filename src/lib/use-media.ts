import { useSyncExternalStore } from 'react'

// One stable subscribe function per query: a fresh one each render would make
// React drop and re-add the listener on every render (every streamed token).
const subscribers = new Map<string, (onChange: () => void) => () => void>()

function subscribeTo(query: string) {
  let subscribe = subscribers.get(query)
  if (!subscribe) {
    subscribe = (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    }
    subscribers.set(query, subscribe)
  }
  return subscribe
}

export function useMedia(query: string) {
  return useSyncExternalStore(
    subscribeTo(query),
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Wide layouts get a sidebar and dialogs; narrow ones get stacks and sheets. */
export const useIsWide = () => useMedia('(min-width: 900px)')
export const usePrefersReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)')

/** The wide layout's sidebar width (src/screens/home.tsx), for things that centre on the pane beside it. */
export const SIDEBAR_WIDTH = 308
