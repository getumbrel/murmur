import { useLayoutEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'

/**
 * What heads a chat that was carried on from another: where it came from, in
 * the voice of the thread's own times, and the way back to that chat at the
 * reply it left from.
 *
 * `fresh`: the chat was made just now. Where its messages don't fill the
 * screen, the line opens into place above them (they'd jump down otherwise);
 * where they do, it's up out of sight and simply there.
 */
export function ContinuedFrom({ name, fresh, onOpen }: { name: string; fresh?: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const opened = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!fresh || !el || opened.current) return
    opened.current = true
    const log = el.closest('[role=log]')
    if (!log || log.scrollHeight > log.clientHeight || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    el.animate(
      [
        { height: '0px', opacity: 0 },
        { height: `${el.offsetHeight}px`, opacity: 1 },
      ],
      { duration: 380, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    )
  }, [fresh])
  return (
    <div ref={ref} className="overflow-hidden">
      <div className="flex justify-center pb-4">
        <button
          type="button"
          onClick={onOpen}
          className="pressable relative flex max-w-full items-center gap-1.5 rounded-full text-caption text-ink-3 transition-colors duration-150 after:absolute after:-inset-x-3 after:-inset-y-3.5 hover:text-ink-2"
        >
          <span className="min-w-0 truncate">
            Continued from {name ? <span className="font-semibold">{name}</span> : 'an earlier chat'}
          </span>
          {/* The same mark that says an agent's name leads somewhere. */}
          <ChevronRight size={12} strokeWidth={2.25} className="-ml-1 flex-none" aria-hidden />
        </button>
      </div>
    </div>
  )
}
