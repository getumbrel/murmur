import { ArrowRight, Lock } from 'lucide-react'
import { Sheet } from '@/ui/sheet'
import { Button } from '@/ui/button'

/**
 * Browsers only lend the microphone to secure pages. umbrelOS serves every app
 * over HTTPS on the same address too, so this is one tap: Murmur reopens over
 * HTTPS and picks up right here, ready to talk.
 */
export function SecureSheet({
  open,
  ready,
  onOpenChange,
  name,
  onStart,
}: {
  open: boolean
  /** Back over HTTPS: the tap that starts the call. */
  ready?: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onStart: (from: { x: number; y: number }) => void
}) {
  const here = `${window.location.host}`
  const reopen = () => {
    const url = new URL(window.location.href)
    url.protocol = 'https:'
    url.hash = 'talk'
    window.location.assign(url.toString())
  }
  if (ready)
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={`Call ${name}`} description="You’re on a secure connection now.">
        <div className="flex flex-col gap-4 pb-1">
          <div className="flex items-center justify-center gap-1.5 rounded-xl bg-fill-1 px-3 py-2.5 font-mono text-[12px] font-semibold text-success">
            <Lock size={12} strokeWidth={2.6} /> https://{here}
          </div>
          <Button
            variant="accent"
            size="lg"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              onStart({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
            }}
          >
            Call {name}
          </Button>
        </div>
      </Sheet>
    )
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Calling needs a secure connection"
      description={`Your browser only lets ${name} hear you over HTTPS. Your Umbrel serves Murmur over HTTPS too, at the same address.`}
    >
      <div className="flex flex-col gap-4 pb-1">
        <div aria-hidden className="flex flex-wrap items-center justify-center gap-2 rounded-xl bg-fill-1 px-3 py-2.5 font-mono text-[12px]">
          <span className="text-ink-3 line-through decoration-ink-3/50">http://{here}</span>
          <ArrowRight size={14} strokeWidth={2.2} className="text-ink-3" />
          <span className="inline-flex items-center gap-1 font-semibold text-success">
            <Lock size={11} strokeWidth={2.6} /> https://{here}
          </span>
        </div>
        <Button variant="accent" size="lg" onClick={reopen}>
          Open over HTTPS
        </Button>
        <p className="text-center text-caption text-ink-3">
          Your browser may show a privacy warning the first time. If it does, open the details and continue to your Umbrel.
        </p>
      </div>
    </Sheet>
  )
}
