import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Orb } from '@/ui/orb'
import { Button } from '@/ui/button'
import { cn } from '@/lib/cn'
import type { Agent } from '@/state/agents'
import { allowRequest, ignoreRequest, personName, useJustAllowed, type AccessRequest } from '@/state/access'
import { PlatformGlyph } from './platform-glyph'

const ease = [0.16, 1, 0.3, 1] as const

/**
 * "Sam wants to message Atlas", under Needs you: Allow lets them in with one
 * tap, and the card turns into a quiet receipt before it goes; the cross puts
 * it aside.
 */
export function RequestCard({
  request,
  agent,
  density,
}: {
  request: AccessRequest
  agent: Agent
  density: 'roomy' | 'compact'
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const allowed = useJustAllowed((s) => Boolean(s.byId[request.requestId]))
  const roomy = density === 'roomy'
  const name = personName(request)

  const allow = async () => {
    setBusy(true)
    try {
      await allowRequest(qc, request)
      navigator.vibrate?.(10)
    } catch {
      toast.error(`Couldn’t let ${name} in. Try again.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'relative flex items-center overflow-hidden rounded-xl transition-colors duration-300',
        allowed ? 'bg-success/12' : 'bg-accent-soft',
        roomy ? 'min-h-16 gap-3 p-3' : 'min-h-14 gap-2.5 p-2.5',
      )}
    >
      <span className="relative flex-none">
        <Orb hue={agent.hue} size={roomy ? 40 : 32} state={allowed ? 'done' : 'waiting'} seed={agent.id} />
        <span className="absolute -right-1 -bottom-0.5">
          <PlatformGlyph platform={request.platform} size={roomy ? 17 : 15} ring />
        </span>
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        {allowed ? (
          <motion.span
            key="allowed"
            className="flex min-w-0 flex-1 items-center gap-1.5"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease }}
          >
            <Check size={roomy ? 17 : 15} strokeWidth={2.5} className="flex-none text-success" aria-hidden />
            <span className={cn('truncate font-medium', roomy ? 'text-subhead' : 'text-footnote')}>
              {name} can message {agent.name}
            </span>
          </motion.span>
        ) : (
          <motion.span
            key="asking"
            className={cn('flex min-w-0 flex-1 items-center', roomy ? 'gap-2' : 'gap-1')}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.16 } }}
          >
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block truncate font-semibold tracking-[-0.01em]',
                  roomy ? 'text-subhead' : 'text-footnote',
                )}
              >
                {name}
              </span>
              <span className={cn('block truncate text-ink-2', roomy ? 'text-footnote' : 'text-caption')}>
                wants to message {agent.name}
              </span>
            </span>
            <Button variant="accent" size="sm" loading={busy} onClick={allow} className={cn(!roomy && 'h-7 px-2.5')}>
              Allow
            </Button>
            <button
              type="button"
              aria-label="Not now"
              title="Not now"
              onClick={() => ignoreRequest(request)}
              className={cn(
                'pressable touch-target relative flex flex-none items-center justify-center rounded-full text-ink-3 hover:bg-fill-1 hover:text-ink-2',
                roomy ? '-mr-1 size-8' : '-mr-0.5 size-7',
              )}
            >
              <X size={roomy ? 16 : 15} strokeWidth={2.25} />
            </button>
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
