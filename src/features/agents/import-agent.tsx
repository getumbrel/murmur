import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { agentsKey, useAgents, type Agent } from '@/state/agents'
import { exportAgent, importAgent } from '@/state/backups'

// Bringing in an agent someone exported (here or from another Hermes), and
// sending one out. Pick the file; it joins the roster with its name, colour
// and role, and `onDone` decides where to go from there.

export function useImportAgent(onDone?: (id: string) => void) {
  const qc = useQueryClient()
  const names = useAgents().data?.map((a) => a.name) ?? []
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const take = async (file: File) => {
    setBusy(true)
    const pending = toast.loading(`Bringing in ${file.name}…`)
    try {
      const id = await importAgent(file, names)
      await qc.invalidateQueries({ queryKey: agentsKey })
      const agent = qc.getQueryData<Agent[]>(agentsKey)?.find((a) => a.id === id)
      toast.success(`${agent?.name ?? 'Your agent'} is here`, { id: pending })
      onDone?.(id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Couldn’t bring that agent in.', { id: pending })
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    /** Opens the file picker; call from a tap. */
    pick: () => input.current?.click(),
    /** Render once, anywhere. */
    input: (
      <input
        ref={input}
        type="file"
        accept=".gz,.tgz,application/gzip,application/x-gzip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void take(file)
        }}
      />
    ),
  }
}

/** Packs an agent up and downloads it, saying plainly what stays behind. */
export async function exportWithToast(agent: Agent) {
  try {
    await exportAgent(agent)
    toast.success(`Exported ${agent.name}`, { description: 'Its keys and sign-ins stay here.' })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : `Couldn’t export ${agent.name}.`)
  }
}
