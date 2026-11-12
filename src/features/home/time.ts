// Compact, Messages-style times for list rows: "now", "4m", "3h", "Yesterday",
// "Tue", "12 Oct". Recomputed on render; the roster re-renders often enough.

const day = (t: number) => new Date(t).setHours(0, 0, 0, 0)

export function shortTime(at: number, now = Date.now()) {
  if (!at) return ''
  const mins = Math.floor((now - at) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  if (days === 0) return `${Math.floor(mins / 60)}h`
  if (days === 1) return 'Yesterday'
  if (days < 7) return new Date(at).toLocaleDateString(undefined, { weekday: 'short' })
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })
}

/** When, as you'd say it: "a moment ago", "20 minutes ago", "yesterday", "on Tuesday", "on 12 Oct". */
export function sinceWords(at: number, now = Date.now()) {
  const mins = Math.floor((now - at) / 60_000)
  if (mins < 2) return 'a moment ago'
  if (mins < 60) return `${mins} minutes ago`
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  if (days === 0) return mins < 120 ? 'an hour ago' : `${Math.floor(mins / 60)} hours ago`
  if (days === 1) return 'yesterday'
  if (days < 7) return `on ${new Date(at).toLocaleDateString(undefined, { weekday: 'long' })}`
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return `on ${new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })}`
}

export function greeting(now = new Date()) {
  const h = now.getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
