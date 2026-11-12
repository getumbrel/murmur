import { useEffect, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { Buddy } from '@/ui/buddy'
import { Button } from '@/ui/button'
import { Sheet } from '@/ui/sheet'
import { cn } from '@/lib/cn'
import type { Unasked } from '@/features/chat/asking'

// An agent asks for your OK before anything risky. For a job you trust it
// with, one chat can let it go ahead instead: asked for from the chat's menu
// or from a request's own "…", agreed to once on a sheet that says what
// changes, and then worn by the chat for as long as it's on, as a chip under
// the header that is also the way back.

export const STOP_ASKING = 'Stop asking in this chat'
export const ASK_AGAIN = 'Ask me first again'
export { ShieldCheck as AskAgainIcon, ShieldOff as StopAskingIcon }

type Who = { id: string; name: string; hue: number }

/**
 * "Not asking first", under the header while the agent goes ahead without
 * asking. Tap it for what that means and the way back. Off for all of
 * Hermes, it says so, and offers nothing: this chat's switch can't undo that.
 */
export function AskingChip({ unasked, agent, onAskAgain }: { unasked?: Unasked; agent?: Who; onAskAgain: () => void }) {
  const [open, setOpen] = useState(false)
  const everywhere = unasked === 'everywhere'
  const name = agent?.name ?? 'Your agent'

  return (
    <AnimatePresence initial={false}>
      {unasked && (
        <motion.div
          key="asking"
          className="pointer-events-none flex justify-center px-4"
          initial={{ opacity: 0, y: -6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.96, transition: { duration: 0.18 } }}
          transition={{ type: 'spring', duration: 0.36, bounce: 0.15 }}
        >
          <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label={`${name} isn’t asking first${everywhere ? '' : ' in this chat'}`}
                className="glass pressable pointer-events-auto relative flex h-8 items-center gap-1.5 rounded-full pr-3.5 pl-2.5 text-footnote shadow-float ring-[0.5px] ring-line-strong select-none after:absolute after:-inset-y-1.5 after:inset-x-0"
              >
                <ShieldOff size={14} strokeWidth={2.25} className="flex-none text-warning" aria-hidden />
                <span className="flex-none font-medium text-ink">Not asking first</span>
              </button>
            </Popover.Trigger>
            <AnimatePresence>
              {open && (
                <Popover.Portal forceMount>
                  <Popover.Content forceMount asChild align="center" sideOffset={8} collisionPadding={12}>
                    <motion.div
                      className="z-50 w-72 origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-xl bg-elevated shadow-float ring-1 ring-line"
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
                      transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                    >
                      <p className="px-4 pt-3.5 text-caption font-medium text-ink-3">
                        {everywhere ? 'In every chat' : 'In this chat'}
                      </p>
                      <p className="px-4 pt-0.5 pb-3 text-subhead text-ink">
                        {everywhere
                          ? `${name} goes ahead without asking for your OK. Asking is turned off in Hermes itself, for every chat.`
                          : `${name} goes ahead without asking for your OK.`}
                      </p>
                      {!everywhere && (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            onAskAgain()
                          }}
                          className="hairline-t flex h-11 w-full items-center justify-between gap-6 px-4 text-left text-body outline-none transition-colors hover:bg-fill-1 focus-visible:bg-fill-1 active:bg-fill-2"
                        >
                          {ASK_AGAIN}
                          <ShieldCheck size={17} strokeWidth={1.9} className="text-ink-2" aria-hidden />
                        </button>
                      )}
                    </motion.div>
                  </Popover.Content>
                </Popover.Portal>
              )}
            </AnimatePresence>
          </Popover.Root>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * The one time it's agreed to. The top is the change itself: a request as the
 * chat shows it, the agent waiting on its two answers, which then fall away
 * and leave it working.
 */
export function StopAskingSheet({
  open,
  agent,
  onClose,
  onConfirm,
}: {
  open: boolean
  agent?: Who
  onClose: () => void
  /** Resolves once it's off; rejects (and the sheet stays, saying so) if it couldn't be. */
  onConfirm: () => Promise<void>
}) {
  const name = agent?.name ?? 'Your agent'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (open) setError(false)
  }, [open])

  const confirm = async () => {
    if (saving) return
    setSaving(true)
    setError(false)
    try {
      await onConfirm()
      onClose()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && !saving && onClose()} title="Stop asking" hideTitle>
      <div className="pb-1">
        <Scene agent={agent} play={open} />
        <div className="mt-6 text-center">
          <h2 className="text-title font-semibold tracking-[-0.02em] text-balance">Let {name} go ahead without asking?</h2>
          <p className="mx-auto mt-1.5 max-w-80 text-subhead text-balance text-ink-2">
            In this chat, {name} won’t wait for your OK before running commands, changing files or sending email. It still
            asks before using a saved card.
          </p>
        </div>
        <p role={error ? 'alert' : undefined} className="mx-auto mt-3 max-w-80 text-center text-footnote text-balance text-ink-3">
          {error ? (
            <span className="text-danger">Couldn’t turn it off. Check that Hermes is running, then try again.</span>
          ) : (
            'You can have it ask again any time, at the top of the chat.'
          )}
        </p>
        <div className="mt-7 grid gap-2">
          <Button variant="accent" size="lg" onClick={() => void confirm()} loading={saving}>
            {STOP_ASKING}
          </Button>
          <Button size="lg" variant="ghost" className="text-ink-2" onClick={onClose} disabled={saving}>
            Keep asking
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/**
 * A request in miniature: the agent waits on its two answers, then they give
 * way to the line a chat shows while it works, and it gets on with it.
 */
function Scene({ agent, play }: { agent?: Who; play: boolean }) {
  const reduce = useReducedMotion()
  const [gone, setGone] = useState(false)
  useEffect(() => {
    setGone(false)
    if (!play) return
    const t = setTimeout(() => setGone(true), reduce ? 0 : 1400)
    return () => clearTimeout(t)
  }, [play, reduce])
  const swap = 'transition-[opacity,scale,translate] duration-500 ease-(--ease-out)'
  const pill = 'flex h-7 flex-1 items-center justify-center rounded-full text-caption font-medium'

  return (
    <div aria-hidden className="mx-auto mt-2 flex w-60 flex-col items-center rounded-xl bg-fill-1 px-4 pt-5 pb-4 select-none">
      <Buddy hue={agent?.hue ?? 278} seed={agent?.id} size={56} state={gone ? 'working' : 'waiting'} />
      <div className="relative mt-4 h-7 w-full">
        <div className={cn('absolute inset-0 flex gap-2', swap, gone && 'scale-95 opacity-0')}>
          <span className={cn(pill, 'bg-fill-2 text-ink-2')}>Don’t allow</span>
          <span className={cn(pill, 'bg-ink text-bg')}>Allow</span>
        </div>
        <div className={cn('absolute inset-0 flex items-center justify-center delay-150', swap, !gone && 'translate-y-1 opacity-0')}>
          <span className="text-shimmer text-footnote text-ink-2">Running a command</span>
        </div>
      </div>
    </div>
  )
}
