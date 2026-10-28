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

// Safari 26 on an iPhone starts with its compact tab bar, where Share sits in
// the ⋯ menu. (Its user agent keeps saying iOS 18; Version/ is Safari's own.)
export const compactSafari =
  typeof navigator !== 'undefined' &&
  /iPhone|iPod/.test(navigator.userAgent) &&
  Number(/Version\/(\d+)/.exec(navigator.userAgent)?.[1]) >= 26
