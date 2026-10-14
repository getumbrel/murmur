// A murmuration on a 2D canvas. Each bird chases a point on a rippling sheet
// that turns slowly in 3D, so the flock thins to a line edge-on and blooms
// when it faces you, the way starlings do. Then the sheet shrinks and the
// birds pour home. With two homes (the two buddies of the mark) each half of
// the flock keeps its own colour and, as it condenses, finds its own buddy.
// Springs between bird and target give the lag that makes it feel alive.

export type MurmurStage = 'mark' | 'text'

type Point = { x: number; y: number }

type Options = {
  /** Any CSS colours the canvas understands, one per home. */
  colors: string[]
  /** Where the flock settles, one point per colour, in canvas CSS pixels. Read every frame. */
  targets: () => Point[]
  /** Fades in as the flock condenses. */
  glow?: HTMLElement | null
  onStage: (stage: MurmurStage) => void
}

const TAU = Math.PI * 2
// Seconds.
const FADE_IN = 0.5
const CONVERGE_START = 1.15
const CONVERGE_END = 2.0
const MARK_AT = 1.68
const TEXT_AT = 2.1

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const smooth = (v: number, lo: number, hi: number) => {
  const x = clamp((v - lo) / (hi - lo), 0, 1)
  return x * x * (3 - 2 * x)
}
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)

export function startMurmuration(canvas: HTMLCanvasElement, { colors, targets, glow, onStage }: Options) {
  const ctx = canvas.getContext('2d')!
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
  // Gaussian-ish, so the flock has a dense core and wispy edges.
  const g = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5
  const birds = Array.from({ length: count }, () => {
    const u = Math.random() * 2 - 1
    return {
      u,
      // Which home: the left of the sheet goes to the first, and so on.
      home: Math.min(colors.length - 1, Math.floor(((u + 1) / 2) * colors.length)),
      v: g(),
      w: g(),
      ph: Math.random() * TAU,
      x: Math.random() * w,
      y: Math.random() * h,
      vx: 0,
      vy: 0,
      r: 0.7 + Math.random() * 0.9,
    }
  })

  let t = 0
  let last = 0
  let raf = 0
  let stage = 0
  let done = false

  const frame = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60
    last = now
    t += dt

    const c = easeInOutCubic(clamp((t - CONVERGE_START) / (CONVERGE_END - CONVERGE_START), 0, 1))
    const base = clamp(Math.min(w, h) * 0.36, 120, 250)
    const A = base * (1 - c)
    const homes = targets()
    const cx = homes.reduce((a, p) => a + p.x, 0) / homes.length
    const cy = homes.reduce((a, p) => a + p.y, 0) / homes.length
    // The flock drifts around its home, then each part settles onto its own.
    const dx = Math.sin(t * 0.8) * base * 0.12 * (1 - c)
    const dy = Math.cos(t * 0.6) * base * 0.08 * (1 - c)
    const split = smooth(c, 0.1, 0.8)

    // The sheet never turns past side-on, and as it condenses it turns back to
    // face you, so each coloured wing stays on the side of its own buddy.
    const ay = (t * 0.6 + 0.3) * (1 - c)
    const ax = 0.4 + 0.3 * Math.sin(t * 0.7)
    const az = -0.3 + 0.25 * Math.sin(t * 0.5)
    const [sy, cyR, sx, cxR, sz, czR] = [
      Math.sin(ay),
      Math.cos(ay),
      Math.sin(ax),
      Math.cos(ax),
      Math.sin(az),
      Math.cos(az),
    ]

    // Springs stiffen as the flock condenses so nobody straggles.
    const k = 34 + 300 * c * c
    const damp = 2 * Math.sqrt(k) * 0.72

    const fadeIn = smooth(t, 0, FADE_IN)
    const fadeOut = 1 - smooth(c, 0.7, 1)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    for (const b of birds) {
      const home = homes[b.home] ?? homes[0]
      const hx = cx + (home.x - cx) * split + dx
      const hy = cy + (home.y - cy) * split + dy
      // A lens-shaped sheet that ripples. Turning it in 3D is what makes the
      // flock thin to a line edge-on and bloom when it faces you.
      const u = b.u + 0.12 * Math.sin(t * 1.3 + b.ph)
      let x = u * A
      let y = b.v * A * (0.8 + 0.25 * Math.sin(u * 3 - t * 1.2)) * (1 - 0.5 * u * u)
      let z = A * (0.45 * Math.sin(u * 2.4 + t * 1.6) + 0.2 * Math.sin(b.v * 2.2 + t * 1.1) + 0.06 * b.w)
      // Around y, then x, then a gentle roll.
      ;[x, z] = [x * cyR + z * sy, -x * sy + z * cyR]
      ;[y, z] = [y * cxR - z * sx, y * sx + z * cxR]
      ;[x, y] = [x * czR - y * sz, x * sz + y * czR]

      const tx = hx + x
      const ty = hy + y
      b.vx += ((tx - b.x) * k - b.vx * damp) * dt
      b.vy += ((ty - b.y) * k - b.vy * damp) * dt
      b.x += b.vx * dt
      b.y += b.vy * dt

      const depth = A > 1 ? clamp(z / A, -1, 1) * 0.5 + 0.5 : 0.5
      const alpha = fadeIn * fadeOut * (0.35 + 0.65 * depth)
      if (alpha < 0.01) continue
      ctx.globalAlpha = alpha
      ctx.fillStyle = colors[b.home]
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r * (0.75 + 0.6 * depth) * (1 - 0.35 * c), 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    if (glow) glow.style.opacity = String(smooth(c, 0.35, 1))

    if (stage === 0 && t >= MARK_AT) {
      stage = 1
      onStage('mark')
    }
    if (t >= TEXT_AT) return finish()
    raf = requestAnimationFrame(frame)
  }

  const finish = () => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (glow) glow.style.opacity = '1'
    onStage('text')
    cleanup()
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
  if (!document.hidden) raf = requestAnimationFrame(frame)

  return {
    skip: finish,
    stop: () => {
      done = true
      cancelAnimationFrame(raf)
      cleanup()
    },
  }
}
