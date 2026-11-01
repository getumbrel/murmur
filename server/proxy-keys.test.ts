import { describe, expect, it } from 'vitest'
import { mayReadKey } from './proxy.ts'

const reveal = (key: unknown, path = '/hermes/api/env/reveal') =>
  mayReadKey(new URL(`http://murmur${path}`), Buffer.from(JSON.stringify({ key })))

describe('what a browser may read of Hermes’s keys', () => {
  it('reads a connected server’s key, which it copies to new agents', () => {
    expect(reveal('MCP_UMBREL_API_KEY')).toBe(true)
    expect(reveal('MCP_OTHER_UMBREL_API_KEY')).toBe(true)
  })

  it('never reads a provider’s key or anything else', () => {
    for (const key of ['ELEVENLABS_API_KEY', 'OPENAI_API_KEY', 'VOICE_TOOLS_OPENAI_KEY', 'OPENROUTER_API_KEY', 'API_SERVER_KEY', 'mcp_umbrel_api_key'])
      expect(reveal(key)).toBe(false)
  })

  it('can’t be talked round with another spelling of the route', () => {
    for (const path of ['/hermes/api/env/reveal/', '/hermes//api/env/reveal', '/hermes/api/env/%72eveal', '/hermes/api/env/reveal//'])
      expect(reveal('ELEVENLABS_API_KEY', path)).toBe(false)
  })

  it('turns away a body it can’t read', () => {
    const url = new URL('http://murmur/hermes/api/env/reveal')
    expect(mayReadKey(url)).toBe(false)
    expect(mayReadKey(url, Buffer.from('not json'))).toBe(false)
    expect(reveal(['ELEVENLABS_API_KEY'])).toBe(false)
  })

  it('leaves everything else alone', () => {
    expect(mayReadKey(new URL('http://murmur/hermes/api/env'))).toBe(true)
    expect(mayReadKey(new URL('http://murmur/hermes/api/audio/speak'), Buffer.from('{}'))).toBe(true)
  })
})
