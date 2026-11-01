// When a turn starts browsing, the agent's screen still shows what it had: the
// page from before, or on a screen that has only just started, its desktop. Under
// the new site's name that reads as the wrong page, so the card waits until the
// browser draws something new, from the screen's own stills.

import { useCallback, useEffect, useRef, useState } from 'react'
import { PAGE } from '@/state/screen'

type Size = { w: number; h: number }

/** A still at a glance: its page as 16×10 greys, enough to tell one page from another, or a page from nothing. */
export type Glance = Uint8ClampedArray

const W = 16
const H = 10

export async function glance(src: string, size: Size): Promise<Glance> {
  const img = new Image()
  img.src = src
  await img.decode()
  const k = img.naturalWidth / size.w
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('No canvas')
  ctx.drawImage(img, 0, PAGE.top * k, img.naturalWidth, img.naturalHeight - (PAGE.top + PAGE.bottom) * k, 0, 0, W, H)
  const { data } = ctx.getImageData(0, 0, W, H)
  return Uint8ClampedArray.from(
    { length: W * H },
    (_, i) => 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2],
  )
}

/** One colour all over: a page still loading, or a screen still starting. */
export function blank(g: Glance) {
  const mean = g.reduce((a, v) => a + v, 0) / g.length
  return Math.sqrt(g.reduce((a, v) => a + (v - mean) ** 2, 0) / g.length) < 3
}

/** Another page, or the same one moved: more than a caret's blink. */
export function differs(a: Glance, b: Glance) {
  return a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length > 6
}

/**
 * The next still, against the first real one the card saw: the browser has
 * drawn once it shows something else. Blank stills never count either way.
 */
export function look(first: Glance | undefined, next: Glance): { first?: Glance; drawn: boolean } {
  if (blank(next)) return { first, drawn: false }
  if (!first) return { first: next, drawn: false }
  return { first, drawn: differs(first, next) }
}

/** The agent's first step in its browser this turn (`key` names the turn), and whether it's done. */
export type BrowserStep = { key: string; done: boolean }

/**
 * How long a card waits once that step is done, for a still taken since (they
 * come every 1.5 s); and at most, should the step never say it's done.
 */
const SETTLE = 3000
const CAP = 30_000

/** The turns whose browser has drawn: a card shown again for the same turn doesn't wait twice. */
const drawnFor = new Set<string>()

/**
 * Whether the card for a turn's browsing can show the agent's browser: once
 * it has drawn something new, or once the agent's first step in it is done and
 * a fresh still is in, since an agent carrying on with the page it had draws
 * nothing new. However long the step takes (a page that's slow to load, a
 * wait), the card waits with it: until it's done, the agent's page may not be
 * the one in front. No step, no wait.
 */
export function useDrawn(profile: string, still: string | null, size: Size, step?: BrowserStep) {
  const key = step && `${profile} ${step.key}`
  const [drawn, setDrawn] = useState(() => !key || drawnFor.has(key))
  const first = useRef<Glance>(undefined)
  const done = useCallback(() => {
    if (key) drawnFor.add(key)
    setDrawn(true)
  }, [key])

  const stepped = !!step?.done
  useEffect(() => {
    if (drawn) return
    const timer = setTimeout(done, stepped ? SETTLE : CAP)
    return () => clearTimeout(timer)
  }, [drawn, stepped, done])

  const { w, h } = size
  useEffect(() => {
    if (drawn || !still) return
    let alive = true
    glance(still, { w, h }).then((g) => {
      if (!alive) return
      const seen = look(first.current, g)
      first.current = seen.first
      if (seen.drawn) done()
    }, done)
    return () => {
      alive = false
    }
  }, [still, drawn, w, h, done])

  return drawn
}
