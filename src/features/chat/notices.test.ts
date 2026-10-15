import { describe, expect, it, vi } from 'vitest'

const toast = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn(), dismiss: vi.fn() })
vi.mock('sonner', () => ({ toast }))
const handlers: ((ev: { type: string; payload?: unknown }) => void)[] = []
vi.mock('@/hermes/gateway', () => ({ gateway: { onEvent: (fn: (typeof handlers)[number]) => handlers.push(fn) } }))

const { showNotice, wireNotices } = await import('./notices')

describe('Hermes notices', () => {
  it('show as a toast of their level, for as long as Hermes says', () => {
    expect(showNotice({ text: 'Credits running low', level: 'warn', kind: 'ttl', ttl_ms: 8000, key: 'credits' })).toBe(
      true,
    )
    expect(toast.warning).toHaveBeenCalledWith('Credits running low', { id: 'hermes-notice:credits', duration: 8000 })
    showNotice({ text: 'Still waking up', level: 'info', kind: 'sticky' })
    expect(toast).toHaveBeenCalledWith('Still waking up', { id: 'hermes-notice:Still waking up', duration: Infinity })
  })

  it('show once, however many chats hear them', () => {
    const n = { text: 'Out of credits', level: 'error', key: 'out' }
    expect(showNotice(n, 1000)).toBe(true)
    expect(showNotice(n, 2000)).toBe(false)
    // A changed notice under the same key replaces it.
    expect(showNotice({ ...n, text: 'Out of credits: top up' }, 3000)).toBe(true)
    expect(showNotice({ text: '  ' })).toBe(false)
  })

  it('show again once a minute has passed', () => {
    const n = { text: 'Provider is slow', level: 'warn', key: 'slow' }
    expect(showNotice(n, 10_000)).toBe(true)
    expect(showNotice(n, 69_000)).toBe(false)
    expect(showNotice(n, 71_000)).toBe(true)
  })

  it('come from Hermes’s events, and go when Hermes clears them', () => {
    wireNotices()
    wireNotices()
    expect(handlers).toHaveLength(1)
    handlers[0]({ type: 'notification.show', payload: { text: 'Back up', level: 'success', key: 'up' } })
    expect(toast.success).toHaveBeenCalledWith('Back up', { id: 'hermes-notice:up', duration: undefined })
    handlers[0]({ type: 'notification.clear', payload: { key: 'up' } })
    expect(toast.dismiss).toHaveBeenCalledWith('hermes-notice:up')
    // Cleared, the same notice can show again straight away.
    expect(showNotice({ text: 'Back up', key: 'up' })).toBe(true)
  })
})
