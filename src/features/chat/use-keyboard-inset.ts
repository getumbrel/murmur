import { useEffect, useLayoutEffect, useState } from 'react'

/**
 * How much of a 100dvh screen the on-screen keyboard covers, in px. Screens
 * take `calc(100dvh - inset)` so the composer sits right on the keyboard.
 *
 * What's left above the keyboard is the visual viewport, and 100dvh doesn't
 * move when the keyboard comes up: older iOS lays the keyboard over the page,
 * iOS 26 shrinks the window instead. Either way the browser scrolls the page
 * to keep the field in view, taking the header with it, so while the keyboard
 * is up the page is only as tall as the screen and sits at the top.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const full = document.createElement('div')
    full.style.cssText = 'position:fixed;top:0;height:100dvh;width:0;visibility:hidden;pointer-events:none'
    document.body.append(full)
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const covered = full.offsetHeight - vv.height
        // Smaller gaps are browser chrome settling (or iOS misreporting), and pinch-zoom isn’t a keyboard.
        setInset(covered > 150 && vv.scale < 1.01 ? Math.round(covered) : 0)
      })
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    // 100dvh itself can settle a beat after the keyboard does.
    const ro = new ResizeObserver(update)
    ro.observe(full)
    return () => {
      cancelAnimationFrame(frame)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      ro.disconnect()
      full.remove()
    }
  }, [])
  useLayoutEffect(() => {
    if (!inset) return
    // The page gets no taller than what's left, so there's nothing to scroll away to.
    const root = document.documentElement
    root.style.setProperty('--keyboard', `${inset}px`)
    window.scrollTo(0, 0)
    return () => void root.style.removeProperty('--keyboard')
  }, [inset])
  return inset
}
