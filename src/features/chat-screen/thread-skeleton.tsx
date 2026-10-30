import { useEffect, useState } from 'react'
import { Skeleton } from '@/ui/skeleton'

const BUBBLE = 'ml-auto h-11 rounded-[20px] rounded-br-md'

/** Reply-shaped lines on the prose's own 25.6px rhythm; the last runs short. */
function Lines({ widths }: { widths: string[] }) {
  return (
    <div>
      {widths.map((w, i) => (
        <span key={i} className="flex h-[1.6rem] items-center">
          <Skeleton className="h-3 rounded-full" style={{ width: w }} />
        </span>
      ))}
    </div>
  )
}

/**
 * A stored chat whose messages are still on their way, laid out on the
 * thread's own spacing (a reply 16px under its message, 24px between
 * exchanges) so nothing shifts when they land. Quick loads never see it.
 * `stalled`: they couldn't be read for a while, so it says so, and offers to
 * try now (they're still being tried either way).
 */
export function ThreadSkeleton({ stalled, onRetry }: { stalled?: boolean; onRetry?: () => void }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 400)
    return () => window.clearTimeout(t)
  }, [])
  if (!shown) return null
  return (
    <div role="status" className="flex w-full flex-1 animate-fade flex-col self-stretch">
      <span className="sr-only">Loading messages</span>
      <Skeleton className={`${BUBBLE} w-[46%]`} />
      <div className="mt-4">
        <Lines widths={['92%', '86%', '54%']} />
      </div>
      <Skeleton className={`${BUBBLE} mt-6 w-[30%]`} />
      <div className="mt-4">
        <Lines widths={['80%', '48%']} />
      </div>
      {stalled && (
        <p className="mt-8 animate-fade text-center text-footnote text-balance text-ink-3">
          Can’t load these messages right now.{' '}
          <button type="button" onClick={onRetry} className="pressable font-medium text-accent">
            Try again
          </button>
        </p>
      )}
    </div>
  )
}
