// A murmuration on a 2D canvas that lands as the Murmur mark. Each bird
// chases a point on a rippling sheet that turns slowly in 3D, so the flock
// thins to a line edge-on and blooms when it faces you, the way starlings do.
// Then each wing spirals down into its own buddy: every bird takes a seat
// inside the buddy's silhouette (read straight off the real mark, so the two
// can never drift apart), the dotted buddies swell until the dots run
// together into the two buddies themselves (each one drawn by the mark, lit
// and asleep), they lean in and bump shoulders into the "m", and the live mark
// takes over mid-wobble: the seam where they touch melts, their shadow lands,
// and they open their eyes. Springs everywhere, so nothing simply appears.
//
// Everything runs off one clock in one rAF loop: the canvas, and the mark's
// transform and opacity (composited, no React renders). docs/MOTION.md has
// the timeline.

export type MurmurStage = 'awake' | 'text'

type Options = {
  /** The real mark's wrapper. It's faded and squashed from here; its layout box (offsets, not transforms) is where the flock lands. */
  mark: HTMLElement
  /** Fades in as the flock condenses. */
  glow?: HTMLElement | null
  onStage: (stage: MurmurStage) => void
}

const TAU = Math.PI * 2

// Seconds, on the loop's own clock (it pauses with the tab).
const FADE_IN = 0.45
const CONVERGE = 0.74 // birds start heading for their seats…
const BIRD_DUR = 0.58 // …each taking this long…
const STAGGER = 0.24 // …the last setting off this much later.
const SWELL = [1.48, 1.78] // the dots grow until they run together…
const SWELL_LAG = 0.12 // …the middle first, the edges this much later
const INFLATE = 1.46 // the bodies plump up from INFLATE_FROM to full size
const SNAP = [1.66, 1.9] // they lean in and meet; contact at the end
const REVEAL = [1.92, 2.08] // the real mark (light, volume, closed eyes) takes over
const EYES_AT = 2.16
const TEXT_AT = 2.26
const END = 2.7

/** How far apart the two buddies form, each side, as a share of the mark's height. */
const GAP = 0.105
const INFLATE_FROM = 0.86

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const smooth = (v: number, lo: number, hi: number) => {
  const x = clamp((v - lo) / (hi - lo), 0, 1)
  return x * x * (3 - 2 * x)
}
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3
/** A spring's step response, 0 → 1, `t` seconds in. */
const spring = (t: number, omega: number, zeta: number) => {
  if (t <= 0) return 0
  const wd = omega * Math.sqrt(1 - zeta * zeta)
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t))
}
/** A struck spring: 0, out to about ±1, back to 0. */
const ring = (t: number, omega: number, zeta: number) => {
  if (t <= 0) return 0
  const wd = omega * Math.sqrt(1 - zeta * zeta)
  return Math.exp(-zeta * omega * t) * Math.sin(wd * t)
}

