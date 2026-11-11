import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: class extends Error {} }))
vi.stubGlobal('document', { cookie: '' })

const { readable } = await import('./agents')

describe('a chat’s title', () => {
  it('is never the note Hermes adds for the model on a call', () => {
    expect(readable('[Note: this message is a delegation from a live…')).toBe('')
    expect(readable('[Note: this message is a delegation from a live… #2')).toBe('')
    // So the list falls through to what you said.
    expect(readable('[Note: this message is a delegation from a live…') || readable('Hey, how are you?')).toBe('Hey, how are you?')
  })
  it('leaves anything else alone', () => {
    expect(readable('Plan my week')).toBe('Plan my week')
    expect(readable('[Note] from the meeting')).toBe('[Note] from the meeting')
  })
  it('goes by what was written under a quoted passage, or the passage sent by itself', () => {
    expect(readable('> Pack a light jacket\n\nHow cold is it?')).toBe('How cold is it?')
    expect(readable('> Pack a light jacket')).toBe('Pack a light jacket')
  })
})
