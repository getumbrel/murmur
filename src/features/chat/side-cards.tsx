import { Check, CircleAlert, Copy, MessageCircleQuestionMark, SquareSlash, X } from 'lucide-react'
import type { ChatItem } from './types'
import { cn } from '@/lib/cn'
import { RichText } from '@/features/media/rich-text'
import { useCopy } from './use-copy'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

const dismissButton =
  'pressable relative flex size-7 flex-none items-center justify-center rounded-full text-ink-3 hover:bg-fill-2 hover:text-ink-2 after:absolute after:-inset-2'

// Terminal colour codes and box-drawing leftovers don't belong on a card.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const tidy = (text: string) => text.replace(ANSI, '').replace(/^\n+|\s+$/g, '')

/** A slash command you ran and what it printed: a tidy monospace note, not part of the conversation. */
export function CommandCard({
  item,
  isNew,
  onDismiss,
}: {
  item: Of<'command'>
  isNew: boolean
  onDismiss?: (id: string) => void
}) {
  const { copied, copy } = useCopy()
  const output = tidy(item.output ?? '')
  const failed = item.status === 'error'
  return (
    <section
      aria-label={`${item.command} result`}
      className={cn(
        'group/card overflow-hidden rounded-xl bg-fill-1 ring-[0.5px] ring-line',
        isNew && 'animate-rise',
      )}
    >
      <header className="flex h-11 items-center gap-2 pr-2 pl-4">
        {failed ? (
          <CircleAlert size={14} strokeWidth={2} className="flex-none text-danger" aria-hidden />
        ) : (
          <SquareSlash size={14} strokeWidth={2} className="flex-none text-ink-3" aria-hidden />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-mono text-footnote text-ink-2',
            item.status === 'running' && 'text-shimmer',
          )}
        >
          {item.command}
        </span>
        {item.status === 'done' && output && (
          <button
            type="button"
            onClick={() => copy(output)}
            aria-label={copied ? 'Copied' : 'Copy'}
            title="Copy"
            className={cn(
              dismissButton,
              '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/card:opacity-100 focus-visible:opacity-100',
            )}
          >
            {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
          </button>
        )}
        {onDismiss && item.status !== 'running' && (
          <button
            type="button"
            onClick={() => onDismiss(item.id)}
            aria-label="Dismiss"
            title="Dismiss"
            className={dismissButton}
          >
            <X size={15} strokeWidth={2} />
          </button>
        )}
      </header>
      {item.status !== 'running' && output && (
        <pre
          className={cn(
            'no-scrollbar max-h-80 overflow-auto px-4 pb-3.5 font-mono text-[12.5px] leading-[1.6] whitespace-pre',
            failed ? 'font-sans text-subhead whitespace-pre-wrap text-ink' : 'text-ink-2',
          )}
        >
          {output}
        </pre>
      )}
    </section>
  )
}

/** A side question (/btw) and its answer, set apart from the conversation in the agent's tint. */
export function AsideCard({
  item,
  isNew,
  onDismiss,
}: {
  item: Of<'aside'>
  isNew: boolean
  onDismiss?: (id: string) => void
}) {
  return (
    <section
      aria-label="Side question"
      aria-busy={item.status === 'pending' || undefined}
      className={cn(
        'relative rounded-xl bg-accent-soft px-4 pt-3.5 pb-4 ring-[0.5px] ring-accent/15 ring-inset',
        isNew && 'animate-rise',
      )}
    >
      <header className="flex items-start gap-2">
        <MessageCircleQuestionMark size={15} strokeWidth={2} className="mt-0.5 flex-none text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-caption font-medium tracking-[0.01em] text-accent">On the side</p>
          <p className="mt-0.5 text-subhead text-ink-2">{item.question}</p>
        </div>
        {onDismiss && item.status !== 'pending' && (
          <button
            type="button"
            onClick={() => onDismiss(item.id)}
            aria-label="Dismiss"
            title="Dismiss"
            className={cn(dismissButton, '-mt-1 -mr-2')}
          >
            <X size={15} strokeWidth={2} />
          </button>
        )}
      </header>
      <div className="mt-2.5 pl-[23px]">
        {item.status === 'pending' ? (
          <p className="text-shimmer text-subhead">Thinking it over…</p>
        ) : item.status === 'error' ? (
          <p className="text-subhead text-ink-2">{item.answer || 'Couldn’t answer that just now. Try again.'}</p>
        ) : (
          <div className="animate-fade">
            <RichText text={item.answer ?? ''} />
          </div>
        )}
      </div>
    </section>
  )
}
