import { Orb } from '@/ui/orb'
import { Button } from '@/ui/button'
import { sinceWords } from '@/features/home/time'

/** Something you followed a link to isn't there: a sleeping orb, what happened, and one way on. */
export function NotFound({
  title,
  body,
  action,
  onAction,
  hue = 278,
}: {
  title: string
  body: string
  /** One way on, where there is one. */
  action?: string
  onAction?: () => void
  hue?: number
}) {
  return (
    <div role="alert" className="flex animate-rise flex-col items-center px-8 text-center">
      <Orb hue={hue} size={72} state="offline" />
      <h1 className="mt-5 text-title font-semibold tracking-[-0.02em] text-balance">{title}</h1>
      <p className="mt-1 max-w-72 text-subhead text-pretty text-ink-2">{body}</p>
      {action && (
        <Button className="mt-7" variant="secondary" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  )
}

/** A chat that won't open yet, said quietly over the message box when its messages are on screen. */
export function CantOpen({ onRetry }: { onRetry: () => void }) {
  return (
    <p role="status" className="animate-fade pb-2 text-center text-footnote text-balance text-ink-3">
      Can’t open this chat right now.{' '}
      <button type="button" onClick={onRetry} className="pressable font-medium text-accent">
        Try again
      </button>
    </p>
  )
}

/**
 * The chat can't be read right now, so these are its messages as this device
 * last saw them (state/kept.ts): said quietly over the message box, where the
 * newest of them end, and gone the moment the chat is read.
 */
export function LastSeen({ at }: { at: number }) {
  return (
    <p role="status" className="animate-fade pb-2 text-center text-footnote text-balance text-ink-3">
      As you last saw it, {sinceWords(at)}
    </p>
  )
}
