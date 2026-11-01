import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('document', { cookie: '' })
const { afterRemoving } = await import('./voice-setup')
type Voice = Parameters<typeof afterRemoving>[1]

const voice = (over: Partial<Voice> = {}) =>
  ({ keys: { openai: false, elevenlabs: false }, localWorks: true, plugin: {}, ...over }) as Voice

describe('taking a voice’s key away', () => {
  it('moves the agent to its own machine when it was the voice in use', () => {
    expect(afterRemoving('elevenlabs', voice(), true, 'Calltest')).toEqual({
      to: 'local',
      note: 'Key removed. Calltest now talks on your Umbrel.',
    })
  })

  it('leaves the voice alone when it wasn’t in use', () => {
    expect(afterRemoving('openai', voice(), false, 'Calltest')).toEqual({ note: 'Key removed.' })
  })

  it('keeps OpenAI going on the key the agent’s models use', () => {
    expect(afterRemoving('openai', voice({ keys: { openai: true, elevenlabs: false } }), true, 'Calltest')).toEqual({
      note: 'Key removed. The voice still works with the key your models use.',
    })
  })

  it('says it’s this Hermes, not an Umbrel, off the Umbrel', () => {
    expect(afterRemoving('elevenlabs', voice({ plugin: null }), true, 'Calltest').note).toBe('Key removed. Calltest now talks on this Hermes.')
  })

  it('asks for another voice when the agent can’t talk on its own machine', () => {
    expect(afterRemoving('elevenlabs', voice({ localWorks: false }), true, 'Calltest')).toEqual({
      to: 'none',
      note: 'Key removed. Choose another voice for Calltest.',
    })
  })
})

describe('signing out of ChatGPT', () => {
  it('moves the agent off it when it was the voice in use', () => {
    expect(afterRemoving('chatgpt', voice(), true, 'Calltest')).toEqual({
      to: 'local',
      note: 'Signed out. Calltest now talks on your Umbrel.',
    })
  })

  it('stays put when it wasn’t', () => {
    expect(afterRemoving('chatgpt', voice(), false, 'Calltest')).toEqual({ note: 'Signed out.' })
  })
})
