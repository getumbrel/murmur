import { useEffect, useSyncExternalStore } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AppIcon, drawsIcon } from '@/features/apps/app-icon'
import { MARKS } from '@/features/apps/marks'
import { IconChip, PasswordsIcon } from '@/ui/icons'

// A site the way a saved login shows it, as a phone would: its brand's icon
// when Murmur draws one (Notion, Stripe, PayPal), else the site's own, which
// Murmur's server asks the site itself for (server/site-icons.ts), so no
// favicon service hears which sites an agent signs in to. Until it's in, and
// for a site with none, its initial on a colour that's always the same for
// that site.

/** The part of a host that names the site: "app.notion.so" → "notion", "github.com" → "github". */
export function siteKey(host: string) {
  const labels = host.replace(/:\d+$/, '').split('.')
  const named = labels.slice(0, -1).reverse().find((label) => MARKS[label])
  return named ?? labels.find((label) => label !== 'www' && label !== 'm') ?? labels[0]
}

export function SiteIcon({
  host,
  size = 28,
  ask = true,
}: {
  host?: string
  size?: number
  /** False for an address still being typed: its initial, and no site asked about one that isn't finished. */
  ask?: boolean
}) {
  if (!host) return <IconChip icon={PasswordsIcon} size={size} radius={Math.round(size * 0.2237)} />
  const key = siteKey(host)
  if (!ask || drawsIcon(key)) return <AppIcon name={key} size={size} />
  return <OwnIcon host={host} name={key} size={size} />
}

type Look = {
  /** The icon, its clear margin trimmed off. */
  src: string
  /** A tile already, like a Home Screen icon, so it fills the square; else a mark set on a plate. */
  full: boolean
  /** What's under it: a tile's own colour, else white, or Murmur's ink under a white mark. */
  plate: string
}

// Each site's icon as it shows, for as long as the app is open: undefined
// until it's in, null for a site with none.
const looks = new Map<string, Look | null>()
const asking = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function lookUp(host: string) {
  if (looks.has(host) || asking.has(host)) return
  asking.add(host)
  const src = `/murmur/site-icon?host=${encodeURIComponent(host)}`
  const img = new Image()
  const settle = (look: Look | null) => {
    asking.delete(host)
    looks.set(host, look)
    for (const listener of listeners) listener()
  }
  img.onload = () => settle(lookOf(img, src))
  img.onerror = () => settle(null)
  img.src = src
}

/**
 * How an icon shows. Its clear margin comes off, so every site's sits at one
 * size. Solid just inside where a rounded square's corners curve, it's a tile
 * already (GitHub's, Amazon's) and fills the square, or, too small to fill one
 * without blurring, sits in the middle of a square of its own colour. Else (a
 * round logo, a lone mark on clear) it sits on white, or on Murmur's ink when
 * the mark is white itself. Null when nothing's drawn.
 */
function lookOf(img: HTMLImageElement, src: string): Look | null {
  const scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight))
  const [w, h] = [Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale)]
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx || !w || !h) return null
  ctx.drawImage(img, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  const at = (x: number, y: number) => (y * w + x) * 4

  // What's drawn: its box, and how much of it is white.
  const box = { left: w, top: h, right: -1, bottom: -1 }
  let inked = 0
  let white = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = at(x, y)
      if (data[i + 3] < 24) continue
      box.left = Math.min(box.left, x)
      box.top = Math.min(box.top, y)
      box.right = Math.max(box.right, x)
      box.bottom = Math.max(box.bottom, y)
      inked++
      if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225) white++
    }
  if (!inked) return null
  const { left, top } = box
  const [bw, bh] = [box.right - left + 1, box.bottom - top + 1]
  const inset = [0.12, 0.88].flatMap((fy) =>
    [0.12, 0.88].map((fx) => at(left + Math.round(fx * (bw - 1)), top + Math.round(fy * (bh - 1)))),
  )
  const solid = Math.abs(bw - bh) <= Math.max(bw, bh) * 0.06 && inset.every((i) => data[i + 3] > 230)
  const full = solid && Math.max(bw, bh) / scale >= 32

  // Trimmed, at the icon's own resolution, on a square.
  let trimmed = src
  if (bw < w || bh < h) {
    const side = Math.max(bw, bh) / scale
    const out = document.createElement('canvas')
    out.width = out.height = Math.round(side)
    const [cw, ch] = [bw / scale, bh / scale]
    out.getContext('2d')?.drawImage(img, left / scale, top / scale, cw, ch, (side - cw) / 2, (side - ch) / 2, cw, ch)
    trimmed = out.toDataURL('image/png')
  }
  const [r, g, b] = data.slice(inset[0], inset[0] + 3)
  const plate = solid ? `rgb(${r} ${g} ${b})` : white / inked > 0.85 ? '#1d1626' : '#fff'
  return { src: trimmed, full, plate }
}

function OwnIcon({ host, name, size }: { host: string; name: string; size: number }) {
  const look = useSyncExternalStore(subscribe, () => looks.get(host))
  const reduce = useReducedMotion()
  useEffect(() => lookUp(host), [host])
  return (
    <span aria-hidden className="relative block flex-none" style={{ width: size, height: size }}>
      <AppIcon name={name} size={size} />
      {/* Already in, it's simply there; arriving, it fades in over the initial. */}
      <AnimatePresence initial={false}>
        {look && (
          <motion.span
            initial={{ opacity: 0, scale: reduce ? 1 : 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 grid place-items-center overflow-hidden shadow-[inset_0_0_0_0.5px_var(--line-strong)] select-none"
            style={{ borderRadius: size * 0.2237, background: look.plate }}
          >
            <img
              src={look.src}
              alt=""
              draggable={false}
              decoding="async"
              className="block object-contain"
              style={look.full ? { width: size, height: size } : { width: size * 0.62, height: size * 0.62 }}
            />
            {/* The light from above and the hairline lie over it, as over the icons Murmur draws. */}
            <span className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(180deg,rgb(255_255_255/0.14),transparent_55%)] [box-shadow:inherit]" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
