import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@/features/chat/types'
import { fold, hitsIn, nearest, needle, placesIn, saidIn, standing, step } from './find'

const you = (id: string, text: string): ChatItem => ({ kind: 'user', id, text, at: 0 })
const agent = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, text, streaming: false, at: 0 })

describe('reading text the way Find does', () => {
  it('takes capitals, accents and curly quotes as the plain ones', () => {
    expect(fold('Pastéis de Belém').text).toBe('pasteis de belem')
    expect(fold('Don’t “wait”').text).toBe('don\'t "wait"')
    expect(needle('  São   Sebastião ')).toBe('sao sebastiao')
  })

  it('reads a line break as a space', () => {
    expect(placesIn('the red\nline', 'red line')).toEqual([[4, 12]])
  })

  it('says where each match is in the text as written', () => {
    expect(placesIn('Lisbon, then back to Lisbon', 'lisbon')).toEqual([
      [0, 6],
      [21, 27],
    ])
    // An accent written as a mark of its own belongs to its letter.
    expect(placesIn('café au lait', needle('café'))).toEqual([[0, 5]])
    expect(placesIn('Jerónimos', 'jeronimos')).toEqual([[0, 9]])
  })

  it('finds part of a word, and nothing for nothing', () => {
    expect(placesIn('polished cobbles', 'lis')).toEqual([[2, 5]])
    expect(placesIn('anything', '')).toEqual([])
  })
})

describe('what a message says', () => {
  it('is a reply as it reads, not as it was written', () => {
    const said = saidIn(
      agent('a', '## Day 2\n**Belém** and [Manteigaria](https://manteigaria.com)\n```sh\nnpm run build\n```'),
    )!
    expect(placesIn(said, needle('Belém and Manteigaria'))).toHaveLength(1)
    expect(placesIn(said, 'https')).toHaveLength(0)
    expect(placesIn(said, 'npm run build')).toHaveLength(1)
    expect(placesIn(said, '```')).toHaveLength(0)
  })

  it('is your words and the files you sent', () => {
    const item: ChatItem = {
      kind: 'user',
      id: 'u',
      text: 'Here it is',
      at: 0,
      attachments: [{ kind: 'file', name: 'lisbon.pdf' }],
    }
    expect(placesIn(saidIn(item)!, 'lisbon')).toHaveLength(1)
  })

  it('is nothing for a step', () => {
    expect(saidIn({ kind: 'notice', id: 'n', text: 'Lisbon' } as ChatItem)).toBeUndefined()
  })
})

const chat = [
  you('u1', 'Three days in Lisbon?'),
  agent('a1', 'Lisbon first, then Sintra, then back to Lisbon.'),
  you('u2', 'And Porto?'),
  agent('a2', 'Porto is three hours from Lisbon by train.'),
]

describe('every place the words are', () => {
  const hits = hitsIn(chat, 'lisbon')

  it('is each message they are in, oldest first, with how often', () => {
    expect(hits).toEqual([
      { id: 'u1', count: 1 },
      { id: 'a1', count: 2 },
      { id: 'a2', count: 1 },
    ])
  })

  it('takes what the page counted over its own guess', () => {
    expect(
      hitsIn(
        chat,
        'lisbon',
        new Map([
          ['a1', 3],
          ['u2', 1],
        ]),
      ),
    ).toEqual([
      { id: 'u1', count: 1 },
      { id: 'a1', count: 3 },
      { id: 'u2', count: 1 },
      { id: 'a2', count: 1 },
    ])
  })

  it('starts at the newest, and counts from there', () => {
    const start = nearest(hits, chat)
    expect(start).toEqual({ id: 'a2', nth: 'last' })
    expect(standing(hits, start)).toBe(1)
  })

  it('starts from the message being read, when that is further back', () => {
    expect(nearest(hits, chat, 'u2')).toEqual({ id: 'a1', nth: 'last' })
    expect(nearest(hits, chat, 'a1')).toEqual({ id: 'a1', nth: 'last' })
    // Nothing that far back: the newest after all.
    expect(nearest(hitsIn(chat, 'porto'), chat, 'u1')).toEqual({ id: 'a2', nth: 'last' })
  })

  it('steps back through a message, then to the one before, and round', () => {
    let at = nearest(hits, chat)
    const seen = [standing(hits, at)]
    for (let i = 0; i < 4; i++) {
      at = step(hits, at, true)
      seen.push(standing(hits, at))
    }
    expect(seen).toEqual([1, 2, 3, 4, 1])
    expect(step(hits, { id: 'a1', nth: 1 }, true)).toEqual({ id: 'a1', nth: 0 })
    expect(step(hits, { id: 'a1', nth: 0 }, true)).toEqual({ id: 'u1', nth: 'last' })
  })

  it('steps forward the same way', () => {
    expect(step(hits, { id: 'a1', nth: 0 }, false)).toEqual({ id: 'a1', nth: 1 })
    expect(step(hits, { id: 'a1', nth: 'last' }, false)).toEqual({ id: 'a2', nth: 0 })
    expect(step(hits, { id: 'a2', nth: 0 }, false)).toEqual({ id: 'u1', nth: 0 })
  })

  it('has nowhere to go when there are none', () => {
    expect(nearest([], chat)).toBeUndefined()
    expect(step([], undefined, true)).toBeUndefined()
    expect(standing(hits, { id: 'gone', nth: 0 })).toBe(0)
  })
})
