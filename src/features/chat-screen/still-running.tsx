import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ToolIcon } from '@/features/chat/tool-icon'
import { formatDuration } from '@/features/chat/format'
import { runningLine, type Running } from '@/features/chat/running'

/** The time, each half minute while something's counting: a long wait is told in minutes. */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [active])
  return now
}

/** How long it's been going, in whole minutes; nothing for the first one. */
function goingFor(since: number, now: number) {
  const minutes = Math.floor((now - since) / 60_000)
  return minutes >= 1 ? formatDuration(minutes * 60_000) : ''
}

/**
 * The reply is in, but a command the agent started is still going: one quiet
 * line over the message box says so, with Stop. It's there only while that's
 * true; when the command finishes, the agent picks the chat back up itself
 * ("Command finished").
 */
export function StillRunning({
  running,
  stopping,
  onStop,
}: {
  running?: Running
  stopping?: boolean
  onStop: () => void
}) {
  const reduce = useReducedMotion()
  const now = useNow(!!running)
  // On its way out it still says what it said.
  const last = useRef(running)
  if (running) last.current = running
  const shown = running ?? last.current
  const going = shown ? goingFor(shown.since, now) : ''
  return (
    <AnimatePresence initial={false}>
      {running && shown && (
        <motion.div
          key="running"
          initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <p role="status" className="flex h-7 items-center justify-center gap-1.5 pb-2 text-footnote text-ink-3">
            <span className="flex flex-none">
              <ToolIcon category="terminal" size={13} />
            </span>
            <span className="truncate">
              <span className="text-shimmer">{stopping ? 'Stopping' : runningLine(shown.ids.length)}</span>
              {going && !stopping && <span className="tabular-nums"> · {going}</span>}
            </span>
            {!stopping && (
              <button
                type="button"
                onClick={onStop}
                className="pressable relative ml-1 flex-none font-medium text-accent after:absolute after:-inset-x-3 after:-inset-y-2.5"
              >
                Stop
              </button>
            )}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
