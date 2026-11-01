import { describe, expect, it } from 'vitest'
import { arrange, type Layout } from './photo-layout'

const phone = { width: 354, height: 348 }
const tall = { width: 354, height: 528 }
const tiny = { width: 284, height: 180 }
const wide = { width: 720, height: 560 }
const mixed = [1.5, 0.714, 1.4, 1, 0.667, 1.5, 1.5, 0.714, 1.5, 0.8]

const overlap = (a: Layout['tiles'][number], b: Layout['tiles'][number]) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('photos on the stage', () => {
  it('shows one photo whole, as large as it fits', () => {
    expect(arrange([1.5], phone)).toEqual({ width: 354, height: 236, tiles: [{ index: 0, x: 0, y: 0, width: 354, height: 236 }] })
    const portrait = arrange([2 / 3], phone)
    expect(portrait.height).toBe(348)
    expect(portrait.width).toBe(232)
  })

  it('keeps a panorama a panorama when it is alone', () => {
    expect(arrange([5], phone).tiles[0]).toMatchObject({ width: 354, height: 71 })
  })

  it('stays inside the room, with nothing overlapping', () => {
    for (const box of [phone, tall, tiny, wide])
      for (const lead of [false, true]) {
        const { width, height, tiles } = arrange(mixed, box, lead)
        expect(width).toBeLessThanOrEqual(box.width)
        expect(height).toBeLessThanOrEqual(box.height)
        for (const a of tiles) {
          expect(a.x + a.width).toBeLessThanOrEqual(width + 1)
          expect(a.y + a.height).toBeLessThanOrEqual(height + 1)
          for (const b of tiles) if (a !== b) expect(overlap(a, b)).toBe(false)
        }
      }
  })

  it('keeps every photo in its own shape, near enough to round to whole pixels', () => {
    for (const box of [phone, tall, wide]) {
      for (const tile of arrange(mixed, box).tiles) {
        const shape = Math.min(2, Math.max(0.62, mixed[tile.index]))
        expect(Math.abs(tile.width / tile.height - shape) / shape).toBeLessThan(0.06)
      }
    }
  })

  it('shows them in order, leaving out only the last ones', () => {
    const { tiles } = arrange(mixed, phone)
    expect(tiles.map((t) => t.index)).toEqual(tiles.map((_, i) => i))
  })

  it('fills most of the room', () => {
    for (const box of [phone, tall, wide]) {
      const { width, height } = arrange(mixed, box)
      expect((width * height) / (box.width * box.height)).toBeGreaterThan(0.7)
    }
  })

  it('shows more as the room grows', () => {
    expect(arrange(mixed, tall).tiles.length).toBeGreaterThan(arrange(mixed, tiny).tiles.length)
  })

  it('never hides just one: its place would go to saying so', () => {
    for (const box of [phone, tall, tiny, wide])
      for (let n = 2; n <= 13; n++) {
        const shapes = Array.from({ length: n }, (_, i) => mixed[i % mixed.length])
        expect(arrange(shapes, box).tiles.length).not.toBe(n - 1)
      }
  })

  it('shows two or three whenever they fit', () => {
    expect(arrange([1.5, 1.5], phone).tiles).toHaveLength(2)
    expect(arrange([0.75, 1.5, 1.5], phone).tiles).toHaveLength(3)
  })

  it('gives the one being talked about the most room', () => {
    for (const box of [phone, tall, wide]) {
      for (const shapes of [mixed, Array<number>(10).fill(1.5), Array<number>(10).fill(0.75)]) {
        const [first, ...rest] = arrange(shapes, box, true).tiles
        for (const other of rest) expect(first.width * first.height).toBeGreaterThan(other.width * other.height)
      }
    }
  })

  it('puts a tall photo beside the rest, not above them', () => {
    const { tiles } = arrange(Array<number>(10).fill(0.75), phone, true)
    expect(tiles[1].x).toBeGreaterThan(tiles[0].x + tiles[0].width - 1)
  })

  it('has nothing to show in no room at all', () => {
    expect(arrange(mixed, { width: 354, height: 0 }).tiles).toEqual([])
    expect(arrange([], phone).tiles).toEqual([])
  })
})
