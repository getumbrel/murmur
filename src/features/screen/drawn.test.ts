import { describe, expect, it, vi } from 'vitest'
import type { Glance, Seen } from './drawn'

vi.mock('@/state/screen', () => ({ PAGE: { top: 115, bottom: 44 } }))
const { blank, differs, look, opening } = await import('./drawn')

// Stills at a glance (16×10 greys), as glance() makes them from the screen's pictures.
const fill = (v: number): Glance => new Uint8ClampedArray(160).fill(v)
const page = (seed: number): Glance =>
  Uint8ClampedArray.from({ length: 160 }, (_, i) => ((i * 37 + seed * 101) % 200) + 30)
const black = fill(0)
const loading = fill(255)
const desktop = Uint8ClampedArray.from({ length: 160 }, (_, i) => 18 + (i % 16) * 2) // Hermes's dark gradient
const backdrop = fill(31) // the desktop's own colour, before its wallpaper is drawn
const shop = page(1)
const gear = page(2)

function seen(...stills: Glance[]) {
  let now: Seen = {}
  for (const still of stills) {
    const { drawn, ...next } = look(now, still)
    if (drawn) return true
    now = next
  }
  return false
}

describe('when the browser has drawn, for a turn that just started browsing', () => {
  it('waits while the screen still shows the page from before', () => {
    expect(seen(shop, shop, shop)).toBe(false)
  })

  it('shows it once the new page is drawn, not while it loads', () => {
    expect(seen(shop, loading, loading)).toBe(false)
    expect(seen(shop, loading, gear)).toBe(true)
  })

  it('waits through a screen starting up, from black to its desktop, until the browser opens', () => {
    expect(seen(black, desktop, desktop, loading)).toBe(false)
    expect(seen(black, desktop, desktop, loading, shop)).toBe(true)
  })

  // A screen started for this browsing, as Hermes's stills show it: black, its backdrop's colour, maybe
  // its wallpaper, then the browser's new tab (white) and the page. There's no page from before.
  it('shows the first page on a screen that has only just started, once the browser has opened it', () => {
    expect(seen(black, backdrop, loading, shop)).toBe(true)
    expect(seen(backdrop, loading, shop)).toBe(true)
    expect(seen(backdrop, desktop, loading, shop)).toBe(true)
    expect(seen(backdrop, desktop, shop)).toBe(true)
  })

  it('never shows the desktop of a screen starting up as the page', () => {
    expect(seen(black, backdrop, desktop, desktop)).toBe(false)
    expect(seen(backdrop, desktop, loading, loading)).toBe(false)
  })

  it('shows a page reloaded where it was, once it’s back', () => {
    expect(seen(shop, loading, shop)).toBe(true)
  })

  it('can’t tell a page drawn straight onto a dark screen from one that was there: it waits for the step', () => {
    expect(seen(backdrop, shop, shop)).toBe(false)
  })

  it('isn’t fooled by a caret blinking', () => {
    const caret = Uint8ClampedArray.from(shop)
    caret[42] = 0
    expect(differs(shop, caret)).toBe(false)
    expect(seen(shop, caret)).toBe(false)
  })

  it('tells nothing from a page', () => {
    expect(blank(black)).toBe(true)
    expect(blank(loading)).toBe(true)
    expect(blank(desktop)).toBe(false)
    expect(blank(shop)).toBe(false)
  })

  it('tells the browser opening a page from a screen starting up', () => {
    expect(opening(loading)).toBe(true)
    expect(opening(black)).toBe(false)
    expect(opening(backdrop)).toBe(false)
    expect(opening(desktop)).toBe(false)
    expect(opening(shop)).toBe(false)
  })
})
