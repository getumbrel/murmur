import { describe, expect, it } from 'vitest'
import { prettyModel } from './names'

describe('model names', () => {
  it('reads ids as names', () => {
    expect(prettyModel('gpt-6.1-sol')).toBe('GPT‑6.1 Sol')
    expect(prettyModel('anthropic/claude-opus-5')).toBe('Claude Opus 5')
    expect(prettyModel('llama3.2:3b')).toBe('Llama3.2 3B')
  })

  it('leaves out how a downloaded file was packed', () => {
    expect(prettyModel('Qwen3.5-4B-Q4_K_M')).toBe('Qwen3.5 4B')
    expect(prettyModel('Qwen3.8-27B-UD-Q3_K_XL')).toBe('Qwen3.8 27B')
    expect(prettyModel('Qwen3.5-0.8B-BF16')).toBe('Qwen3.5 0.8B')
    expect(prettyModel('Qwen3.6-35B-A3B-UD-Q4_K_M')).toBe('Qwen3.6 35B A3B')
  })
})
