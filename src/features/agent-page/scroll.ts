import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { arrivedBy } from '@/lib/transitions'

// Pages that scroll inside themselves (an agent's page, All agents): going
// back to one finds it where you left it, as does the edge swipe that peeks
// at it; a fresh visit starts at the top. Also says when anything has gone
// under the bar (it frosts), and when the large title has (the bar takes the
// title). Both are measured against the bar itself, so the status bar inset
// of a home-screen iPhone app counts.

const memory = new Map<string, number>()

export function usePageScroll<T extends HTMLElement>(key: string) {
  const page = useRef<HTMLDivElement>(null)
  const title = useRef<T>(null)
  const [scrolled, setScrolled] = useState(false)
  const [under, setUnder] = useState(false)

  const measure = useCallback(() => {
    const el = page.current
    const heading = title.current
    if (!el) return
    setScrolled(el.scrollTop > 0)
    if (!heading) return
    const bar = el.querySelector(':scope > header')
    const edge = bar ? bar.getBoundingClientRect().bottom : el.getBoundingClientRect().top
    setUnder(heading.getBoundingClientRect().bottom <= edge + 0.5)
  }, [])

  useLayoutEffect(() => {
    const el = page.current
    if (!el) return
    // Beneath a page being swiped away, or arriving by Back: as it was.
    if (arrivedBy() === 'pop' || el.closest('[inert]')) el.scrollTop = memory.get(key) ?? 0
    else memory.delete(key)
    measure()
  }, [key, measure])

  // Rotating a phone or resizing a window moves the title without a scroll.
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const onScroll = (e: React.UIEvent<HTMLElement>) => {
    if (!e.currentTarget.closest('[inert]')) memory.set(key, e.currentTarget.scrollTop)
    measure()
  }
  return { page, title, scrolled, under, onScroll }
}
