import { beforeAll, describe, expect, it } from 'vitest'

// parse.ts reaches the browser's per-Hermes storage on load; a bare stand-in is enough here.
let splitMessage: typeof import('./parse').splitMessage
beforeAll(async () => {
  Object.assign(globalThis, { document: { cookie: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } })
  ;({ splitMessage } = await import('./parse'))
})

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
