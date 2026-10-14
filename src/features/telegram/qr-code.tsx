import { useMemo, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { encode } from 'uqr'

// A QR code drawn as soft rounded modules with rounded finder eyes, dark ink
// on white (cameras still prefer it, even in dark mode), and a clear centre
// for the agent's orb. High error correction keeps it scannable with the
// centre cut out.

type Props = {
  value: string
  size?: number
  /** Agent hue: the modules take a deep shade of it. */
  hue?: number
  /** Drawn over the cleared centre, e.g. the agent's orb. */
  center?: ReactNode
  className?: string
}

export function QrCode({ value, size = 220, hue, center, className }: Props) {
  const reduce = useReducedMotion()
  const { n, dots, eyes, hole } = useMemo(() => layout(value), [value])
  const ink = hue === undefined ? '#0e0e10' : `oklch(0.28 0.07 ${hue})`
  const quiet = 2

  return (
    <motion.div
      className={className}
      style={{ width: size, height: size, position: 'relative' }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, clipPath: 'circle(0% at 50% 50%)' }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, clipPath: 'circle(75% at 50% 50%)' }}
      transition={{ duration: reduce ? 0.15 : 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      <svg
        viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`}
        width={size}
        height={size}
        role="img"
        aria-label="QR code"
        className="block rounded-[18px] bg-white"
        shapeRendering="geometricPrecision"
      >
        <path d={dots} fill={ink} />
        {eyes.map(([x, y]) => (
          <g key={`${x}-${y}`} fill={ink}>
            <path fillRule="evenodd" d={`${roundRect(x, y, 7, 7, 2.2)} ${roundRect(x + 1, y + 1, 5, 5, 1.5)}`} />
            <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.95} />
          </g>
        ))}
      </svg>
      {center && hole > 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            style={{ width: (hole / (n + quiet * 2)) * size, height: (hole / (n + quiet * 2)) * size }}
            className="flex items-center justify-center"
          >
            {center}
          </div>
        </div>
      )}
    </motion.div>
  )
}

function layout(value: string) {
  const qr = encode(value, { ecc: 'H', border: 0 })
  const n = qr.size
  // An odd-sized square in the middle, about a fifth of the code.
  let hole = Math.round(n * 0.22)
  if (hole % 2 !== n % 2) hole += 1
  const h0 = (n - hole) / 2
  const inHole = (x: number, y: number) => x >= h0 - 0.5 && x < h0 + hole - 0.5 && y >= h0 - 0.5 && y < h0 + hole - 0.5
  const inEye = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7)

  const r = 0.3
  let dots = ''
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.data[y][x] || inEye(x, y) || inHole(x, y)) continue
      // Rounded squares a touch smaller than the grid read cleanly at any size.
      dots += roundRect(x + 0.04, y + 0.04, 0.92, 0.92, r)
    }
  }
  const eyes: [number, number][] = [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ]
  return { n, dots, eyes, hole }
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  const f = (v: number) => +v.toFixed(3)
  return (
    `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${f(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}` +
    `h${f(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}v${f(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}z`
  )
}
