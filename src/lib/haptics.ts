// A light tap you can feel, on Android only: iOS Safari has no vibration API
// and desktops have nothing to buzz. Use it for moments that land (send, Allow,
// creating an agent), never for streaming or scrolling.

type Haptic = 'tick' | 'success' | 'warning'

const patterns: Record<Haptic, number | number[]> = {
  tick: 10,
  success: [8, 70, 12],
  warning: [14, 90, 14],
}

const android = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

export function haptic(kind: Haptic = 'tick') {
  // Browsers refuse (and log) vibration outside a user gesture.
  if (!android || !navigator.userActivation?.isActive) return
  navigator.vibrate?.(patterns[kind])
}
