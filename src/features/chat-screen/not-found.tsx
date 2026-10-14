import { Orb } from '@/ui/orb'
import { Button } from '@/ui/button'

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
  action: string
  onAction: () => void
  hue?: number
}) {
  return (
    <div role="alert" className="flex animate-rise flex-col items-center px-8 text-center">
      <Orb hue={hue} size={72} state="offline" />
      <h1 className="mt-5 text-title font-semibold tracking-[-0.02em] text-balance">{title}</h1>
      <p className="mt-1 max-w-72 text-subhead text-pretty text-ink-2">{body}</p>
      <Button className="mt-7" variant="secondary" onClick={onAction}>
        {action}
      </Button>
    </div>
  )
}
