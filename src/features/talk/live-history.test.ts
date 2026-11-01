import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@/features/chat/types'
import { liveHistory } from './live-history'

const you = (text: string, id = text) => ({ kind: 'user', id, text }) as ChatItem
const agent = (text: string, more: object = {}) => ({ kind: 'assistant', id: text, text, ...more }) as ChatItem
const texts = (items: ChatItem[]) => liveHistory(items).slice(1).map((m) => m.content[0].text)

describe('what a live voice is told of the chat', () => {
  it('is nothing in a new chat', () => {
    expect(liveHistory([])).toEqual([])
  })

  it('is the conversation in order, in the shape a live session takes', () => {
    expect(liveHistory([you('Where’s Biscuit’s vet?'), agent('In Monterey.')]).slice(1)).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Where’s Biscuit’s vet?' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'In Monterey.' }] },
    ])
  })

  it('tells the voice what this is, ahead of the chat', () => {
    const [first] = liveHistory([you('Hi')])
    expect(first.role).toBe('developer')
    expect(first.content[0].type).toBe('input_text')
    expect(first.content[0].text).toMatch(/carries on the chat/)
  })

  it('leaves out what the agent did, and everything that isn’t what was said', () => {
    const items = [
      you('Check the weather'),
      { kind: 'thinking', id: 't', text: 'Hmm' },
      { kind: 'tool', id: 'x', name: 'web_search', status: 'done', output: 'secret results' },
      { kind: 'notice', id: 'n', text: 'Model switched' },
      { kind: 'error', id: 'e', message: 'It broke' },
      agent('Sunny.'),
    ] as ChatItem[]
    expect(texts(items)).toEqual(['Check the weather', 'Sunny.'])
  })

  it('reads an answer as prose: no code, files or widgets', () => {
    const reply = 'Here it is.\n\n```python\nprint(1)\n```\n\nDone.\nMEDIA:/data/chart.png'
    expect(texts([agent(reply)])).toEqual(['Here it is.\n\nDone.'])
  })

  it('skips a reply that’s still being written, and one that was only a picture', () => {
    expect(texts([you('Hi'), agent('MEDIA:/data/a.png'), agent('Half a sen', { streaming: true })])).toEqual(['Hi'])
  })

  it('keeps the last twenty turns', () => {
    const items = Array.from({ length: 60 }, (_, i) => (i % 2 ? agent(`a${i}`) : you(`u${i}`)))
    const kept = texts(items)
    expect(kept).toHaveLength(40)
    expect(kept.at(-1)).toBe('a59')
    expect(kept[0]).toBe('u20')
  })

  it('keeps to its budget, newest first', () => {
    const long = 'word '.repeat(2000)
    const items = Array.from({ length: 30 }, (_, i) => you(`${i} ${long}`))
    const kept = texts(items)
    expect(kept.join('').length).toBeLessThan(4_000 * 4 + 100)
    expect(kept.at(-1)?.startsWith('29 ')).toBe(true)
    expect(kept.at(-1)?.endsWith('…')).toBe(true)
  })

  it('counts writing without spaces as more than it looks', () => {
    const items = Array.from({ length: 40 }, (_, i) => you(`${i}${'明天天气晴朗'.repeat(100)}`))
    expect([...texts(items).join('')].length).toBeLessThanOrEqual(4_100)
  })
})
