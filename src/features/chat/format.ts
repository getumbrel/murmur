/** "a moment", "12s", "1m 4s", "2h 5m" */
export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 1) return 'a moment'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

/** Compact step duration for lists: "0.4s", "12s", "1m 4s". */
export function formatStep(ms: number) {
  if (ms < 950) return `${Math.max(0.1, ms / 1000).toFixed(1)}s`
  return formatDuration(ms)
}
