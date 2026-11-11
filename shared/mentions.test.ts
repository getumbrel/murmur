import { describe, expect, it } from 'vitest'
import { mentionedIds, toHandles, unmention } from './mentions.ts'

const members = [
  { id: 'default', name: 'Hermes', handle: 'hermes' },
  { id: 'scout', name: 'Scout', handle: 'scout' },
]

describe('a passage being quoted', () => {
  it('names people without asking them', () => {
    expect(unmention('Ask @Hermes about the trams, or @scout.', members)).toBe('Ask Hermes about the trams, or scout.')
    expect(unmention('Over to you, @everyone', members)).toBe('Over to you, everyone')
  })

  it('keeps what only looks like a mention', () => {
    expect(unmention('Write to me@hermes.example, or to @someone else', members)).toBe('Write to me@hermes.example, or to @someone else')
  })

  it('leaves the message addressed to who you ask in your own words', () => {
    const sent = toHandles(`> ${unmention('Ask @Hermes about the trams.', members)}\n\n@Scout which stop?`, members)
    expect(sent).toBe('> Ask Hermes about the trams.\n\n@scout which stop?')
    expect(mentionedIds(sent, members)).toEqual(['scout'])
  })
})
