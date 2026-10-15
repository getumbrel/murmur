import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { ListGroup } from '@/ui/list'
import { Button } from '@/ui/button'
import { cn } from '@/lib/cn'
import type { Agent } from '@/state/agents'
import {
  allowRequest,
  ignoreRequest,
  personName,
  removeAllowed,
  useAccess,
  type AccessPlatform,
  type AccessRequest,
  type Allowed,
} from '@/state/access'

const spring = { type: 'spring', duration: 0.35, bounce: 0 } as const

/**
 * Who's asking to message an agent on one platform, and who it already
 * answers there, for that platform's sheet. Nothing at all when there's
 * nobody either way.
 */
export function People({ agent, platform, className }: { agent: Agent; platform: AccessPlatform; className?: string }) {
  const { data } = useAccess(agent.id)
  const pending = data?.pending.filter((r) => r.platform === platform) ?? []
  const allowed = data?.allowed.filter((a) => a.platform === platform) ?? []
  if (!pending.length && !allowed.length) return null
  return (
    <motion.div
      className={cn('w-full space-y-6 text-left', className)}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
    >
      {pending.length > 0 && (
        <ListGroup title="Waiting for you">
          <AnimatePresence initial={false}>
            {pending.map((r) => (
              <Row key={r.requestId}>
                <Person name={personName(r)} note={ago(r.at)} />
                <Asking request={r} />
              </Row>
            ))}
          </AnimatePresence>
        </ListGroup>
      )}
      {allowed.length > 0 && (
        <ListGroup title={`Can message ${agent.name}`}>
          <AnimatePresence initial={false}>
            {allowed.map((a) => (
              <Row key={a.userId}>
                <Person name={personName(a)} />
                <Remove agentId={agent.id} person={a} />
              </Row>
            ))}
          </AnimatePresence>
        </ListGroup>
      )}
    </motion.div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      layout="position"
      data-has-icon=""
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={spring}
      className="overflow-hidden"
    >
      <div className="flex min-h-13 items-center gap-3 px-4 py-2">{children}</div>
    </motion.div>
  )
}

function Person({ name, note }: { name: string; note?: string }) {
  return (
    <>
      <span
        aria-hidden
        className="flex size-7 flex-none items-center justify-center rounded-full bg-fill-2 text-footnote font-semibold text-ink-2 uppercase"
      >
        {[...name][0]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{name}</span>
        {note && <span className="block truncate text-footnote text-ink-3">{note}</span>}
      </span>
    </>
  )
}

function Asking({ request }: { request: AccessRequest }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  return (
    <span className="flex flex-none items-center gap-1">
      <Button variant="ghost" size="sm" className="text-ink-2" onClick={() => ignoreRequest(request)}>
        Not now
      </Button>
      <Button
        variant="accent"
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await allowRequest(qc, request)
          } catch {
            toast.error(`Couldn’t let ${personName(request)} in. Try again.`)
            setBusy(false)
          }
        }}
      >
        Allow
      </Button>
    </span>
  )
}

/** Remove, then Remove? in red: two taps, since they'd have to ask all over again. */
function Remove({ agentId, person }: { agentId: string; person: Allowed }) {
  const qc = useQueryClient()
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!sure) return
    const t = setTimeout(() => setSure(false), 3_500)
    return () => clearTimeout(t)
  }, [sure])
  return (
    <Button
      variant={sure ? 'danger' : 'ghost'}
      size="sm"
      loading={busy}
      className={cn('flex-none', !sure && 'text-ink-2')}
      onBlur={() => setSure(false)}
      onClick={async () => {
        if (!sure) return setSure(true)
        setBusy(true)
        try {
          await removeAllowed(qc, agentId, person)
        } catch {
          toast.error(`Couldn’t remove ${personName(person)}. Try again.`)
          setBusy(false)
          setSure(false)
        }
      }}
    >
      {sure ? 'Remove?' : 'Remove'}
    </Button>
  )
}

function ago(at: number) {
  const min = Math.round((Date.now() - at) / 60_000)
  return min < 1 ? 'Just now' : min < 60 ? `${min} min ago` : 'An hour ago'
}
