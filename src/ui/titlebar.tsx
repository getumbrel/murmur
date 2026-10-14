import type { CSSProperties } from 'react'

// The desktop app's window chrome, from the web side (styles.css, "Desktop
// window chrome"). Both render nothing visible, and nothing at all in a browser.

/** The band across the top of the window that drags it. Mount once, first in the page. */
export function TitlebarStrip() {
  return <div aria-hidden className="titlebar-strip" />
}

/**
 * Room in a top bar for the window's own controls: `start` for the traffic
 * lights on a Mac, `end` for the caption buttons on Windows and Linux. Put it
 * first (start) or last (end) in the bar's row. `column` is the width of a
 * centred column the row sits in (give the full-width bar `@container`), so
 * the room shrinks by the margin the column already leaves; `flexGap` is the
 * row's gap in px, which a closed gap takes back.
 */
export function WindowControlsGap({ side, column, flexGap }: { side: 'start' | 'end'; column?: number; flexGap?: number }) {
  return (
    <span
      aria-hidden
      data-window-gap={side}
      style={
        {
          '--gap-column': column ? `${column}px` : undefined,
          '--gap-flex': flexGap ? `${flexGap}px` : undefined,
        } as CSSProperties
      }
    />
  )
}
