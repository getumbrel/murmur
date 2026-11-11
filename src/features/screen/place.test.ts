import { describe, expect, it } from 'vitest'
import { frameId, pageCut } from './frame'
import { browserKey, foldedIn, placeBrowsers, type BrowserUse } from './place'

const use = (id: string, more: Partial<BrowserUse> = {}): BrowserUse => ({ agent: 'default', id, call: id, done: true, ...more })

describe('where a reply’s browser goes', () => {
  it('shows it once, under the run of steps that last used it', () => {
    const placed = placeBrowsers([[use('a', { site: 'shop.example.com' })], [], [use('b'), use('c')], []])
    expect(placed.map((run) => run.length)).toEqual([0, 0, 1, 0])
    expect(placed[2][0].agent).toBe('default')
  })

  it('is named for its first step there, which stays the same as the reply goes on', () => {
    const early = placeBrowsers([[use('tool-1', { call: 'call_1', done: false })]])[0][0]
    const later = placeBrowsers([[use('tool-1', { call: 'call_1' })], [use('tool-2', { call: 'call_2' })]])[1][0]
    expect(early.step).toEqual({ key: 'tool-1', done: false })
    expect(later.step).toEqual({ key: 'tool-1', done: true })
    expect([early.frame, later.frame]).toEqual(['call_1', 'call_1'])
  })

  it('keeps its picture under the same name while the reply streams and when it’s read back', () => {
    const streamed = placeBrowsers([[use('tool-call_7', { call: 'call_7' })]])[0][0]
    const readBack = placeBrowsers([[use('m42-call_7', { call: 'call_7' })]])[0][0]
    expect(streamed.frame).toBe(readBack.frame)
    // A step Hermes gave no id has nowhere to keep one.
    expect(placeBrowsers([[use('tool-x', { call: undefined })]])[0][0].frame).toBeUndefined()
  })

  it('is where the agent left it: the last page it opened', () => {
    const [[browsing]] = placeBrowsers([
      [
        use('a', { site: 'google.com', page: 'https://www.google.com/search?q=kettles' }),
        use('b'),
        use('c', { site: 'shop.example.com', page: 'https://shop.example.com/kettles/42?ref=search' }),
        use('d'),
      ],
    ])
    expect(browsing.site).toBe('shop.example.com')
    expect(browsing.page).toBe('https://shop.example.com/kettles/42?ref=search')
  })

  it('names the site even when its address isn’t one a link can open, and nothing when it opened none', () => {
    expect(placeBrowsers([[use('a', { site: '192.168.1.4' })]])[0][0]).toMatchObject({ site: '192.168.1.4' })
    expect(placeBrowsers([[use('a', { site: '192.168.1.4' })]])[0][0].page).toBeUndefined()
    const [[bare]] = placeBrowsers([[use('a')]])
    expect(bare.site).toBeUndefined()
    expect(bare.page).toBeUndefined()
  })

  it('gives each agent in a group its own, under its own last run', () => {
    const placed = placeBrowsers([
      [use('a', { agent: 'atlas', site: 'a.example.com' })],
      [use('b', { agent: 'nova', site: 'b.example.com' })],
      [use('c', { agent: 'atlas' })],
    ])
    expect(placed.map((run) => run.map((b) => `${b.agent} ${b.site}`))).toEqual([[], ['nova b.example.com'], ['atlas a.example.com']])
  })
})

describe('one browser per chat', () => {
  it('folds a reply’s screen once a later reply shows it too', () => {
    const browser = browserKey()
    expect(foldedIn([[browser], [], [browser, browser], [browser]])).toEqual([[browser], [], [browser], []])
  })

  it('leaves the latest of each showing, machines and agents alike', () => {
    const atlas = browserKey('atlas')
    const nova = browserKey('nova')
    expect(foldedIn([[atlas, 'umbrel/ubuntu'], [nova], [atlas], ['umbrel/ubuntu']])).toEqual([[atlas, 'umbrel/ubuntu'], [], [], []])
    expect(foldedIn([])).toEqual([])
  })
})

/** The desktop's bars and the browser's own, as state/screen.ts has them. */
const BARS = { top: 115, bottom: 44 }

describe('the picture that’s kept', () => {
  it('is named by Hermes’s own id where that’s safe to file, else by its hash', () => {
    expect(frameId('call_9Xk2')).toBe('call_9Xk2')
    expect(frameId('toolu_01AbC-dEf')).toBe('toolu_01AbC-dEf')
    const odd = frameId('call_1|fc_2/../x')
    expect(odd).toMatch(/^h_[0-9a-f]{16}$/)
    expect(frameId('call_1|fc_2/../x')).toBe(odd)
    expect(frameId('call_1|fc_2/../y')).not.toBe(odd)
    expect(frameId('x'.repeat(65))).toMatch(/^h_[0-9a-f]{16}$/)
  })

  it('is just the page, cut out of the screen and no wider than the card needs', () => {
    // The screen as Hermes makes it, and its still at full size: the desktop's bars and the browser's come off.
    expect(pageCut({ w: 1440, h: 900 }, { w: 1440, h: 900 }, BARS, 1120)).toEqual({ top: 115, height: 741, w: 1120, h: 576 })
    // A still Hermes sent at half size is cut the same, and never blown up.
    expect(pageCut({ w: 720, h: 450 }, { w: 1440, h: 900 }, BARS, 1120)).toEqual({ top: 58, height: 370, w: 720, h: 370 })
  })
})
