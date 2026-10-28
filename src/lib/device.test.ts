import { afterEach, describe, expect, it, vi } from 'vitest'

// iPhone browsers as they introduce themselves. Safari 26 still says iOS 18.
const SAFARI_26 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const SAFARI_18 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
const CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1'
// The umbrelOS app's browser poses as Safari, then names itself (its BrowserContext.makeWebView).
const UMBREL_APP = `${SAFARI_26} UmbrelApp/1.4.0`

async function on(userAgent: string) {
  vi.resetModules()
  vi.stubGlobal('navigator', { userAgent, platform: 'iPhone', maxTouchPoints: 5 })
  return import('./device')
}

afterEach(() => vi.unstubAllGlobals())

describe('the umbrelOS app', () => {
  it('is told apart by the name its browser adds', async () => {
    expect((await on(UMBREL_APP)).umbrelApp).toBe(true)
  })

  it('is not Safari, or another browser on an iPhone', async () => {
    for (const agent of [SAFARI_26, SAFARI_18, CHROME]) expect((await on(agent)).umbrelApp).toBe(false)
  })
})

describe('Safari’s compact tab bar, with Share in the ⋯ menu', () => {
  it('comes with Safari 26', async () => {
    expect((await on(SAFARI_26)).compactSafari).toBe(true)
  })

  it('isn’t in Safari 18 or Chrome, which show Share in their toolbars', async () => {
    expect((await on(SAFARI_18)).compactSafari).toBe(false)
    expect((await on(CHROME)).compactSafari).toBe(false)
  })
})
