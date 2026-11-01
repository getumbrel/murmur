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

describe('a link to Safari', () => {
  it('is the same address, for iOS to hand over', async () => {
    const { safariLink } = await on(SAFARI_26)
    expect(safariLink('https://umbrel.local/settings/mcp')).toBe('x-safari-https://umbrel.local/settings/mcp')
    expect(safariLink('http://192.168.1.20/settings/mcp')).toBe('x-safari-https://192.168.1.20/settings/mcp')
  })
})

describe('a link out of Murmur', () => {
  const page = { href: 'https://umbrel.local:8484/chat/main', hostname: 'umbrel.local' }
  const newTab = (href: string) => ({ href, target: '_blank', rel: 'noopener noreferrer' })
  const from = async (ua: string, url: string) => (await on(ua)).linkOut(url, ua === UMBREL_APP, page)

  it('leaves the iPhone app for Safari when it goes to umbrelOS, by a link in the same window', async () => {
    for (const path of ['/photos?q=Luke', '/files/Home/Documents', '/app-store/immich', '/settings/mcp']) {
      expect(await from(UMBREL_APP, `https://umbrel.local${path}`)).toEqual({ href: `x-safari-https://umbrel.local${path}` })
    }
    expect(await from(UMBREL_APP, 'http://umbrel.local/photos')).toEqual({ href: 'x-safari-https://umbrel.local/photos' })
  })

  it('stays a new tab for what the app shows by itself', async () => {
    for (const url of [
      'https://umbrel.local:2283/', // An app on the Umbrel, which it opens in place.
      'https://100.64.0.2/photos', // Another Umbrel, in Safari's sheet.
      'https://huggingface.co/kyutai/pocket-tts',
      'https://auth.openai.com/codex/device',
      'mailto:hello@umbrel.com',
    ])
      expect(await from(UMBREL_APP, url)).toEqual(newTab(url))
  })

  it('is always a new tab everywhere else', async () => {
    expect(await from(SAFARI_26, 'https://umbrel.local/photos')).toEqual(newTab('https://umbrel.local/photos'))
    expect(await from(CHROME, 'https://umbrel.local/photos')).toEqual(newTab('https://umbrel.local/photos'))
  })
})
