import { memo, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import * as Popover from '@radix-ui/react-popover'
import { Ban, Check, Clock, Ellipsis } from 'lucide-react'
import { Orb } from '@/ui/orb'
import { Button, IconButton } from '@/ui/button'
import { cn } from '@/lib/cn'
import type { ApprovalChoice, ChatItem } from './types'
import { Swap, arrive } from './collapse'

type Item = Extract<ChatItem, { kind: 'approval' }>

const RECEIPT = {
  once: 'Allowed',
  session: 'Allowed for this chat',
  always: 'Always allowed',
  deny: 'Not allowed',
} satisfies Record<ApprovalChoice, string>

export const ApprovalCard = memo(function ApprovalCard({
  item,
  hue,
  seed,
  onApprove,
}: {
  item: Item
  hue: number
  seed?: string
  onApprove: (requestId: string, choice: ApprovalChoice) => void
}) {
  const pending = item.status === 'pending'
  // Settled while you watched (not loaded that way): the receipt marks the moment.
  const watched = useRef(pending)
  return (
    <Swap id={pending ? 'card' : 'receipt'}>
      {pending ? (
        <Card item={item} hue={hue} seed={seed} onApprove={onApprove} />
      ) : (
        <Receipt item={item} fresh={watched.current} />
      )}
    </Swap>
  )
})

function Card({
  item,
  hue,
  seed,
  onApprove,
}: {
  item: Item
  hue: number
  seed?: string
  onApprove: (id: string, c: ApprovalChoice) => void
}) {
  const [sent, setSent] = useState<ApprovalChoice>()
  const has = (c: ApprovalChoice) => item.choices.includes(c)
  const choose = (c: ApprovalChoice) => {
    setSent(c)
    onApprove(item.requestId, c)
  }
  const button = (c: ApprovalChoice, label: string, variant: 'primary' | 'secondary') =>
    has(c) && (
      <Button
        variant={variant}
        className="h-11 w-full whitespace-nowrap sm:h-10 sm:w-auto"
        disabled={!!sent && sent !== c}
        loading={sent === c}
        onClick={() => choose(c)}
      >
        {label}
      </Button>
    )

  return (
    <motion.section
      {...arrive}
      aria-label={item.title}
      className="rounded-xl bg-elevated p-4 shadow-[inset_0_0_0_0.5px_var(--line-strong)]"
    >
      <div className="flex items-center gap-3">
        <Orb hue={hue} size={28} state="waiting" seed={seed} />
        <h3 className="min-w-0 flex-1 text-subhead font-semibold tracking-[-0.01em]">{item.title}</h3>
        {has('session') && (
          <Popover.Root>
            <Popover.Trigger asChild>
              <IconButton label="More options" size="sm" className="-my-1 -mr-1.5" disabled={!!sent}>
                <Ellipsis size={18} strokeWidth={2} />
              </IconButton>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={6}
                className="z-50 animate-fade rounded-lg bg-elevated p-1 shadow-float ring-[0.5px] ring-line-strong"
              >
                <Popover.Close asChild>
                  <button
                    type="button"
                    onClick={() => choose('session')}
                    className="flex h-10 w-full items-center rounded-md px-3 text-subhead hover:bg-fill-1"
                  >
                    Allow for this chat
                  </button>
                </Popover.Close>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
      </div>

      {item.command && <Command text={item.command} />}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {button('deny', 'Don’t allow', 'secondary')}
        {button('always', 'Always allow', 'secondary')}
        {button('once', 'Allow', 'primary')}
      </div>
    </motion.section>
  )
}

function Command({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null)
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !open) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [text, open])

  return (
    <div className="mt-3 rounded-sm bg-sunken px-3 py-2.5 ring-[0.5px] ring-line">
      <pre
        ref={ref}
        className={cn(
          'font-mono text-footnote leading-5 tracking-normal wrap-anywhere whitespace-pre-wrap text-ink',
          !open && 'line-clamp-2',
        )}
      >
        {text}
      </pre>
      {(clipped || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="relative mt-1 text-footnote font-medium text-ink-2 select-none hover:text-ink after:absolute after:-inset-x-2 after:-inset-y-3"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function Receipt({ item, fresh }: { item: Item; fresh: boolean }) {
  const allowed = item.status === 'approved'
  const label =
    item.status === 'expired'
      ? 'Request timed out'
      : item.choice
        ? RECEIPT[item.choice]
        : allowed
          ? 'Allowed'
          : 'Not allowed'
  const Icon = item.status === 'expired' ? Clock : allowed ? Check : Ban
  return (
    <p
      className={cn(
        'flex h-8 min-w-0 items-center gap-2 text-footnote text-ink-3',
        fresh && allowed && 'receipt-tint -mx-2 px-2',
      )}
    >
      <Icon size={14} strokeWidth={2} aria-hidden className={cn('flex-none', allowed && 'text-success')} />
      <span className="flex-none text-ink-2">{label}</span>
      <span aria-hidden>·</span>
      <span className={cn('truncate', item.command && 'font-mono text-caption tracking-normal')}>
        {item.command ?? item.title}
      </span>
    </p>
  )
}