type RGB = [number, number, number]
const hex = (s: string): RGB => {
  const n = parseInt(s.replace('#', '').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`

type Pt = [number, number]
/** A 2D affine matrix, [a b c d e f] as in DOMMatrix. */
type Mat = [number, number, number, number, number, number]
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
const apply = (m: Mat, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

type Stop = { at: number; color: RGB }
type Body = {
  path: Path2D
  /** The body's own gradient, in mark units, so the dots are lit the way the mark is. */
  from: Pt
  to: Pt
  stops: Stop[]
  /** Its flat colour in flight: the middle of its gradient. */
  flight: RGB
  /** Feet, centre: where it squashes from. */
  foot: Pt
  side: -1 | 1
  seats: { x: number; y: number; color: RGB }[]
  spacing: number
  /** This buddy alone, drawn by the mark itself (light, volume, eyes shut), once it's ready. */
  image: { bitmap: HTMLCanvasElement | null }
}

/**
 * One buddy on its own, rendered by the real mark: the other buddy, the seam
 * where they touch and the floor shadow taken out, eyes shut. The swelling
 * dots reveal this, so the buddy the flock makes is already the real one,
 * lit and shaded, and the hand-over to the live mark is only the seam
 * melting as they touch (and the shadow, as they land).
 */
function portrait(svg: SVGSVGElement, side: 0 | 1, scale: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const vb = svg.viewBox.baseVal
  clone.setAttribute('width', String(Math.ceil(vb.width * scale)))
  clone.setAttribute('height', String(Math.ceil(vb.height * scale)))
  clone.removeAttribute('style')
  clone.querySelectorAll('g[filter] > path')[1 - side]?.remove()
  clone.querySelectorAll('rect[mask], ellipse[fill*="sh)"]').forEach((el) => el.remove())
  const eyes = clone.querySelectorAll('.mm-eyes')
  eyes[1 - side]?.remove()
  const live = svg.querySelectorAll<SVGGElement>('.mm-eyes')[side]
  if (live && eyes[side]) {
    // Shut, around the same point the blink squeezes to (brand.css).
    const bb = live.getBBox()
    const y = bb.y + bb.height * 0.55
    eyes[side].setAttribute('transform', `translate(0 ${y}) scale(1 0.1) translate(0 ${-y})`)
  }
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
  // Painted once into a bitmap: drawn straight from the SVG, the browser
  // would run its filter again every frame the scale changes.
  const out: { bitmap: HTMLCanvasElement | null } = { bitmap: null }
  img
    .decode()
    .then(() => {
      const c = document.createElement('canvas')
      c.width = Math.ceil(vb.width * scale)
      c.height = Math.ceil(vb.height * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      out.bitmap = c
    })
    .catch(() => {})
  return out
}

/** Where on a gradient (0–1) a point falls, and the colour there. */
function shade(b: Pick<Body, 'from' | 'to' | 'stops'>, x: number, y: number): RGB {
  const [dx, dy] = [b.to[0] - b.from[0], b.to[1] - b.from[1]]
  const k = clamp(((x - b.from[0]) * dx + (y - b.from[1]) * dy) / (dx * dx + dy * dy), 0, 1)
  const s = b.stops
  for (let i = 1; i < s.length; i++) {
    if (k <= s[i].at) return mix(s[i - 1].color, s[i].color, (k - s[i - 1].at) / (s[i].at - s[i - 1].at || 1))
  }
  return s[s.length - 1].color
}

/** '0.3' or '30%' → 0.3. */
const frac = (v: string | null | undefined, d: number) => (v == null ? d : v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v))

/** Read the two buddies off the rendered mark: outline, gradient, and seats for the birds. */
function readBodies(svg: SVGSVGElement, ctx: CanvasRenderingContext2D, perBody: number, scale: number): Body[] {
  // The mark draws its two bodies, left then right, inside its volume filter.
  const paths = [...svg.querySelectorAll<SVGPathElement>('g[filter] > path')]
  return paths.slice(0, 2).map((el, i) => {
    const path = new Path2D(el.getAttribute('d')!)
    const box = el.getBBox()
    const grad = svg.querySelector(`#${CSS.escape(/#([^)]+)/.exec(el.getAttribute('fill') ?? '')?.[1] ?? '')}`)
    const num = (a: string, d: number) => frac(grad?.getAttribute(a), d)
    const stops: Stop[] = [...(grad?.querySelectorAll('stop') ?? [])].map((s) => ({
      at: frac(s.getAttribute('offset'), 0),
      color: hex(s.getAttribute('stop-color') ?? '#888'),
    }))
    if (!stops.length) stops.push({ at: 0, color: hex('#888') }, { at: 1, color: hex('#888') })
    const from: Pt = [box.x + num('x1', 0) * box.width, box.y + num('y1', 0) * box.height]
    const to: Pt = [box.x + num('x2', 1) * box.width, box.y + num('y2', 0) * box.height]
    const lit = { from, to, stops }

    // Seats: a jittered hex grid inside the silhouette, plus a ring along its
    // edge so the dotted buddy already reads as a buddy. Sized so there's
    // about one bird per seat.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    let area = 0
    for (let y = box.y; y < box.y + box.height; y += 2)
      for (let x = box.x; x < box.x + box.width; x += 2) if (ctx.isPointInPath(path, x + 1, y + 1)) area += 4
    const len = el.getTotalLength()
    // Seats at spacing d: area / (0.866 d²) inside plus len / (1.1 d) on the
    // edge should come to about perBody. Solve for 1/d.
    const qa = area / 0.866
    const qb = len / 1.1
    const d = (2 * qa) / (-qb + Math.sqrt(qb * qb + 4 * qa * perBody))
    const seats: Body['seats'] = []
    const edge = Math.round(len / (d * 1.1))
    for (let n = 0; n < edge; n++) {
      const p = el.getPointAtLength((n / edge) * len)
      seats.push({ x: p.x, y: p.y, color: shade(lit, p.x, p.y) })
    }
    for (let row = 0, y = box.y + d * 0.6; y < box.y + box.height; y += d * 0.866, row++) {
      for (let x = box.x + (row % 2 ? d / 2 : 0) + d * 0.4; x < box.x + box.width; x += d) {
        const jx = x + (Math.random() - 0.5) * d * 0.3
        const jy = y + (Math.random() - 0.5) * d * 0.3
        if (ctx.isPointInPath(path, jx, jy)) seats.push({ x: jx, y: jy, color: shade(lit, jx, jy) })
      }
    }
    const side = i ? 1 : -1
    return {
      path,
      ...lit,
      flight: shade(lit, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2),
      foot: [box.x + box.width / 2, box.y + box.height],
      side,
      seats,
      spacing: d,
      image: portrait(svg, i ? 1 : 0, scale),
    }
  })
}

