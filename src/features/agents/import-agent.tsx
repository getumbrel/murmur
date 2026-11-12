import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Import } from 'lucide-react'
import { Button } from '@/ui/button'
import { Sheet } from '@/ui/sheet'
import { agentsKey, useAgents, type Agent } from '@/state/agents'
import { exportAgent, importAgent } from '@/state/backups'
import { useSeveral } from '@/state/connection'
import { ServerChips } from '@/features/connection/server-chips'
import { chooseLivesOn, useLivesOn } from '@/features/connection/lives-on'

// Bringing in an agent someone exported (here or from another Hermes), and
// sending one out. Pick the file; it joins the roster with its name, colour
// and role, and `onDone` decides where to go from there. With several
// servers, where it should live is asked first, as it is for a new agent.

export function useImportAgent(onDone?: (id: string) => void) {
  const qc = useQueryClient()
  const names = useAgents().data?.map((a) => a.name) ?? []
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const several = useSeveral()
  const hermes = useLivesOn()
  const [asking, setAsking] = useState(false)

  const take = async (file: File) => {
    setBusy(true)
    const pending = toast.loading(`Bringing in ${file.name}…`)
    try {
      const id = await importAgent(file, names, hermes)
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
    /** Opens the file picker (after asking where it should live, with several servers); call from a tap. */
    pick: () => (several ? setAsking(true) : input.current?.click()),
    /** Render once, anywhere. */
    input: (
      <>
        <Sheet open={asking && several} onOpenChange={setAsking} title="Import an agent" width={420}>
          <p className="px-1 text-subhead text-pretty text-ink-2">Choose where it should live, then its file.</p>
          <ServerChips label="Lives on" value={hermes} onChange={chooseLivesOn} className="mt-5" />
          <div className="mt-7 grid pb-1">
            <Button
              variant="accent"
              size="lg"
              onClick={() => {
                setAsking(false)
                input.current?.click()
              }}
            >
              <Import size={18} strokeWidth={2} aria-hidden />
              Choose file
            </Button>
          </div>
        </Sheet>
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
      </>
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
