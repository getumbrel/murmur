// Photos on a call's stage, each in its own shape. They go in rows, or a tall
// one beside a column of the rest, that fill the room there is, so nothing gets
// cropped into a strip. The room decides how many show; the rest wait behind a
// "+N" on the last one.

export type Box = { width: number; height: number }
export type Tile = Box & { index: number; x: number; y: number }
export type Layout = Box & { tiles: Tile[] }

const GAP = 3
/** Roomy enough to see what's in a photo at a glance, in square pixels. */
const COMFORTABLE = 24_000
/** Its shorter side; below this a photo is only a thumbnail. */
const SMALLEST = 64
const MOST = 12
const ACROSS = 4

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)

/** Rows across the whole width, each as tall as its photos need. */
function inRows(shapes: number[], counts: number[], width: number): Layout {
  const tiles: Tile[] = []
  let y = 0
  let index = 0
  for (const count of counts) {
    const row = shapes.slice(index, index + count)
    const height = (width - GAP * (count - 1)) / sum(row)
    let x = 0
    for (const shape of row) {
      tiles.push({ index: index++, x, y, width: shape * height, height })
      x += shape * height + GAP
    }
    y += height + GAP
  }
  return { width, height: y - GAP, tiles }
}

/** The first one tall on the left, the rest in a column that comes out just as tall. */
function beside([first, ...rest]: number[], width: number): Layout {
  const stacked = sum(rest.map((shape) => 1 / shape))
  const gaps = GAP * (rest.length - 1)
  const height = ((width - GAP) * stacked + gaps) / (1 + first * stacked)
  const left = height * first
  const column = width - GAP - left
  const tiles: Tile[] = [{ index: 0, x: 0, y: 0, width: left, height }]
  let y = 0
  rest.forEach((shape, i) => {
    tiles.push({ index: i + 1, x: left + GAP, y, width: column, height: column / shape })
    y += column / shape + GAP
  })
  return { width, height, tiles }
}

/** Every way to split `n` photos into rows. */
function* splits(n: number): Generator<number[]> {
  if (n === 0) yield []
  for (let first = 1; first <= Math.min(n, ACROSS); first++) for (const rest of splits(n - first)) yield [first, ...rest]
}

function scaled(layout: Layout, box: Box): Layout {
  const s = Math.min(1, box.height / layout.height)
  const round = (n: number) => Math.round(n * s)
  return {
    width: round(layout.width),
    height: round(layout.height),
    // Rounded by their edges, so neighbours keep the same gap.
    tiles: layout.tiles.map((t) => ({
      index: t.index,
      x: round(t.x),
      y: round(t.y),
      width: round(t.x + t.width) - round(t.x),
      height: round(t.y + t.height) - round(t.y),
    })),
  }
}

/**
 * Fills the room, with about as many photos as are comfortable in it (too few
 * is worse than too many), and none a giant beside the rest unless it leads.
 */
function worth(layout: Layout, box: Box, photos: number, lead: boolean) {
  const room = box.width * box.height
  const filled = (layout.width * layout.height) / room
  const comfortable = Math.min(photos, Math.max(2, room / COMFORTABLE))
  const off = (layout.tiles.length - comfortable) / comfortable
  const areas = layout.tiles.slice(lead ? 1 : 0).map((t) => t.width * t.height)
  const uneven = areas.length ? Math.log2(Math.max(...areas) / Math.min(...areas)) : 0
  return filled - (off < 0 ? -off : off / 2) - uneven * 0.07
}

const seen = (t: Tile) => Math.min(t.width, t.height) >= SMALLEST

/**
 * Where the photos go. `shapes` are width over height, in order; with `lead`,
 * the first one is the one being talked about and gets a place of its own.
 */
export function arrange(shapes: number[], box: Box, lead = false): Layout {
  if (!shapes.length || box.width <= 0 || box.height <= 0) return { width: 0, height: 0, tiles: [] }
  if (shapes.length === 1) return fitted(shapes[0], box)
  // A panorama or a screenshot gives a little at the edges to sit among the rest.
  const even = shapes.map((shape) => Math.min(2, Math.max(0.62, shape)))
  let best = fitted(shapes[0], box)
  let top = worth(best, box, shapes.length, lead)
  for (let count = 2; count <= Math.min(shapes.length, MOST); count++) {
    // "+1" takes the place of what it hides.
    if (count === shapes.length - 1) continue
    const some = even.slice(0, count)
    const options: Layout[] = some[0] < 1 ? [beside(some, box.width)] : []
    for (const counts of splits(count)) if (!lead || counts[0] === 1) options.push(inRows(some, counts, box.width))
    for (const option of options) {
      const layout = scaled(option, box)
      if (!layout.tiles.every(seen)) continue
      const value = worth(layout, box, shapes.length, lead)
      if (value > top) {
        top = value
        best = layout
      }
    }
  }
  return best
}

/** One photo, whole, as large as it fits. */
function fitted(shape: number, box: Box): Layout {
  const width = Math.round(Math.min(box.width, box.height * shape))
  const height = Math.round(width / shape)
  return { width, height, tiles: [{ index: 0, x: 0, y: 0, width, height }] }
}
