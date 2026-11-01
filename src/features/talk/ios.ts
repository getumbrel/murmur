// On an iPhone or iPad, any AudioContext running beside a mic with echo cancelling makes speech
// crackle, whatever it's doing and wherever the speech comes out. (Mic off, or echo cancelling off,
// or no AudioContext at all, and it's clean. Longer buffers and matching rates don't help.) Calls
// need echo cancelling, so on iOS they have to manage without Web Audio.

/** iPadOS calls itself a Mac: touch gives it away. */
export const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
