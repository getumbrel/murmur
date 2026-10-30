import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, Copy, Power } from 'lucide-react'
import { Button } from '@/ui/button'
import { cn } from '@/lib/cn'
import { useCopy } from '@/features/chat/use-copy'
import { useHermesConnection } from '@/state/connection'
import { useHermesGateway } from '@/state/hermes-gateway'

// Shown where Hermes's gateway being off quietly breaks something (routines
// that never fire, a Telegram bot that never answers), with a way to turn it
// on. Hermes starts it wherever it can; where it can't, the card hands over
// the one command that does, to run on that computer or in Hermes's container.

const COMMAND = 'hermes gateway start'

const enter = { type: 'spring', visualDuration: 0.3, bounce: 0 } as const

type Props = {
  agentId: string
  /** What's not happening, in a few words ("Routines won’t run"). */
  title: string
  className?: string
}

export function GatewayOff({ agentId, title, className }: Props) {
  const reduce = useReducedMotion()
  const gateway = useHermesGateway(agentId, { live: true })
  // Hermes in Docker: the command goes in its container, not on the computer around it.
  const image = useHermesConnection().connection?.fromImage
  const [starting, setStarting] = useState(false)
  const [failed, setFailed] = useState(false)

  const start = async () => {
    setStarting(true)
    const ok = await gateway.start()
    setStarting(false)
    setFailed(!ok)
  }

  return (
    <AnimatePresence initial={false}>
      {gateway.off && (
        <motion.div
          role="status"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: reduce ? 1 : 0.97, transition: { duration: 0.18 } }}
          transition={reduce ? { duration: 0.15 } : enter}
          className={cn('rounded-xl bg-warning/8 py-3 pr-3 pl-3.5 text-left', className)}
        >
          <div className="flex items-start gap-3">
            <span aria-hidden className="mt-0.5 grid size-8 flex-none place-items-center rounded-full bg-warning/15 text-warning">
              <Power size={16} strokeWidth={2.5} />
            </span>
            <div className="min-w-0 flex-1 self-center">
              <p className="text-subhead font-semibold tracking-[-0.01em] text-ink">{title}</p>
              <p className="text-footnote text-pretty text-ink-2">
                {failed
                  ? `Murmur couldn’t turn it on. ${image ? 'In Hermes’s container' : 'On the computer running Hermes'}, run:`
                  : 'Hermes’s gateway is off.'}
              </p>
            </div>
            <Button variant="secondary" size="sm" className="flex-none" loading={starting} onClick={() => void start()}>
              {failed ? 'Try again' : 'Turn on'}
            </Button>
          </div>
          {/* Under the words, the whole width: a command that's cut off is no use. */}
          {failed && <Command text={COMMAND} />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A command to type elsewhere, with a way to copy it. */
function Command({ text }: { text: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="mt-2.5 ml-11 flex items-center gap-1 rounded-lg bg-fill-2 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-footnote text-ink">{text}</code>
      <button
        type="button"
        onClick={() => void copy(text)}
        aria-label={copied ? 'Copied' : 'Copy'}
        className="pressable touch-target grid size-7 flex-none place-items-center rounded-md text-ink-3 hover:bg-fill-2 hover:text-ink"
      >
        {copied ? <Check size={15} strokeWidth={2.5} className="text-success" /> : <Copy size={15} strokeWidth={2} />}
      </button>
    </div>
  )
}
