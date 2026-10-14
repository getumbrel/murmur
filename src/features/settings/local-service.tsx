import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Cpu } from 'lucide-react'
import { ListRow } from '@/ui/list'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import { HermesError } from '@/hermes/rest'
import { useAgents, type Agent } from '@/state/agents'
import { LOCAL_SLUG, modelName, useRefreshModels, type Service } from '@/state/models'
import { LOCAL_PROVIDER, localRuntimeKey, removeDownloaded, useDownloaded } from '@/state/local-runtime'
import { formatSize } from '@/state/local-tiers'
import { ask } from './ask'
import { Tile } from './page'
import { Swap } from './swap'

// The models Hermes runs itself, in Settings → Models → Services: the service,
// then each model downloaded for it. Removing one deletes it from Hermes's
// machine, after moving any agent using it onto something else.

const usersOf = (agents: Agent[], ids: string[]) =>
  agents.filter((a) => LOCAL_PROVIDER.test(a.provider ?? '') && ids.includes(a.model ?? ''))

/** "Hermes", "Hermes and Atlas", "3 agents". */
function who(users: Agent[]) {
  if (users.length === 1) return users[0].name
  if (users.length === 2) return `${users[0].name} and ${users[1].name}`
  return `${users.length} agents`
}

export function LocalService({ service, services }: { service: Service; services: Service[] }) {
  const qc = useQueryClient()
  const refresh = useRefreshModels()
  const agents = useAgents().data ?? []
  const downloaded = useDownloaded()
  const [removing, setRemoving] = useState<string[] | null>(null)

  const ids = service.models
  const bytesOf = (list: string[]) =>
    list.reduce((n, id) => n + (downloaded.data?.find((m) => m.id === id)?.bytes ?? 0), 0)

  const remove = async (list: string[]) => {
    const all = list.length > 1
    const name = all ? `${list.length} models` : modelName(list[0])
    const users = usersOf(agents, list)
    const bytes = bytesOf(list)
    const frees = bytes ? `This frees ${formatSize(bytes)}.` : ''
    const it = !all ? 'it' : users.length > 1 ? 'them' : 'one of them'
    // Somewhere for its agents to go: another model here, or another service.
    const elsewhere = ids.some((id) => !list.includes(id)) || services.some((s) => s.slug !== LOCAL_SLUG)
    const body = !users.length
      ? `${frees} You can download ${all ? 'them' : 'it'} again anytime.`
      : elsewhere
        ? `${who(users)} ${users.length > 1 ? 'are' : 'is'} using ${it} right now. Murmur will switch to another model first. ${frees}`
        : `${who(users)} ${users.length > 1 ? 'are' : 'is'} using ${it}, and there’s no other model. You’ll need to connect one to keep chatting. ${frees}`
    const yes = await ask({
      title: all ? `Remove all ${list.length} models?` : `Remove ${name}?`,
      body: body.trim(),
      action: all ? 'Remove all' : 'Remove',
      destructive: true,
    })
    if (!yes) return
    setRemoving(list)
    try {
      const freed = await removeDownloaded(list)
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: localRuntimeKey })])
      toast.success(`Removed ${all ? 'all models' : name}${freed ? ` · ${formatSize(freed)} freed` : ''}`)
    } catch (e) {
      // Whatever went before still happened (an agent moved, a model deleted): show where things are.
      void refresh()
      void qc.invalidateQueries({ queryKey: localRuntimeKey })
      // Can't reach Hermes, or Murmur's own words (models.ts); Hermes's own are for Hermes.
      const said = e instanceof HermesError ? e.status === 0 && e.message : e instanceof Error && e.message
      toast.error(said || `Couldn’t remove ${name}. Try again.`)
    } finally {
      setRemoving(null)
    }
  }

  const button = (label: string, list: string[]) =>
    removing?.length === list.length && list.every((id) => removing.includes(id)) ? (
      <Spinner className="text-ink-2" />
    ) : (
      <button
        type="button"
        disabled={!!removing}
        onClick={() => void remove(list)}
        className={cn(
          'pressable touch-target relative h-8 flex-none rounded-full bg-fill-2 px-3 text-footnote font-medium text-ink-2 select-none hover:text-ink active:bg-fill-3',
          removing && 'pointer-events-none opacity-40',
        )}
      >
        {label}
      </button>
    )

  return (
    <>
      <ListRow
        icon={
          <Tile>
            <Cpu size={16} strokeWidth={2} />
          </Tile>
        }
        title={service.name}
        subtitle={service.detail}
        trailing={ids.length > 1 ? button('Remove all', ids) : null}
      />
      {ids.map((id) => {
        const users = usersOf(agents, [id])
        const bytes = bytesOf([id])
        const busy = !!removing?.includes(id)
        const line = [
          bytes ? formatSize(bytes) : '',
          users.length ? `In use by ${users.length > 1 ? `${users.length} agents` : users[0].name}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <ListRow
            key={id}
            // An empty gutter: the models sit under their service.
            icon={<span />}
            title={modelName(id)}
            subtitle={
              <Swap id={busy ? 'removing' : 'line'}>
                <span className={cn(busy && 'text-shimmer')}>{busy ? 'Removing…' : line || '\u00a0'}</span>
              </Swap>
            }
            trailing={button('Remove', [id])}
          />
        )
      })}
    </>
  )
}
