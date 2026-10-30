import { describe, expect, it, vi } from 'vitest'
import type { ChatItem } from '@/features/chat/types'

// A chat read a page at a time, newest page first, as Hermes sends it.
const pages: ChatItem[][] = []
const chat = { items: [] as ChatItem[], older: false }
vi.mock('@/state/chats', () => ({
  getChat: () => chat,
  loadOlder: vi.fn(async () => {
    chat.items = [...pages.shift()!, ...chat.items]
    chat.older = pages.length > 0
  }),
}))

const { findOlder, findRead, fit, matchOf, needleOf } = await import('./seek')

const user = (id: string, text: string): ChatItem => ({ kind: 'user', id, text, at: 0 })
const said = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, text, streaming: false, at: 0 })

function reading(...newestFirst: ChatItem[][]) {
  pages.length = 0
  pages.push(...newestFirst.slice(1))
  chat.items = newestFirst[0]
  chat.older = pages.length > 0
}

describe('reading a message against a search result’s quote', () => {
  it('takes the quote’s words, marking the match', () => {
    expect(needleOf('...the >>>pelican<<< codeword, again')).toEqual({
      words: ['the', 'pelican', 'codeword', 'again'],
      marked: [false, true, false, false],
    })
    expect(needleOf('no match marked here')).toBeUndefined()
  })

  it('names the words to mark, once each', () => {
    expect(matchOf({ snippet: '>>>Pelican<<< or >>>pelican<<<, the >>>codeword<<<', role: 'user' })).toEqual([
      'pelican',
      'codeword',
    ])
  })

  it('counts the longest run of the quote’s words a message holds, only with the match among them', () => {
    const needle = needleOf('we could fly to >>>Lisbon<<< in early June')!
    expect(fit(needle, 'We could fly to Lisbon in early June, or take the train')).toBe(8)
    expect(fit(needle, 'Lisbon in early June is lovely')).toBe(4)
    expect(fit(needle, 'we could fly somewhere else')).toBe(0)
    // Punctuation and case don't matter; the words do.
    expect(fit(needle, 'WE COULD — fly to: Lisbon!')).toBe(5)
  })

  it('ignores the ellipses where Hermes cut the message', () => {
    expect(
      fit(needleOf('...saw two >>>pelicans<<< over the...')!, 'This morning I saw two pelicans over the harbour'),
    ).toBe(5)
  })
})

describe('finding the message a result was found in', () => {
  it('picks the message holding the quote, not just the word', () => {
    reading([
      user('u1', 'Remind me what the pelican was'),
      said('a1', 'The pelican was the codeword we agreed on for the launch'),
      said('a2', 'Anything else about the pelican?'),
    ])
    expect(findRead('c', { snippet: 'The >>>pelican<<< was the codeword we agreed', role: 'assistant' })).toEqual({
      id: 'a1',
      more: false,
    })
  })

  it('looks only at messages from whoever said it', () => {
    reading([user('u1', 'the pelican was the codeword'), said('a1', 'the pelican was the codeword')])
    expect(findRead('c', { snippet: 'the >>>pelican<<< was the codeword', role: 'user' }).id).toBe('u1')
  })

  it('finds a file the message carried by its name', () => {
    reading([
      {
        kind: 'user',
        id: 'u1',
        text: 'what do you make of this?',
        at: 0,
        attachments: [{ kind: 'file', name: 'q3-report.pdf', path: '/uploads/q3-report.pdf' }],
      },
    ])
    expect(findRead('c', { snippet: '>>>uploads<<</q3-report.pdf what do you', role: 'user' }).id).toBe('u1')
  })

  it('of two that hold as much, opens at the newer', () => {
    reading([said('a1', 'Reply 3.'), said('a2', 'Reply 3.')])
    expect(findRead('c', { snippet: '>>>Reply<<< 3.', role: 'assistant' }).id).toBe('a2')
  })

  it('reads further back when what’s read so far only half fits', () => {
    reading(
      [said('a9', 'the codeword is new now')],
      [user('u1', 'make the pelican the codeword for the launch'), said('a1', 'Done.')],
    )
    const found = { snippet: 'make the >>>pelican<<< the codeword for', role: 'user' } as const
    expect(findRead('c', found)).toEqual({ more: true })
  })

  it('reads back through older pages until it finds it', async () => {
    reading(
      [said('a9', 'nothing here')],
      [said('a5', 'still nothing')],
      [user('u1', 'make the pelican the codeword for the launch')],
      [user('u0', 'the first page, never read')],
    )
    await expect(findOlder('c', { snippet: 'make the >>>pelican<<< the codeword for', role: 'user' })).resolves.toBe(
      'u1',
    )
    expect(chat.older).toBe(true)
  })

  it('settles for a shorter match once nothing older is left', async () => {
    reading([said('a1', 'the pelican flew off')], [said('a0', 'nothing')])
    await expect(
      findOlder('c', { snippet: 'saw the >>>pelican<<< flew past the window', role: 'assistant' }),
    ).resolves.toBe('a1')
  })

  it('opens at the end when no message holds enough of the quote', async () => {
    reading([said('a1', 'a pelican')])
    expect(findRead('c', { snippet: 'one >>>pelican<<< over the harbour', role: 'assistant' })).toEqual({ more: false })
    await expect(
      findOlder('c', { snippet: 'one >>>pelican<<< over the harbour', role: 'assistant' }),
    ).resolves.toBeUndefined()
  })
})
