import { describe, expect, it } from 'vitest'
import { plainLine, splitMessage } from './message.ts'

const kinds = (text: string) =>
  splitMessage(text).map((s) => (s.kind === 'media' ? `media:${s.path}` : s.kind))

describe('splitMessage', () => {
  it('delivers files the agent sends', () => {
    expect(kinds('Here it is:\nMEDIA:/opt/data/screenshots/umbrel.png')).toEqual(['md', 'media:/opt/data/screenshots/umbrel.png'])
    expect(kinds('Inline MEDIA:/opt/data/a b.png works too.')).toContain('media:/opt/data/a b.png')
    expect(kinds('Link MEDIA:https://example.com/x.png')).toContain('media:https://example.com/x.png')
  })

  it('leaves prose about the tag alone', () => {
    expect(kinds('I used the `MEDIA:path` tag and it worked.')).toEqual(['md'])
    expect(kinds('Then I wrote `MEDIA:` and you received it.')).toEqual(['md'])
  })
})

describe('plainLine', () => {
  it('reads markdown as its words', () => {
    expect(plainLine('## Two new emails\n\n- **Sam**: the venue moved to [Hall B](https://x.y)')).toBe('Two new emails - Sam: the venue moved to Hall B')
    expect(plainLine('```\nraw\n```\nDone.')).toBe('Done.')
    expect(plainLine('> quoted *softly* and _gently_, ~~not~~ `code`')).toBe('quoted softly and gently, not code')
    expect(plainLine('| Task | Status |\n|---|:---:|\n| Email | Done |')).toBe('Task · Status · Email · Done')
  })

  it('leaves the marks that belong to words', () => {
    expect(plainLine('Edited __init__.py and snake_case_name in #3')).toBe('Edited __init__.py and snake_case_name in #3')
    expect(plainLine('2 * 3 * 4 = 24, and __bold__.')).toBe('2 * 3 * 4 = 24, and bold.')
  })
})
