import { useSyncExternalStore } from 'react'

/**
 * How much of a 100dvh screen the on-screen keyboard covers, in px, measured
 * once for the whole app. While it's up, <html> carries `data-keyboard` and
 * `--keyboard`, and a screen with a composer takes `calc(100dvh -
 * var(--keyboard))` (the `keyboard:` variant), so the composer sits right on
 * the keyboard.
 *
 * What's left above the keyboard is the visual viewport, and 100dvh doesn't
 * move when the keyboard comes up: older iOS lays the keyboard over the page,
 * iOS 26 shrinks the window instead. Either way the browser scrolls the page
 * to keep the field in view, taking the header with it, so while the keyboard
 * is up the page is only as tall as the screen and sits at the top.
 *
 * iOS doesn't always say when the keyboard goes: a hidden page hears nothing
 * (leave the app with the keyboard up), and a Home Screen app can hear about
 * it mid-animation and never again. A keyboard kept on iOS's last word leaves
 * the composer floating halfway up an empty screen. So it's only ever up while
 * you're typing in something, and it's measured again whenever the page comes
 * back, focus moves, or the keyboard has had time to settle.
 */
export function useKeyboardInset() {
  return useSyncExternalStore(subscribe, current, none)
}

let inset = 0
const current = () => inset
const none = () => 0
const listeners = new Set<() => void>()
let unwatch: (() => void) | undefined

function subscribe(listener: () => void) {
  listeners.add(listener)
  unwatch ??= watch()
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    unwatch?.()
    unwatch = undefined
  }
}

// Longer than the keyboard takes to come up or go away.
const SETTLE_MS = 500

function watch() {
  const vv = window.visualViewport
  if (!vv) return () => {}
  const full = document.createElement('div')
  full.style.cssText = 'position:fixed;top:0;height:100dvh;width:0;visibility:hidden;pointer-events:none'
  document.body.append(full)

  const measure = () => {
    const covered = full.offsetHeight - vv.height
    // Smaller gaps are browser chrome settling (or iOS misreporting), and pinch-zoom isn’t a keyboard.
    set(typing() && covered > 150 && vv.scale < 1.01 ? Math.round(covered) : 0)
  }
  let frame = 0
  let settle = 0
  const update = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measure)
    clearTimeout(settle)
    settle = window.setTimeout(measure, SETTLE_MS)
  }

  // Right away: a screen that replaces another with the keyboard up takes its place at once.
  measure()
  update()
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  addEventListener('resize', update)
  addEventListener('pageshow', update)
  document.addEventListener('visibilitychange', update)
  document.addEventListener('focusin', update)
  document.addEventListener('focusout', update)
  // 100dvh itself can settle a beat after the keyboard does.
  const ro = new ResizeObserver(update)
  ro.observe(full)
  return () => {
    cancelAnimationFrame(frame)
    clearTimeout(settle)
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
    removeEventListener('resize', update)
    removeEventListener('pageshow', update)
    document.removeEventListener('visibilitychange', update)
    document.removeEventListener('focusin', update)
    document.removeEventListener('focusout', update)
    ro.disconnect()
    full.remove()
    set(0)
  }
}

function set(next: number) {
  if (next === inset) return
  inset = next
  const root = document.documentElement
  if (next) {
    root.style.setProperty('--keyboard', `${next}px`)
    root.dataset.keyboard = ''
    // The page gets no taller than what's left, so there's nothing to scroll away to.
    window.scrollTo(0, 0)
  } else {
    root.style.removeProperty('--keyboard')
    delete root.dataset.keyboard
  }
  listeners.forEach((listener) => listener())
}

// Fields that don't bring up a keyboard to type in.
const KEYLESS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])

/** Whether something you type into has focus: the only time the keyboard can be up. */
function typing() {
  let el = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  if (el instanceof HTMLTextAreaElement) return !el.readOnly
  if (el instanceof HTMLInputElement) return !el.readOnly && !KEYLESS.has(el.type)
  // A page inside this one (a preview, an agent's browser) keeps its own focus.
  return el instanceof HTMLIFrameElement || (el instanceof HTMLElement && el.isContentEditable)
}
