import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type MotionValue } from 'motion/react'
import { ChevronLeft, ChevronRight, Download, Share, X } from 'lucide-react'
import { usePrefersReducedMotion } from '@/lib/use-media'
import { cn } from '@/lib/cn'

// A photo, full screen, the way Photos does it: it grows out of the thumbnail
// you tapped, pinches and double-taps to zoom, pans when zoomed, flicks down to
// shrink back into place, and swipes on to the next one in an album.
//
// Everything visual is driven by motion values (no React renders while you
// drag): `p` runs 0 (sitting on the thumbnail) → 1 (fitted on screen), and the
// gesture values layer on top of that.

export type AlbumPhoto = { src: string; name?: string; size?: Size }

export type LightboxProps = {
  src: string
  alt?: string
  name?: string
  /** The thumbnail it grows from and returns to. */
  origin: HTMLElement
  /** The thumbnail's corner radius, so the morph starts from its exact shape. */
  radius?: number
  /** Photos to swipe through, this one among them, starting at `start`. */
  album?: AlbumPhoto[]
  start?: number
  /** How many there are, when the album holds only some. */
  total?: number
  /** Where a photo in the album sits on the page, to close back into it. */
  thumbnail?: (index: number) => HTMLElement | undefined
  onClose: () => void
  onDownload?: () => void
  onShare?: () => void
}

type Size = { w: number; h: number }
type Rect = { x: number; y: number; w: number; h: number }

const open = { type: 'spring', duration: 0.44, bounce: 0.12 } as const
const settle = { type: 'spring', duration: 0.38, bounce: 0 } as const
const MAX_ZOOM = 5
/** Between one photo and the next as they slide. */
const PAGE_GAP = 24
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

function viewport() {
  return { w: window.innerWidth, h: window.innerHeight }
}

/** The image fitted to the screen (never blown up past 2× its real size). */
function fit(natural: Size) {
  const vp = viewport()
  // Phones go edge to edge; big screens leave room for the controls.
  const mx = vp.w >= 640 ? 72 : 0
  const my = vp.w >= 640 ? 76 : 0
  const scale = Math.min((vp.w - mx * 2) / natural.w, (vp.h - my * 2) / natural.h, 2)
  const w = natural.w * scale
  const h = natural.h * scale
  return { x: (vp.w - w) / 2, y: (vp.h - h) / 2, w, h }
}

export function Lightbox(props: LightboxProps) {
  return createPortal(<Viewer {...props} />, document.body)
}