export function startMurmuration(canvas: HTMLCanvasElement, { mark, glow, onStage }: Options) {
  const ctx = canvas.getContext('2d')!
  const svg = mark.querySelector('svg')!
  let w = 0
  let h = 0
  let dpr = 1

  const resize = () => {
    const r = canvas.getBoundingClientRect()
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    w = r.width
    h = r.height
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  const count = Math.round(clamp((w * h) / 1300, 200, 300))
  const vb = svg.viewBox.baseVal
  // Rendered with room to spare for the stretch, at the screen's density.
  const bodies = readBodies(svg, ctx, count / 2, (mark.offsetHeight / vb.height) * dpr * 1.25)
  // Not the two-buddy mark we know how to make: just show it.
  if (bodies.length < 2) {
    ro.disconnect()
    onStage('text')
    return { skip: () => {}, stop: () => {} }
  }

  // Where the mark sits on the canvas (mark units → CSS px), from layout
  // offsets, so our own transform on it never feeds back.
  const place = () => {
    let x = -canvas.offsetLeft
    let y = -canvas.offsetTop
    for (let el: HTMLElement | null = mark; el && el !== canvas.offsetParent; el = el.offsetParent as HTMLElement | null) {
      x += el.offsetLeft
      y += el.offsetTop
    }
    const s = mark.offsetHeight / vb.height
    return { x: x - vb.x * s, y: y - vb.y * s, s }
  }
  /** The middle of the two buddies' feet, in mark units: where the pair (and the real mark) squash from. */
  const feet: Pt = [(bodies[0].foot[0] + bodies[1].foot[0]) / 2, Math.max(bodies[0].foot[1], bodies[1].foot[1])]
  mark.style.transformOrigin = `${(((feet[0] - vb.x) / vb.width) * 100).toFixed(2)}% ${(((feet[1] - vb.y) / vb.height) * 100).toFixed(2)}%`

  // Gaussian-ish, so the flock has a dense core and wispy edges.
  const g = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5
  const birds = Array.from({ length: count }, () => {
    const u = Math.random() * 2 - 1
    // The left of the sheet goes to the left buddy.
    const home = u < 0 ? 0 : 1
    return {
      u,
      home,
      v: g(),
      w: g(),
      ph: Math.random() * TAU,
      x: Math.random() * w,
      y: Math.random() * h,
      vx: 0,
      vy: 0,
      r: 0.7 + Math.random() * 0.9,
      seat: 0,
      // The leading edge of each wing (nearest the middle) pours in first.
      delay: (1 - Math.abs(u)) * STAGGER * 0.55 + Math.random() * STAGGER * 0.45,
      lag: 0,
      // Each wing curls in on its own side, mirrored.
      spin: (home ? 1 : -1) * (1.3 + Math.random() * 0.9),
    }
  })
  // Hand out the seats: every seat gets a bird first, so no buddy has holes.
  for (const [i, body] of bodies.entries()) {
    const mine = birds.filter((b) => b.home === i).sort(() => Math.random() - 0.5)
    const order = body.seats.map((_, n) => n).sort(() => Math.random() - 0.5)
    mine.forEach((b, n) => (b.seat = order[n % order.length]))
    // The middle swells first, so it fills like a breath going in.
    const [mx, my] = [(body.from[0] + body.to[0]) / 2, (body.from[1] + body.to[1]) / 2]
    const far = Math.max(...body.seats.map((p) => Math.hypot(p.x - mx, p.y - my)))
    for (const b of mine) {
      const p = body.seats[b.seat]
      b.lag = (Math.hypot(p.x - mx, p.y - my) / far) * SWELL_LAG
    }
  }

  let t = 0
  let last = 0
  let raf = 0
  let stage = 0
  let done = false
  let shown = false

  /** Each buddy's own motion: forming apart, plumping up, leaning in to meet. */
  const pose = (t: number, side: -1 | 1, H: number) => {
    const p = clamp((t - SNAP[0]) / (SNAP[1] - SNAP[0]), 0, 1)
    // Lean back a hair, then fall in toward each other, fastest at contact.
    const c1 = 1.4
    const approach = p * p * ((c1 + 1) * p - c1)
    return {
      dx: side * GAP * H * (1 - approach),
      // A little hop on the way, and a tip toward each other that
      // straightens as they bump.
      dy: -H * 0.045 * Math.sin(Math.PI * p),
      rot: -side * 0.07 * Math.sin(Math.PI * p),
      k: INFLATE_FROM + (1 - INFLATE_FROM) * spring(t - INFLATE, 17, 0.42),
    }
  }
  /** The pair's squash as they bump: down into the floor, up, settle. */
  const squash = (t: number) => {
    const q = 0.09 * ring(t - SNAP[1], 24, 0.3)
    return { sx: 1 + q * 0.7, sy: 1 - q }
  }

  /** Mark units → canvas CSS px for one buddy this frame. */
  const matrix = (at: ReturnType<typeof place>, body: Body, t: number, H: number): Mat => {
    const o = pose(t, body.side, H)
    const q = squash(t)
    const toPx: Mat = [at.s, 0, 0, at.s, at.x, at.y]
    const [fx, fy] = apply(toPx, body.foot)
    const [cx, cy] = apply(toPx, feet)
    const cos = Math.cos(o.rot)
    const sin = Math.sin(o.rot)
    // Own pose around its own feet…
    const own = mul(mul([1, 0, 0, 1, fx + o.dx, fy + o.dy], [cos * o.k, sin * o.k, -sin * o.k, cos * o.k, 0, 0]), [1, 0, 0, 1, -fx, -fy])
    // …then the pair's squash around their shared feet.
    const pair = mul(mul([1, 0, 0, 1, cx, cy], [q.sx, 0, 0, q.sy, 0, 0]), [1, 0, 0, 1, -cx, -cy])
    return mul(pair, mul(own, toPx))
  }

  const frame = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60
    last = now
    t += dt

    const at = place()
    const H = mark.offsetHeight
    const mats = bodies.map((b) => matrix(at, b, t, H))
    const homes = bodies.map((b, i) => {
      const [x, y] = apply(mats[i], [(b.from[0] + b.to[0]) / 2, (b.from[1] + b.to[1]) / 2])
      return { x, y }
    })
    const cx = (homes[0].x + homes[1].x) / 2
    const cy = (homes[0].y + homes[1].y) / 2

    // The flock as a whole: wide and drifting, then tightening as it pours home.
    const cg = easeInOutCubic(clamp((t - CONVERGE) / (BIRD_DUR + STAGGER), 0, 1))
    const base = clamp(Math.min(w, h) * 0.36, 120, 250)
    const A = base * (1 - 0.6 * cg)
    const dxF = Math.sin(t * 0.8) * base * 0.12 * (1 - cg)
    const dyF = Math.cos(t * 0.6) * base * 0.08 * (1 - cg)
    const split = smooth(cg, 0, 0.6)

    // The sheet never turns past side-on, and as it condenses it turns back to
    // face you, so each coloured wing stays on the side of its own buddy.
    const ay = (t * 0.6 + 0.3) * (1 - cg)
    const ax = 0.4 + 0.3 * Math.sin(t * 0.7)
    const az = -0.3 + 0.25 * Math.sin(t * 0.5)
    const [sy, cyR, sx, cxR, sz, czR] = [Math.sin(ay), Math.cos(ay), Math.sin(ax), Math.cos(ax), Math.sin(az), Math.cos(az)]

    const fadeIn = smooth(t, 0, FADE_IN)
    const swell = easeOutCubic(clamp((t - SWELL[0]) / (SWELL[1] - SWELL[0]), 0, 1))
    const reveal = smooth(t, REVEAL[0], REVEAL[1])

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    for (const b of birds) {
      const body = bodies[b.home]
      const m = mats[b.home]
      const seat = body.seats[b.seat]
      const px = m[0] * seat.x + m[2] * seat.y + m[4]
      const py = m[1] * seat.x + m[3] * seat.y + m[5]

      // Where the sheet wants it. A lens-shaped sheet that ripples; turning it
      // in 3D is what makes the flock thin to a line edge-on and bloom when it
      // faces you.
      const home = homes[b.home]
      const hx = cx + (home.x - cx) * split + dxF
      const hy = cy + (home.y - cy) * split + dyF
      const u = b.u + 0.12 * Math.sin(t * 1.3 + b.ph)
      let x = u * A
      let y = b.v * A * (0.8 + 0.25 * Math.sin(u * 3 - t * 1.2)) * (1 - 0.5 * u * u)
      let z = A * (0.45 * Math.sin(u * 2.4 + t * 1.6) + 0.2 * Math.sin(b.v * 2.2 + t * 1.1) + 0.06 * b.w)
      ;[x, z] = [x * cyR + z * sy, -x * sy + z * cyR]
      ;[y, z] = [y * cxR - z * sx, y * sx + z * cxR]
      ;[x, y] = [x * czR - y * sz, x * sz + y * czR]

      // Its own trip home: spiral from the sheet onto its seat.
      const ci = easeInOutCubic(clamp((t - CONVERGE - b.delay) / BIRD_DUR, 0, 1))
      const ox = hx + x - px
      const oy = hy + y - py
      const phi = b.spin * ci
      const shrink = 1 - ci
      const tx = px + (ox * Math.cos(phi) - oy * Math.sin(phi)) * shrink
      const ty = py + (ox * Math.sin(phi) + oy * Math.cos(phi)) * shrink

      // Springs stiffen as it nears its seat, so nobody straggles, and the
      // slight underdamping makes the dotted buddy wobble like jelly.
      const k = 34 + 520 * ci * ci
      const damp = 2 * Math.sqrt(k) * 0.66
      b.vx += ((tx - b.x) * k - b.vx * damp) * dt
      b.vy += ((ty - b.y) * k - b.vy * damp) * dt
      b.x += b.vx * dt
      b.y += b.vy * dt

      if (swell >= 1) continue
      const depth = A > 1 ? clamp(z / A, -1, 1) * 0.5 + 0.5 : 0.5
      const flying = (0.35 + 0.65 * depth) * (1 - ci) + ci
      // Once they swell, the bodies take over and the landed dots melt in.
      ctx.globalAlpha = fadeIn * flying * (1 - smooth(swell, 0.1, 0.55))
      // The flock's colour warms into the buddy's own light as it lands.
      ctx.fillStyle = css(mix(body.flight, seat.color, ci))
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r * (0.75 + 0.6 * depth) * (1 - ci) + body.spacing * at.s * 0.3 * ci, 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // The dots swell inside each silhouette, from the middle out, until they
    // run together into the buddy itself; it carries on under the real mark
    // until that's fully in.
    if (swell > 0 && reveal < 1) {
      for (const [i, body] of bodies.entries()) {
        const m = mats[i]
        ctx.save()
        ctx.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5])
        ctx.clip(body.path)
        if (swell < 1) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.beginPath()
          const unit = body.spacing * at.s
          for (const b of birds) {
            if (b.home !== i) continue
            const k = easeOutCubic(clamp((t - SWELL[0] - b.lag) / (SWELL[1] - SWELL[0] - SWELL_LAG), 0, 1))
            const r = unit * (0.3 + 0.85 * k)
            ctx.moveTo(b.x + r, b.y)
            ctx.arc(b.x, b.y, r, 0, TAU)
          }
          ctx.clip()
          ctx.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5])
        }
        if (body.image.bitmap) {
          ctx.drawImage(body.image.bitmap, vb.x, vb.y, vb.width, vb.height)
        } else {
          const grad = ctx.createLinearGradient(body.from[0], body.from[1], body.to[0], body.to[1])
          for (const s of body.stops) grad.addColorStop(s.at, css(s.color))
          ctx.fillStyle = grad
          ctx.fill(body.path)
        }
        ctx.restore()
      }
    }

    // The real mark: in place by now, squashing with the bodies it replaces.
    const q = squash(t)
    mark.style.opacity = String(reveal)
    mark.style.transform = reveal > 0 ? `scale(${q.sx.toFixed(4)}, ${q.sy.toFixed(4)})` : ''
    if (glow) glow.style.opacity = String(smooth(cg, 0.3, 1))

    if (stage === 0 && t >= EYES_AT) {
      stage = 1
      mark.dataset.eyes = 'open'
      onStage('awake')
    }
    if (!shown && t >= TEXT_AT) {
      shown = true
      onStage('text')
    }
    if (t >= END) return finish()
    raf = requestAnimationFrame(frame)
  }

  /** Leave the mark as it would be with no murmuration at all: in place, at rest, breathing. */
  const settle = (awake: boolean) => {
    done = true
    cancelAnimationFrame(raf)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    mark.style.opacity = ''
    mark.style.transform = ''
    delete mark.dataset.forming
    // Skipped before they woke: the ordinary blinking, from open.
    if (!awake) delete mark.dataset.eyes
    if (glow) glow.style.opacity = '1'
    cleanup()
  }

  const finish = () => {
    if (done) return
    settle(t >= EYES_AT)
    if (!shown) onStage('text')
  }

  // Pause while the tab is hidden so the story doesn't play to nobody.
  const onVisibility = () => {
    if (done) return
    cancelAnimationFrame(raf)
    if (!document.hidden) {
      last = 0
      raf = requestAnimationFrame(frame)
    }
  }
  const cleanup = () => {
    ro.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
  }
  document.addEventListener('visibilitychange', onVisibility)
  // Until the flock has made them: no breath, no blinking, eyes shut.
  mark.dataset.forming = ''
  mark.dataset.eyes = 'closed'
  mark.style.opacity = '0'
  if (!document.hidden) raf = requestAnimationFrame(frame)

  return {
    skip: finish,
    stop: () => {
      if (!done) settle(false)
    },
  }
}
