import { describe, expect, it, vi } from 'vitest'

/** Local storage as a browser has it: its keys are what Object.keys lists. */
function storage(entries: Record<string, string>) {
  const store: Record<string, string> = { ...entries }
  Object.defineProperties(store, {
    getItem: { value: (key: string) => store[key] ?? null },
    setItem: { value: (key: string, value: string) => void (store[key] = value) },
    removeItem: { value: (key: string) => void delete store[key] },
  })
  return store
}

// Read once, as the module loads: no Hermes chosen yet.
vi.stubGlobal('document', { cookie: '' })
const { forgetForEveryHermes } = await import('./instance')

describe('forgetting a key for every Hermes (signing out)', () => {
  it('forgets it for the first Hermes and every other, and nothing else', () => {
    const kept = storage({
      'murmur:roster': '[]',
      'murmur@h2:roster': '[]',
      'murmur@Vps9:roster': '[]',
      'murmur:roster-order': 'keep',
      'murmur@h2:seen': 'keep',
      'murmur:seen': 'keep',
      'other:roster': 'keep',
    })
    vi.stubGlobal('localStorage', kept)
    forgetForEveryHermes('murmur:roster')
    expect(Object.keys(kept).sort()).toEqual(['murmur:roster-order', 'murmur:seen', 'murmur@h2:seen', 'other:roster'])
  })

  it('does nothing where there is no storage', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => forgetForEveryHermes('murmur:roster')).not.toThrow()
  })
})
