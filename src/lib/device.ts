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