function Viewer({ src, alt = '', name, origin, radius = 12, album, start = 0, total, thumbnail, onClose, onDownload, onShare }: LightboxProps) {
  const reduced = usePrefersReducedMotion()
  const img = origin instanceof HTMLImageElement ? origin : origin.querySelector('img')
  const photos = album ?? [{ src, name }]
  const [at, setAt] = useState(start)
  const here = photos[at]
  const [sizes, setSizes] = useState<Record<string, Size>>({ [src]: { w: img?.naturalWidth || 1200, h: img?.naturalHeight || 900 } })
  const sizeOf = (p: AlbumPhoto) => sizes[p.src] ?? p.size ?? { w: 1200, h: 900 }
  const [, resized] = useState(0)
  const frame = fit(sizeOf(here))
  // What it closes back into: the thumbnail of the photo you're on, if it has one showing.
  const home = at === start ? origin : thumbnail?.(at)
  const from = useRef<Rect>(rectOf(origin))
  const closing = useRef(false)
  const [chrome, setChrome] = useState(true)
  const closeButton = useRef<HTMLButtonElement>(null)

  const p = useMotionValue(reduced ? 1 : 0)
  const fade = useMotionValue(reduced ? 0 : 1)
  const dragX = useMotionValue(0)
  const dragY = useMotionValue(0)
  const zoom = useMotionValue(1)
  const panX = useMotionValue(0)
  const panY = useMotionValue(0)

  // The thumbnail steps aside while its big self is out.
  useLayoutEffect(() => {
    if (!home) return
    home.style.visibility = 'hidden'
    return () => {
      home.style.visibility = ''
    }
  }, [home])

  useEffect(() => {
    if (reduced) animate(fade, 1, { duration: 0.15 })
    else animate(p, 1, open)
    // For a keyboard to start from; a finger doesn't need the ring.
    closeButton.current?.focus({ preventScroll: true, focusVisible: false })
    const prev = document.activeElement as HTMLElement | null
    return () => prev?.focus?.({ preventScroll: true })
  }, [p, fade, reduced])

  useEffect(() => {
    const onResize = () => resized((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── Geometry: thumbnail ⇄ screen, plus gestures ──
  const geometry = (pv: number, dx: number, dy: number, z: number, px: number, py: number) => {
    const t = from.current
    const f = frame
    const s0 = Math.max(t.w / f.w, t.h / f.h)
    const dismiss = z <= 1.001 ? 1 - clamp(Math.abs(dy) / viewport().h, 0, 1) * 0.4 : 1
    const scale = lerp(s0, 1, pv) * dismiss * z
    const x = lerp(t.x + t.w / 2 - (f.x + f.w / 2), 0, pv) + dx + px
    const y = lerp(t.y + t.h / 2 - (f.y + f.h / 2), 0, pv) + dy + py
    // Crop to the thumbnail's shape at the start (it may be a square crop).
    const ix = lerp(Math.max(0, (f.w - t.w / s0) / 2), 0, pv)
    const iy = lerp(Math.max(0, (f.h - t.h / s0) / 2), 0, pv)
    const r = lerp(radius / s0, 0, pv)
    return { scale, x, y, clip: `inset(${iy}px ${ix}px ${iy}px ${ix}px round ${r}px)` }
  }
  const inputs: MotionValue<number>[] = [p, dragX, dragY, zoom, panX, panY]
  const backdrop = useTransform([p, dragY, fade], ([pv, dy, fv]: number[]) => {
    return pv * fv * (1 - clamp(Math.abs(dy) / (viewport().h * 0.35), 0, 1) * 0.9)
  })
  const chromeOpacity = useTransform(
    [p, dragY, fade],
    ([pv, dy, fv]: number[]) => clamp((pv - 0.6) / 0.4, 0, 1) * fv * (1 - clamp(Math.abs(dy) / 80, 0, 1)),
  )
  const imageOpacity = reduced ? fade : undefined

  // ── Closing ──
  const close = useCallback(
    (velocityY = 0) => {
      if (closing.current) return
      closing.current = true
      setChrome(false)
      const done = () => onClose()
      if (reduced) {
        animate(fade, 0, { duration: 0.12 }).then(done)
        return
      }
      const r = home?.isConnected ? rectOf(home) : null
      const vp = viewport()
      const visible = r && r.w > 0 && r.y + r.h > 0 && r.y < vp.h
      if (!visible) {
        // The thumbnail scrolled away: fade out where we are.
        animate(fade, 0, { duration: 0.2 }).then(done)
        return
      }
      from.current = r
      const springBack = { ...settle, velocity: 0 }
      animate(zoom, 1, settle)
      animate(panX, 0, settle)
      animate(panY, 0, settle)
      animate(dragX, 0, settle)
      animate(dragY, 0, { ...settle, velocity: velocityY })
      animate(p, 0, springBack).then(done)
    },
    [dragX, dragY, fade, home, onClose, p, panX, panY, reduced, zoom],
  )

  // ── Paging through an album ──
  const turning = useRef(false)
  const turn = useCallback(
    (by: 1 | -1, velocity = 0) => {
      const next = at + by
      if (turning.current || closing.current || !photos[next] || zoom.get() > 1.01) {
        animate(dragX, 0, settle)
        return
      }
      turning.current = true
      animate(dragX, -by * (viewport().w + PAGE_GAP), { ...settle, velocity }).then(() => {
        flushSync(() => setAt(next))
        dragX.set(0)
        turning.current = false
      })
    },
    [at, dragX, photos, zoom],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
      if (e.key === 'ArrowRight') turn(1)
      if (e.key === 'ArrowLeft') turn(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, turn])

  // ── Gestures ──
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    mode: 'none' | 'pending' | 'dismiss' | 'pan' | 'pinch' | 'page'
    start: { x: number; y: number; t: number }
    pan0: { x: number; y: number }
    zoom0: number
    dist0: number
    mid0: { x: number; y: number }
    track: { x: number; y: number; t: number }[]
    moved: boolean
  }>({
    mode: 'none',
    start: { x: 0, y: 0, t: 0 },
    pan0: { x: 0, y: 0 },
    zoom0: 1,
    dist0: 1,
    mid0: { x: 0, y: 0 },
    track: [],
    moved: false,
  })
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null)
  const tapTimer = useRef<number | undefined>(undefined)

  /** How far the zoomed image may pan before it shows an edge. */
  const bounds = (z: number) => {
    const vp = viewport()
    return { x: Math.max(0, (frame.w * z - vp.w) / 2), y: Math.max(0, (frame.h * z - vp.h) / 2) }
  }
  const rubber = (v: number, limit: number) => {
    if (Math.abs(v) <= limit) return v
    const over = Math.abs(v) - limit
    return Math.sign(v) * (limit + over * 0.35)
  }
  /** Screen point relative to the screen's centre (where the image is centred). */
  const centred = (pt: { x: number; y: number }) => {
    const vp = viewport()
    return { x: pt.x - vp.w / 2, y: pt.y - vp.h / 2 }
  }

  const zoomTo = (z: number, at?: { x: number; y: number }) => {
    const target = clamp(z, 1, MAX_ZOOM)
    let px = 0
    let py = 0
    if (target > 1 && at) {
      // Keep the tapped point under the finger.
      const q = centred(at)
      const local = { x: (q.x - panX.get()) / zoom.get(), y: (q.y - panY.get()) / zoom.get() }
      const b = bounds(target)
      px = clamp(q.x - target * local.x, -b.x, b.x)
      py = clamp(q.y - target * local.y, -b.y, b.y)
    }
    animate(zoom, target, settle)
    animate(panX, px, settle)
    animate(panY, py, settle)
  }

  const settlePan = () => {
    const z = zoom.get()
    if (z < 1) return zoomTo(1)
    if (z > MAX_ZOOM) return zoomTo(MAX_ZOOM)
    const b = bounds(z)
    animate(panX, clamp(panX.get(), -b.x, b.x), settle)
    animate(panY, clamp(panY.get(), -b.y, b.y), settle)
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (closing.current || (e.target as HTMLElement).closest('[data-chrome]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    const pts = [...pointers.current.values()]
    if (pts.length === 1) {
      g.mode = 'pending'
      g.start = { x: e.clientX, y: e.clientY, t: performance.now() }
      g.pan0 = { x: panX.get(), y: panY.get() }
      g.track = [{ x: e.clientX, y: e.clientY, t: performance.now() }]
      g.moved = false
    } else if (pts.length === 2) {
      const [a, b] = pts
      g.mode = 'pinch'
      g.moved = true
      g.zoom0 = zoom.get()
      g.dist0 = Math.hypot(a.x - b.x, a.y - b.y) || 1
      g.mid0 = centred({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      g.pan0 = { x: panX.get(), y: panY.get() }
      // A pinch that starts mid-dismiss takes over from it.
      animate(dragX, 0, settle)
      animate(dragY, 0, settle)
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    const pts = [...pointers.current.values()]

    if (g.mode === 'pinch' && pts.length >= 2) {
      const [a, b] = pts
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const raw = g.zoom0 * (dist / g.dist0)
      // Resist past the limits, like a rubber band.
      const z = raw < 1 ? 1 - (1 - raw) * 0.4 : raw > MAX_ZOOM ? MAX_ZOOM + (raw - MAX_ZOOM) * 0.25 : raw
      const mid = centred({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      const local = { x: (g.mid0.x - g.pan0.x) / g.zoom0, y: (g.mid0.y - g.pan0.y) / g.zoom0 }
      zoom.set(z)
      panX.set(mid.x - z * local.x)
      panY.set(mid.y - z * local.y)
      return
    }
    if (pts.length !== 1) return

    const dx = e.clientX - g.start.x
    const dy = e.clientY - g.start.y
    g.track.push({ x: e.clientX, y: e.clientY, t: performance.now() })
    if (g.track.length > 6) g.track.shift()

    if (g.mode === 'pending') {
      if (Math.hypot(dx, dy) < 6) return
      g.moved = true
      if (zoom.get() > 1.01) g.mode = 'pan'
      else if (photos.length > 1 && Math.abs(dx) > Math.abs(dy)) g.mode = 'page'
      else g.mode = 'dismiss'
    }
    if (g.mode === 'pan') {
      const b = bounds(zoom.get())
      panX.set(rubber(g.pan0.x + dx, b.x))
      panY.set(rubber(g.pan0.y + dy, b.y))
    } else if (g.mode === 'page') {
      // The first and last photos give a little, and no further.
      dragX.set(photos[at - Math.sign(dx)] ? dx : dx * 0.3)
    } else if (g.mode === 'dismiss') {
      dragX.set(dx)
      dragY.set(dy)
    }
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    const left = pointers.current.size

    if (g.mode === 'pinch') {
      if (left === 1) {
        // One finger stays down: carry on as a pan from here.
        const [pt] = [...pointers.current.values()]
        g.mode = zoom.get() > 1.01 ? 'pan' : 'none'
        g.start = { x: pt.x, y: pt.y, t: performance.now() }
        g.pan0 = { x: panX.get(), y: panY.get() }
      } else if (left === 0) {
        g.mode = 'none'
        settlePan()
      }
      return
    }
    if (left > 0) return

    if (g.mode === 'page') {
      g.mode = 'none'
      const first = g.track[0]
      const last = g.track.at(-1)!
      const vx = first && last.t > first.t ? ((last.x - first.x) / (last.t - first.t)) * 1000 : 0
      const dx = dragX.get()
      const by = dx < 0 ? 1 : -1
      if (Math.abs(dx) > viewport().w * 0.22 || (Math.abs(vx) > 500 && Math.sign(vx) === Math.sign(dx))) turn(by, vx)
      else animate(dragX, 0, settle)
      return
    }
    if (g.mode === 'dismiss') {
      g.mode = 'none'
      const first = g.track[0]
      const last = g.track.at(-1)!
      const vy = first && last.t > first.t ? ((last.y - first.y) / (last.t - first.t)) * 1000 : 0
      const dy = dragY.get()
      if (Math.abs(dy) > 110 || (Math.abs(vy) > 650 && Math.sign(vy) === Math.sign(dy))) close(vy)
      else {
        animate(dragX, 0, settle)
        animate(dragY, 0, { ...settle, velocity: vy })
      }
      return
    }
    if (g.mode === 'pan') {
      g.mode = 'none'
      settlePan()
      return
    }

    // A tap: two in a row zoom; one alone toggles the controls (or, with a
    // mouse, a click beside the photo closes it).
    g.mode = 'none'
    if (g.moved || performance.now() - g.start.t > 400) return
    const now = performance.now()
    const tap = { x: e.clientX, y: e.clientY, t: now }
    const prev = lastTap.current
    if (prev && now - prev.t < 300 && Math.hypot(prev.x - tap.x, prev.y - tap.y) < 30) {
      window.clearTimeout(tapTimer.current)
      lastTap.current = null
      zoomTo(zoom.get() > 1.01 ? 1 : 2.5, tap)
      return
    }
    lastTap.current = tap
    // (Pointer capture makes the surface the target; ask what's really under the pointer.)
    const onPhoto = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-photo]')
    const mouse = e.pointerType === 'mouse'
    window.clearTimeout(tapTimer.current)
    tapTimer.current = window.setTimeout(
      () => {
        if (mouse && !onPhoto) close()
        else setChrome((c) => !c)
      },
      mouse && !onPhoto ? 0 : 260,
    )
  }

  // Trackpad pinch (ctrl+wheel) and scroll-to-pan when zoomed.
  const surface = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = surface.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (closing.current) return
      if (e.ctrlKey) {
        const z = clamp(zoom.get() * Math.exp(-e.deltaY / 100), 1, MAX_ZOOM)
        const q = centred({ x: e.clientX, y: e.clientY })
        const local = { x: (q.x - panX.get()) / zoom.get(), y: (q.y - panY.get()) / zoom.get() }
        const b = bounds(z)
        zoom.set(z)
        panX.set(clamp(q.x - z * local.x, -b.x, b.x))
        panY.set(clamp(q.y - z * local.y, -b.y, b.y))
      } else if (zoom.get() > 1.01) {
        const b = bounds(zoom.get())
        panX.set(clamp(panX.get() - e.deltaX, -b.x, b.x))
        panY.set(clamp(panY.get() - e.deltaY, -b.y, b.y))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [frame])

  useEffect(() => () => window.clearTimeout(tapTimer.current), [])

  const button =
    'pressable glass flex size-11 items-center justify-center rounded-full text-ink shadow-float ring-[0.5px] ring-line-strong'

  return (
    <div
      ref={surface}
      role="dialog"
      aria-modal="true"
      aria-label={alt || name || 'Photo'}
      data-lightbox
      className="fixed inset-0 z-[60] touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <motion.div aria-hidden className="absolute inset-0 bg-bg" style={{ opacity: backdrop }} />

      {[at - 1, at, at + 1].map(
        (i) =>
          photos[i] && (
            <Slide
              key={photos[i].src}
              photo={photos[i]}
              alt={i === at ? alt : ''}
              beside={i - at}
              frame={fit(sizeOf(photos[i]))}
              inputs={inputs}
              geometry={geometry}
              opacity={imageOpacity}
              onSize={(size) => setSizes((all) => ({ ...all, [photos[i].src]: size }))}
            />
          ),
      )}

      <AnimatePresence>
        {chrome && (
          <motion.div
            key="chrome"
            data-chrome
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-none absolute inset-0"
          >
            <motion.div
              style={{ opacity: chromeOpacity }}
              className="flex items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)] sm:px-5 sm:pt-5"
            >
              <button
                ref={closeButton}
                type="button"
                onClick={() => close()}
                aria-label="Close"
                title="Close"
                className={cn(button, 'pointer-events-auto')}
              >
                <X size={20} strokeWidth={2} />
              </button>
              <div className="min-w-0 flex-1 truncate px-2 text-center text-footnote font-medium text-ink-2">
                {here.name ?? name}
                {photos.length > 1 && <span className="text-ink-3"> · {at + 1} of {total ?? photos.length}</span>}
              </div>
              {onShare && (
                <button
                  type="button"
                  onClick={onShare}
                  aria-label="Share"
                  title="Share"
                  className={cn(button, 'pointer-events-auto')}
                >
                  <Share size={19} strokeWidth={1.9} />
                </button>
              )}
              {onDownload && (
                <button
                  type="button"
                  onClick={onDownload}
                  aria-label="Save"
                  title="Save"
                  className={cn(button, 'pointer-events-auto')}
                >
                  <Download size={19} strokeWidth={1.9} />
                </button>
              )}
              {!onShare && !onDownload && <div className="size-11" />}
            </motion.div>
            {/* A mouse has no swipe. */}
            {photos[at - 1] && (
              <motion.button
                type="button"
                style={{ opacity: chromeOpacity }}
                onClick={() => turn(-1)}
                aria-label="Previous photo"
                title="Previous photo"
                className={cn(button, 'pointer-events-auto [@media(hover:none)]:hidden absolute left-5 top-1/2 -translate-y-1/2')}
              >
                <ChevronLeft size={22} strokeWidth={2} />
              </motion.button>
            )}
            {photos[at + 1] && (
              <motion.button
                type="button"
                style={{ opacity: chromeOpacity }}
                onClick={() => turn(1)}
                aria-label="Next photo"
                title="Next photo"
                className={cn(button, 'pointer-events-auto [@media(hover:none)]:hidden absolute right-5 top-1/2 -translate-y-1/2')}
              >
                <ChevronRight size={22} strokeWidth={2} />
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

type Geometry = (p: number, dx: number, dy: number, z: number, px: number, py: number) => { scale: number; x: number; y: number; clip: string }

type SlideProps = {
  photo: AlbumPhoto
  alt: string
  /** 0 for the photo you're on; -1 and 1 wait either side of it. */
  beside: number
  frame: Rect
  inputs: MotionValue<number>[]
  geometry: Geometry
  opacity?: MotionValue<number>
  onSize: (size: Size) => void
}

/** One photo of the album. The same element carries it from waiting at the side to centre stage. */
function Slide({ photo, alt, beside, frame, inputs, geometry, opacity, onSize }: SlideProps) {
  const transform = useTransform(inputs, (v) => {
    const [pv, dx, dy, z, px, py] = v as number[]
    if (beside) return `translate3d(${dx + beside * (viewport().w + PAGE_GAP)}px, 0, 0)`
    const g = geometry(pv, dx, dy, z, px, py)
    return `translate3d(${g.x}px, ${g.y}px, 0) scale(${g.scale})`
  })
  const clipPath = useTransform(inputs, (v) => {
    const [pv, dx, dy, z, px, py] = v as number[]
    return beside ? 'none' : geometry(pv, dx, dy, z, px, py).clip
  })
  return (
    <motion.img
      data-photo
      src={photo.src}
      alt={alt}
      draggable={false}
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget
        if (w && h) onSize({ w, h })
      }}
      className="absolute max-w-none origin-center will-change-transform"
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h, transform, clipPath, opacity }}
    />
  )
}
