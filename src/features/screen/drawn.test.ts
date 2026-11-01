import { describe, expect, it, vi } from 'vitest'
import type { Glance } from './drawn'

vi.mock('@/state/screen', () => ({ PAGE: { top: 115, bottom: 44 } }))
const { blank, differs, look } = await import('./drawn')

// Stills at a glance (16×10 greys), as glance() makes them from the screen's pictures.
const fill = (v: number): Glance => new Uint8ClampedArray(160).fill(v)
const page = (seed: number): Glance =>
  Uint8ClampedArray.from({ length: 160 }, (_, i) => ((i * 37 + seed * 101) % 200) + 30)
const black = fill(0)
const loading = fill(255)
const desktop = Uint8ClampedArray.from({ length: 160 }, (_, i) => 18 + (i % 16) * 2) // Hermes's dark gradient
const shop = page(1)
const gear = page(2)

function seen(...stills: Glance[]) {
  let first: Glance | undefined
  for (const still of stills) {
    const next = look(first, still)
    if (next.drawn) return true
    first = next.first
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
})
