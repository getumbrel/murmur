import { describe, expect, it } from 'vitest'
import { emptyLine, privacyLine } from './connect-copy'

describe('a model server with no models', () => {
  it('says Ollama on this Umbrel is just empty', () => {
    expect(emptyLine({ name: 'Ollama', baseUrl: 'http://ollama_ollama_1:11434/v1' }, true)).toBe(
      'Ollama has no models yet.',
    )
  })

  it('names the computer it’s on elsewhere', () => {
    expect(emptyLine({ name: 'Ollama', baseUrl: 'http://192.168.1.20:11434/v1' }, false)).toBe(
      'Ollama on 192.168.1.20 has no models yet.',
    )
    expect(emptyLine({ name: 'Ollama', baseUrl: 'http://studio.local:11434/v1' }, true)).toBe(
      'Ollama on studio.local has no models yet.',
    )
  })

  it('calls this machine "this computer"', () => {
    expect(emptyLine({ name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' })).toBe(
      'LM Studio on this computer has no models yet.',
    )
  })
})

describe('the privacy line under the servers', () => {
  it('names where they run, when every one is at home', () => {
    expect(privacyLine([{ baseUrl: 'http://ollama_ollama_1:11434/v1' }], true)).toBe('Runs privately on your Umbrel. Nothing leaves your home.')
    expect(privacyLine([{ baseUrl: 'http://127.0.0.1:1234/v1' }])).toBe('Runs privately on your own computer. Nothing leaves your home.')
    expect(privacyLine([{ baseUrl: 'http://ollama_ollama_1:11434/v1' }, { baseUrl: 'http://192.168.1.20:11434/v1' }], true)).toBe(
      'Runs privately on your own network. Nothing leaves your home.',
    )
  })

  it('promises nothing once one is online', () => {
    expect(privacyLine([{ baseUrl: 'http://192.168.1.20:11434/v1' }, { baseUrl: 'https://api.groq.com/openai/v1' }])).toBeNull()
    expect(privacyLine([])).toBeNull()
  })
})
