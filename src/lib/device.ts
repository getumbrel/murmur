// The little Murmur needs to know about the device it's on: iPhones and iPads
// (an iPad asks for the desktop site, so it says it's a Mac with a touch
// screen), and whether Murmur was opened from the Home Screen.

export const ios =
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

export const standalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  (navigator as { standalone?: boolean }).standalone === true

// The umbrelOS iPhone app opens Murmur in a browser of its own, which signs its
// user agent "UmbrelApp/<version>" (umbrelOS tells the app apart the same way).
// It has no Share button, so Murmur can't be put on the Home Screen from there.
export const umbrelApp = ios && /\bUmbrelApp\//.test(navigator.userAgent)

/** An address as a link iOS opens in Safari, the one way out of another app's browser. */
export const safariLink = (url: string) => url.replace(/^https?:/, 'x-safari-https:')

/**
 * Where a link out of Murmur goes: a new tab, which the iPhone app shows in place or in Safari's
 * sheet, and that's right for an app on the Umbrel or any other site. umbrelOS itself is the
 * exception (openUmbrelPage says why): the app only changes it behind Murmur's page, so there it's
 * Safari, by a link tapped in the same window. umbrelOS is the address Murmur's on, with no port.
 */
export function linkOut(url: string, app = umbrelApp, page: Pick<Location, 'href' | 'hostname'> = location) {
  const to = URL.canParse(url, page.href) ? new URL(url, page.href) : undefined
  const umbrelOS = to && /^https?:$/.test(to.protocol) && to.hostname === page.hostname && !to.port
  return app && umbrelOS ? { href: safariLink(to.href) } : { href: url, target: '_blank', rel: 'noopener noreferrer' }
}

// Safari 26 on an iPhone starts with its compact tab bar, where Share sits in
// the ⋯ menu. (Its user agent keeps saying iOS 18; Version/ is Safari's own.)
export const compactSafari =
  typeof navigator !== 'undefined' &&
  /iPhone|iPod/.test(navigator.userAgent) &&
  Number(/Version\/(\d+)/.exec(navigator.userAgent)?.[1]) >= 26
