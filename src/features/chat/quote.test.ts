import { describe, expect, it, vi } from 'vitest'
import type { ChatItem } from './types'

vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))

const { sourceOf } = await import('./quote')

const you = (id: string, text: string): ChatItem => ({ kind: 'user', id, text, at: 0 })
const agent = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, text, streaming: false, at: 0 })

describe('finding the reply a quoted passage came from', () => {
  const chat = [
    you('u1', 'Where should I stay?'),
    agent('a1', 'Stay in **Chiado**.\n\n- Alfama is the oldest quarter\n- Príncipe Real is quieter'),
    you('u2', 'And the weather?'),
    agent('a2', 'Pack a light jacket for evenings by the river. See [the forecast](https://example.com/lisbon).'),
    you('u3', '> Pack a light jacket\n\nHow cold?'),
    agent('a3', 'Pack a light jacket, I said.'),
  ]

  it('is the reply that holds it, before your message', () => {
    expect(sourceOf(chat, 'u3', 'Pack a light jacket')).toBe('a2')
    expect(sourceOf(chat, 'u3', 'Alfama is the oldest quarter')).toBe('a1')
  })

  it('reads past what Markdown adds and the page doesn’t show', () => {
    // Bold marks, and a line break where the page had a space.
    expect(sourceOf(chat, 'u3', 'Stay in Chiado.')).toBe('a1')
    // List markers between two selected items.
    expect(sourceOf(chat, 'u3', 'Alfama is the oldest quarter\nPríncipe Real is quieter')).toBe('a1')
    // A link's address inside the passage: found by the line that's whole.
    expect(sourceOf(chat, 'u3', 'Pack a light jacket for evenings by the river. See the forecast.')).toBe('a2')
  })

  it('is the newest such reply, and never one after your message', () => {
    expect(sourceOf(chat, 'u3', 'Pack a light jacket')).toBe('a2')
    expect(sourceOf([...chat, you('u4', '> Pack a light jacket')], 'u4', 'Pack a light jacket')).toBe('a3')
  })

  it('is nowhere when nothing said holds it', () => {
    expect(sourceOf(chat, 'u3', 'Take the ferry to Cacilhas')).toBeUndefined()
    expect(sourceOf(chat, 'u3', '…')).toBeUndefined()
    // Your own words aren't a reply.
    expect(sourceOf(chat, 'u3', 'And the weather?')).toBeUndefined()
  })
})
