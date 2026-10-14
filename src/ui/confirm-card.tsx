import { useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Button } from './button'

const enter = { type: 'spring', visualDuration: 0.3, bounce: 0 } as const

/**
 * The way out at the bottom of a sheet: a quiet red button that, when
 * pressed, turns into a small card asking "Delete this?" with Cancel and the
 * real thing side by side. One pattern for every destructive action, so
 * Delete, Forget and Disconnect all ask the same way.
 */
export function ConfirmCard({
  label,
  title,
  body,
  confirm,
  onConfirm,
  className,
}: {
  /** The button that starts it ("Delete group"). */
  label: string
  /** The question ("Delete this group?"). */
  title: string
  /** What happens, in a sentence. */
  body: string
  /** The verb that does it ("Delete"). */
  confirm: string
  /** Throw (after telling the person) to stay on the card. */
  onConfirm: () => unknown
  className?: string
}) {
  const reduce = useReducedMotion()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  const run = async () => {
    setBusy(true)
    try {
      await onConfirm()
      setAsking(false)
    } catch {
      // The caller has said what went wrong; stay put so they can try again.
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    setAsking(false)
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
  }

  return (
    <div className={className}>
      <AnimatePresence mode="popLayout" initial={false}>
        {asking ? (
          <motion.div
            key="card"
            role="alertdialog"
            aria-label={title}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={reduce ? { duration: 0.15 } : enter}
            className="origin-bottom rounded-xl bg-danger/8 p-4 text-center"
          >
            <p className="text-subhead font-semibold tracking-[-0.01em] text-ink">{title}</p>
            <p className="mx-auto mt-1 max-w-80 text-subhead text-balance text-ink-2">{body}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={cancel} disabled={busy} autoFocus>
                Cancel
              </Button>
              <Button variant="danger" className="bg-danger! text-white! hover:brightness-105" onClick={run} loading={busy}>
                {confirm}
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18 }}
          >
            <Button ref={trigger} variant="danger" size="lg" onClick={() => setAsking(true)}>
              {label}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
