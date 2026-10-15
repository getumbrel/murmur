import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ListRow } from '@/ui/list'
import { Toggle } from '@/ui/toggle'
import { cn } from '@/lib/cn'
import { usePictures, useSetPictures } from '@/state/pictures'
import { Tile } from './page'
import { Swap } from './swap'
import { PicturesIcon } from '@/ui/icons'

// "Let agents make pictures", for a list under the ChatGPT account. Only
// render it when ChatGPT is connected: the pictures come out of that plan.

export function PicturesRow() {
  const { data: on, isPending } = usePictures()
  const set = useSetPictures()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => setReady(false), 4000)
    return () => clearTimeout(t)
  }, [ready])

  const change = (next: boolean) => {
    if (set.isPending) return
    setReady(false)
    set.mutate(next, {
      onSuccess: (v) => setReady(v),
      onError: (e) => toast.error(e instanceof Error && e.message ? e.message : 'Couldn’t change that. Try again.'),
    })
  }

  const status = set.isPending
    ? set.variables
      ? { id: 'on', text: 'Setting up your agents…' }
      : { id: 'off', text: 'Turning off…' }
    : ready
      ? { id: 'ready', text: 'Ready. Ask any agent for a picture.' }
      : { id: 'idle', text: 'Uses your ChatGPT plan' }

  return (
    <ListRow
      icon={
        <Tile>
          <PicturesIcon size={19} />
        </Tile>
      }
      title="Let agents make pictures"
      subtitle={
        <Swap id={status.id}>
          <span className={cn(set.isPending && 'text-shimmer')}>{status.text}</span>
        </Swap>
      }
      trailing={
        <span className={cn('flex w-[51px] flex-none', set.isPending && 'pointer-events-none')}>
          {isPending ? (
            // Still asking Hermes: a switch that's plainly there but not ready yet.
            <span inert className="opacity-40 motion-safe:animate-pulse" aria-hidden>
              <Toggle checked={false} onChange={() => {}} label="Let agents make pictures" />
            </span>
          ) : (
            <span className="animate-fade">
              <Toggle checked={!!on} onChange={change} label="Let agents make pictures" />
            </span>
          )}
        </span>
      }
    />
  )
}
