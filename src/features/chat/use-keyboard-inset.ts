import { useEffect, useState } from 'react'

/**
 * How far the on-screen keyboard covers the layout viewport, in px. iOS
 * Safari overlays the keyboard instead of resizing the page, so layouts lift
 * the composer by this much to keep it visible.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const covered = window.innerHeight - vv.height - vv.offsetTop
        // Small differences are browser chrome settling, not a keyboard.
        setInset(covered > 80 ? Math.round(covered) : 0)
      })
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(frame)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}
