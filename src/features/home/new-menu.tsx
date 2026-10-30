import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { AgentAddIcon, AgentsIcon } from '@/ui/icons'
import { IconButton } from '@/ui/button'

// The "+" in the corner: a small menu with the two things you can make, or
// straight to a new agent when groups aren't possible here.

type Props = {
  onNewAgent: () => void
  /** Omitted when groups aren't possible: the button makes an agent directly. */
  onNewGroup?: () => void
  size?: 'sm' | 'md' | 'lg'
  variant?: 'plain' | 'filled'
}

export function NewMenu({ onNewAgent, onNewGroup, size = 'md', variant = 'filled' }: Props) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  // Focus goes home to "+" first, so the sheet that opens hands it back there when it closes.
  const pick = (fn: () => void) => () => {
    trigger.current?.focus()
    setOpen(false)
    fn()
  }
  if (!onNewGroup) {
    return (
      <IconButton label="New agent" size={size} variant={variant} onClick={onNewAgent}>
        <Plus size={size === 'sm' ? 18 : 20} strokeWidth={1.85} />
      </IconButton>
    )
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton ref={trigger} label="New" size={size} variant={variant} aria-haspopup="menu">
          <Plus size={size === 'sm' ? 18 : 20} strokeWidth={1.85} />
        </IconButton>
      </Popover.Trigger>
      <AnimatePresence>
        {open && (
          <Popover.Portal forceMount>
            <Popover.Content forceMount asChild align="end" sideOffset={8} collisionPadding={12}>
              <motion.div
                role="menu"
                onKeyDown={menuKeys}
                className="z-50 min-w-56 origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-xl bg-elevated shadow-float ring-1 ring-line"
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
                transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              >
                <Item icon={<AgentAddIcon size={21} />} onClick={pick(onNewAgent)}>
                  New agent
                </Item>
                <Item icon={<AgentsIcon size={21} />} onClick={pick(onNewGroup)} divider>
                  New group
                </Item>
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  )
}

/** One menu row, shared by every small menu on Home (this one and the roster's). */
export const menuItem =
  'flex h-11 w-full items-center justify-between gap-6 px-4 text-left text-body outline-none select-none transition-colors hover:bg-fill-1 focus-visible:bg-fill-1 active:bg-fill-2'

/** Arrow keys, Home and End move between a menu's items, as a role=menu promises. */
export function menuKeys(e: KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^=menuitem]')]
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key]
  if (next === undefined || !items.length) return
  e.preventDefault()
  items[(next + items.length) % items.length].focus()
}

function Item({
  icon,
  children,
  onClick,
  divider,
}: {
  icon: ReactNode
  children: ReactNode
  onClick: () => void
  divider?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`${menuItem} ${divider ? 'hairline-t' : ''}`}
    >
      {children}
      <span className="text-ink-2">{icon}</span>
    </button>
  )
}
