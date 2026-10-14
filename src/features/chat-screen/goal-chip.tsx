import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion } from 'motion/react'
import { Pause, Play, Target, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Goal } from '@/state/chats'

type Props = {
  goal?: Goal
  onAction: (action: 'pause' | 'resume' | 'clear') => void
}

/** What the agent is working toward (/goal), pinned under the header. Tap for pause / clear. */
export function GoalChip({ goal, onAction }: Props) {
  const [open, setOpen] = useState(false)
  const paused = goal?.status === 'paused'
  const pick = (action: 'pause' | 'resume' | 'clear') => () => {
    setOpen(false)
    onAction(action)
  }

  return (
    <AnimatePresence initial={false}>
      {goal && (
        <motion.div
          key="goal"
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
                aria-label={`Goal: ${goal.title}${paused ? ' (paused)' : ''}`}
                className="glass pressable pointer-events-auto relative flex h-8 max-w-[min(30rem,100%)] items-center gap-1.5 rounded-full pr-3.5 pl-2.5 text-footnote shadow-float ring-[0.5px] ring-line-strong select-none after:absolute after:-inset-y-1.5 after:inset-x-0"
              >
                <Target size={14} strokeWidth={2.25} className={cn('flex-none', paused ? 'text-ink-3' : 'text-accent')} aria-hidden />
                <span className="flex-none font-medium text-ink">{paused ? 'Paused' : 'Goal'}</span>
                <span className="min-w-0 truncate text-ink-2">{goal.title}</span>
              </button>
            </Popover.Trigger>
            <AnimatePresence>
              {open && (
                <Popover.Portal forceMount>
                  <Popover.Content forceMount asChild align="center" sideOffset={8} collisionPadding={12}>
                    <motion.div
                      role="menu"
                      className="z-50 w-72 origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-xl bg-elevated shadow-float ring-1 ring-line"
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
                      transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                    >
                      <p className="px-4 pt-3.5 text-caption font-medium text-ink-3">
                        {paused ? 'Goal, paused' : 'Working toward'}
                      </p>
                      <p className="px-4 pt-0.5 pb-3 text-subhead text-ink">{goal.title}</p>
                      <Item icon={paused ? Play : Pause} onClick={pick(paused ? 'resume' : 'pause')}>
                        {paused ? 'Keep going' : 'Pause'}
                      </Item>
                      <Item icon={X} onClick={pick('clear')} destructive>
                        Clear goal
                      </Item>
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

function Item({
  icon: Icon,
  children,
  onClick,
  destructive,
}: {
  icon: typeof Target
  children: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'hairline-t flex h-11 w-full items-center justify-between gap-6 px-4 text-left text-body outline-none transition-colors hover:bg-fill-1 focus-visible:bg-fill-1 active:bg-fill-2',
        destructive && 'text-danger',
      )}
    >
      {children}
      <Icon size={17} strokeWidth={1.9} className={destructive ? 'text-danger' : 'text-ink-2'} aria-hidden />
    </button>
  )
}
