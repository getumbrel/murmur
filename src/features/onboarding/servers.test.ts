import { describe, expect, it } from 'vitest'
import { addressesFor, isPrivateHost, serverName, ServerProblem } from './servers'

describe('an address someone types', () => {
  it('is plain http at home', () => {
    expect(addressesFor('192.168.1.20:11434').urls).toEqual(['http://192.168.1.20:11434'])
    expect(addressesFor('ollama_ollama_1:11434/v1/').urls).toEqual(['http://ollama_ollama_1:11434/v1'])
    expect(addressesFor('studio.local:1234').urls).toEqual(['http://studio.local:1234'])
  })

  it('is https online, with http as a fallback', () => {
    expect(addressesFor('api.groq.com/openai/v1').urls).toEqual([
      'https://api.groq.com/openai/v1',
      'http://api.groq.com/openai/v1',
    ])
  })

  it('keeps the scheme it was given, except http online, which tries https too', () => {
    expect(addressesFor('https://192.168.1.20:8443/v1').urls).toEqual(['https://192.168.1.20:8443/v1'])
    expect(addressesFor('HTTP://10.0.0.5:8000').urls).toEqual(['http://10.0.0.5:8000'])
    expect(addressesFor('http://llm.example.com/v1').urls).toEqual([
      'http://llm.example.com/v1',
      'https://llm.example.com/v1',
    ])
  })

  it('says when it isn’t an address', () => {
    expect(() => addressesFor('not an address')).toThrow(ServerProblem)
    expect(() => addressesFor('http://')).toThrow(/doesn’t look like an address/)
  })
})

describe('a private host', () => {
  it('is this machine, a container, the LAN or a tailnet', () => {
    for (const h of [
      'localhost',
      '127.0.0.1',
      '[::1]',
      'ollama_ollama_1',
      '10.21.0.1',
      '172.17.0.1',
      '192.168.1.20',
      '100.101.5.9',
      'studio.local',
      'host.docker.internal',
      'box.tail1234.ts.net',
      'fd12::1',
    ])
      expect(isPrivateHost(h), h).toBe(true)
  })

  it('isn’t anything online', () => {
    for (const h of ['api.groq.com', 'openrouter.ai', '8.8.8.8', '172.32.0.1', '100.128.0.1', 'example.com'])
      expect(isPrivateHost(h), h).toBe(false)
  })
})

describe('a server’s name', () => {
  it('is the service’s own, online', () => {
    expect(serverName('https://api.groq.com/openai/v1')).toBe('Groq')
    expect(serverName('https://openrouter.ai/api/v1')).toBe('OpenRouter')
    expect(serverName('https://generativelanguage.googleapis.com/v1beta/openai')).toBe('Gemini')
  })

  it('is the app at home, by its usual port', () => {
    expect(serverName('http://192.168.1.20:11434/v1')).toBe('Ollama')
    expect(serverName('http://localhost:1234/v1')).toBe('LM Studio')
  })

  it('is the address otherwise', () => {
    expect(serverName('http://192.168.1.20:8000/v1')).toBe('192.168.1.20:8000')
    expect(serverName('https://llm.example.com/v1')).toBe('llm.example.com')
    // A port only names it at home.
    expect(serverName('https://models.example.com:11434/v1')).toBe('models.example.com:11434')
  })
})
