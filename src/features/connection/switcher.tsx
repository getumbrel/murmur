import { useState } from 'react'
import { useLocation } from 'wouter'
import { toast } from 'sonner'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Sheet } from '@/ui/sheet'
import { cn } from '@/lib/cn'
import { useConnection } from '@/hermes/gateway'
import { tabHermes } from '@/hermes/instance'
import { switchHermes, useHermesList, type KnownHermes } from '@/state/connection'
import { StatusDot } from './fields'
import { isBuiltinHermes, isUmbrelHermes } from './hermes-connection-form'

// Several Hermes, one at a time, Slack-workspace style. <HermesSwitcher /> is
// a small pill naming the Hermes in use; it opens a list to switch, with a way
// to Settings → Server to manage them. It draws nothing until there are two.
// On screen a Hermes is a "server" (the machine it runs on, by name), so it
// never reads like the main agent, which Hermes also calls "Hermes".

/** Which way a Hermes's dot goes. The built-in on its first start is on its way, not down. */
export const toneOf = (c: Pick<KnownHermes, 'status'>, starting = false): 'success' | 'danger' | 'warning' =>
  c.status === 'connected' ? 'success' : starting ? 'warning' : c.status === 'unreachable' ? 'danger' : 'warning'

/**
 * "umbrel.local · Hermes 0.21.5", or what's wrong, in a few words. Where it
 * is, never a container's name: the built-in "Comes with Murmur", the Hermes
 * Agent app is "On this Umbrel".
 */
export function hermesDetail(c: KnownHermes, { starting = false } = {}) {
  const where = isBuiltinHermes(c) ? 'Comes with Murmur' : isUmbrelHermes(c) ? 'On this Umbrel' : hostOf(c.url)
  if (c.status !== 'connected' && starting) return `Starting up · ${where}`
  if (c.status === 'unreachable') return `Can’t reach it · ${where}`
  if (c.status !== 'connected') return `Needs signing in · ${where}`
  return [where, c.hermesVersion && `Hermes ${c.hermesVersion}`].filter(Boolean).join(' · ')
}

export function hostOf(url: string) {
  try {
    const u = new URL(url)
    return u.host + u.pathname.replace(/\/$/, '')
  } catch {
    return url
  }
}

/** The Hermes this tab is for, from the list. */
export function useCurrentHermes() {
  const list = useHermesList().data
  const id = tabHermes() ?? list?.active
  return { list, current: list?.connections.find((c) => c.id === id) }
}

export function HermesSwitcher({ className }: { className?: string }) {
  const { list, current } = useCurrentHermes()
  const [open, setOpen] = useState(false)
  if (!list || list.connections.length < 2 || !current) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${current.name}. Switch server`}
        title="Switch server"
        className={cn(
          'pressable inline-flex h-8 max-w-56 min-w-0 items-center gap-2 rounded-full bg-fill-1 pr-2 pl-3 text-subhead font-medium tracking-[-0.01em] text-ink select-none',
          'transition-colors hover:bg-fill-2 focus-visible:outline-offset-2 active:bg-fill-2',
          className,
        )}
      >
        <LiveDot fallback={toneOf(current)} />
        <span className="min-w-0 truncate">{current.name}</span>
        <ChevronsUpDown size={14} strokeWidth={2} className="-ml-0.5 flex-none text-ink-3" aria-hidden />
      </button>
      <HermesPicker open={open} onOpenChange={setOpen} />
    </>
  )
}

/** The Hermes in use, live: how its socket is doing right now (before it's dialed, its last check). */
function LiveDot({ fallback }: { fallback: ReturnType<typeof toneOf> }) {
  const state = useConnection((s) => s.state)
  const tone = state === 'open' ? 'success' : state === 'closed' || state === 'error' ? 'danger' : state === 'idle' ? fallback : 'warning'
  return (
    <span
      aria-hidden
      className={cn(
        'size-2 flex-none rounded-full transition-colors duration-300',
        tone === 'success' ? 'bg-success' : tone === 'danger' ? 'bg-danger' : 'bg-warning',
      )}
    />
  )
}

/** Every Hermes; a tap switches. A sheet on phones, a card on wide screens. */
export function HermesPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { list, current } = useCurrentHermes()
  const [, navigate] = useLocation()
  const pick = (c: KnownHermes) => {
    // Out of the way first: the sheet slides down as the curtain comes over it.
    onOpenChange(false)
    if (c.id === current?.id) return
    switchHermes(c).catch((e: unknown) => toast.error(e instanceof Error && e.message ? e.message : 'Couldn’t switch. Try again.'))
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Switch server" width={400}>
      <div className="list-group overflow-hidden rounded-xl bg-fill-1">
        {list?.connections.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => pick(c)}
            aria-current={c.id === current?.id || undefined}
            data-has-icon=""
            className="flex min-h-13 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2"
          >
            <span className="flex size-7 flex-none items-center justify-center">
              <StatusDot tone={toneOf(c)} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body">{c.name}</span>
              <span className="block truncate text-footnote text-ink-2">{hermesDetail(c)}</span>
            </span>
            {c.id === current?.id && <Check size={20} strokeWidth={2.25} className="-mr-0.5 flex-none text-accent" aria-label="In use" />}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          onOpenChange(false)
          navigate('/settings/hermes')
        }}
        className="pressable mt-3 flex h-11 w-full items-center justify-center rounded-full text-subhead font-medium text-accent select-none hover:bg-fill-1 active:bg-fill-2"
      >
        Manage servers…
      </button>
    </Sheet>
  )
}
