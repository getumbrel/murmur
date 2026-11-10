// When things were said. A thread tells the time the way Messages does: a
// quiet line where a conversation picks up again after a pause, and each
// message's own time one step away (under the pointer, or in its menu).

import { useEffect, useState } from 'react'

/** A pause this long (or a new day) and the conversation picks up under a time. */
const PAUSE = 60 * 60_000

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** "14:05", the way the device writes it. */
export const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** "Today", "Yesterday", "Monday" this week, then "Mon, 12 Oct" (and the year once it's not this one). */
export function dayName(ms: number, now = new Date()) {
  const date = new Date(ms)
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' })
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

/** Whether something said at `at` picks the conversation up again, after what was last said at `prev`. */
export const picksUp = (prev: number, at: number) =>
  !prev || at - prev >= PAUSE || startOfDay(new Date(prev)) !== startOfDay(new Date(at))

/**
 * Which of a thread's rows open under a time: the first, and each that picks
 * up after a pause. `starts` is when a row begins something (your message, the
 * agent woken); `ends`, the last time known in it. A row with neither says
 * nothing about time and is passed over.
 */
export function timeHeaders<R extends { id: string }>(
  rows: R[],
  when: (row: R) => { starts?: number; ends?: number },
) {
  const headers = new Map<string, number>()
  let prev = 0
  for (const row of rows) {
    const { starts, ends } = when(row)
    if (starts && picksUp(prev, starts)) headers.set(row.id, starts)
    prev = Math.max(prev, starts ?? 0, ends ?? 0)
  }
  return headers
}

/** Today, as a number that changes at midnight (and when the app comes back to the front), so "Today" stays true. */
export function useToday() {
  const [day, setDay] = useState(() => startOfDay(new Date()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const now = new Date()
      setDay(startOfDay(now))
      clearTimeout(timer)
      timer = setTimeout(tick, startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) - now.getTime() + 1000)
    }
    tick()
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return day
}
