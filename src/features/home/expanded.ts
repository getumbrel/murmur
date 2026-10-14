import { create } from 'zustand'

// Which agents show their chats beneath them in the sidebar. The agent you're
// in opens on its own; anything you open or close yourself is remembered.

const KEY = 'murmur:sidebar-open'

function load(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

const useStore = create<{ open: Record<string, boolean> }>(() => ({ open: load() }))

/** Whether `id` is expanded: your choice, else open while it's the agent you're in. */
export const useExpanded = (id: string, active: boolean) => useStore((s) => s.open[id] ?? active)

export function setExpanded(id: string, open: boolean) {
  useStore.setState((s) => {
    const next = { ...s.open, [id]: open }
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // Private mode: it lasts the visit.
    }
    return { open: next }
  })
}
