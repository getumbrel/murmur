import { useId, type CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import './brand.css'

// Murmur's brand mark: two buddies, violet and coral, leaning shoulder to
// shoulder so that together they spell a lowercase "m". See docs/BRAND.md.
//
// Drawn on a 100-unit grid (the app-icon tile). Colours are literal so the
// SVG stays portable when exported (design/icon/murmur-icon.svg is this
// component's output at 1024px, with motion stripped).

export const BRAND = {
  violet: '#9D75F1', // oklch(0.658 0.18 296)
  coral: '#FD8D8C', // oklch(0.764 0.136 21)
  cream: '#FEFAED', // oklch(0.985 0.018 93)
  ink: '#1D1626', // oklch(0.2 0.025 305)
  night: '#15111B', // oklch(0.18 0.018 305)
} as const

type Part = {
  cx: number
  w: number
  top: number
  bottom: number
  notch: number
  nw: number
  nd: number
  /** Bottom corner radius on the outer and the inner (touching) side. */
  ro: number
  ri: number
}

// Measured from the original "Buddy m" artwork, then tidied to the grid.
// The touching feet are square-cornered: together they make one middle leg.
const LEFT: Part = { cx: 30.8, w: 40.2, top: 24.6, bottom: 75.6, notch: 41.4, nw: 7, nd: 15.4, ro: 9.4, ri: 0.4 }
const RIGHT: Part = { cx: 69.2, w: 40.2, top: 24.2, bottom: 75.6, notch: 62.4, nw: 6.6, nd: 14.6, ro: 9.4, ri: 0.4 }

const f = (n: number) => Math.round(n * 100) / 100

/** A plump arch with its foot-gap where the "m" needs it. */
function partPath(p: Part, arch = 1.24, full = 0.6) {
  const hw = p.w / 2
  const L = p.cx - hw
  const R = p.cx + hw
  const T = p.top
  const B = p.bottom
  const S = T + hw * arch
  const left = p.cx < 50
  const rR = left ? p.ri : p.ro
  const rL = left ? p.ro : p.ri
  const nr = p.nw / 2
  const fr = nr * 0.9
  const n = p.notch
  const bulge = 0.5
  const s1 = (r: number) => S + (B - r - S) * 0.35
  const s2 = (r: number) => S + (B - r - S) * 0.78
  return [
    `M${f(L)} ${f(S)}`,
    `C${f(L)} ${f(S - (S - T) * full)} ${f(p.cx - hw * full)} ${f(T)} ${f(p.cx)} ${f(T)}`,
    `C${f(p.cx + hw * full)} ${f(T)} ${f(R)} ${f(S - (S - T) * full)} ${f(R)} ${f(S)}`,
    `C${f(R + bulge)} ${f(s1(rR))} ${f(R + bulge)} ${f(s2(rR))} ${f(R)} ${f(B - rR)}`,
    `C${f(R)} ${f(B - rR * 0.42)} ${f(R - rR * 0.42)} ${f(B)} ${f(R - rR)} ${f(B)}`,
    `L${f(n + nr + fr)} ${f(B)}`,
    `Q${f(n + nr)} ${f(B)} ${f(n + nr)} ${f(B - fr)}`,
    `L${f(n + nr)} ${f(B - p.nd + nr)}`,
    `A${f(nr)} ${f(nr)} 0 0 0 ${f(n - nr)} ${f(B - p.nd + nr)}`,
    `L${f(n - nr)} ${f(B - fr)}`,
    `Q${f(n - nr)} ${f(B)} ${f(n - nr - fr)} ${f(B)}`,
    `L${f(L + rL)} ${f(B)}`,
    `C${f(L + rL * 0.42)} ${f(B)} ${f(L)} ${f(B - rL * 0.42)} ${f(L)} ${f(B - rL)}`,
    `C${f(L - bulge)} ${f(s2(rL))} ${f(L - bulge)} ${f(s1(rL))} ${f(L)} ${f(S)}`,
    'Z',
  ].join('')
}

const LEFT_D = partPath(LEFT)
const RIGHT_D = partPath(RIGHT)

// Eyes look at each other, as in the original artwork.
const EYES = {
  left: [
    { cx: 33.3, cy: 40.2, rx: 1.86, ry: 3.45 },
    { cx: 43.1, cy: 40, rx: 1.86, ry: 3.45 },
  ],
  right: [
    { cx: 62.7, cy: 40.6, rx: 1.74, ry: 3.25 },
    { cx: 71.2, cy: 40.6, rx: 1.74, ry: 3.25 },
  ],
}

/** The bare mark's crop of the 100-unit grid. */
const BARE = { x: 8.5, y: 21.5, w: 83, h: 58 }
/** The glyph's square crop: the m fills the width, centred. */
const GLYPH_VB = '9.6 8.6 80.8 80.8'

type MarkProps = {
  /** Tile: side length. Bare mark: height (width is ~1.43× height). */
  size?: number
  /** The full app-icon tile on its cream (or night) background. */
  tile?: boolean
  /**
   * 'color' the full soft-3D mark. 'glyph' flat and bold for favicons and
   * anything under ~24px (square crop). 'mono' one ink (currentColor).
   */
  variant?: 'color' | 'glyph' | 'mono'
  /** Which surface it sits on. 'auto' follows the colour scheme. */
  theme?: 'light' | 'dark' | 'auto'
  /** No blinking (exports, print). */
  still?: boolean
  /** A slow breath on top of the blinking, for a mark that's the whole screen (splash, welcome). */
  breathe?: boolean
  /** Tile only: shrink the m into the 80% safe zone for maskable icons. */
  safe?: boolean
  className?: string
  /** Accessible name; pass '' when the name is printed right beside it. */
  label?: string
}

export function MurmurMark({
  size = 32,
  tile = false,
  variant = 'color',
  theme = 'auto',
  still = false,
  breathe = false,
  safe = false,
  className,
  label = 'Murmur',
}: MarkProps) {
  const raw = useId()
  const id = 'mm' + raw.replace(/[^a-zA-Z0-9_-]/g, '')
  const square = tile || variant === 'glyph'
  const vb = tile ? '0 0 100 100' : variant === 'glyph' ? GLYPH_VB : `${BARE.x} ${BARE.y} ${BARE.w} ${BARE.h}`
  const width = square ? size : Math.round((size * BARE.w) / BARE.h)
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={vb}
      width={width}
      height={size}
      className={cn('murmur-mark', className)}
      data-theme={theme}
      data-still={still || undefined}
      data-breathe={(breathe && !still) || undefined}
      style={{ flex: 'none' } as CSSProperties}
      {...a11y}
    >
      {variant === 'mono' ? (
        <Mono id={id} tile={tile} />
      ) : variant === 'glyph' ? (
        <Glyph id={id} eyes={size >= 24} />
      ) : (
        <Color id={id} tile={tile} theme={theme} safe={safe} />
      )}
    </svg>
  )
}

function Eyes({ glints = true, ink }: { glints?: boolean; ink: [string, string] }) {
  return (
    <>
      {(['left', 'right'] as const).map((side, i) => (
        <g key={side} className={`mm-eyes mm-eyes-${side}`}>
          {EYES[side].map((e) => (
            <g key={e.cx}>
              <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill={ink[i]} />
              {glints && (
                <ellipse
                  cx={f(e.cx + e.rx * 0.22)}
                  cy={f(e.cy - e.ry * 0.5)}
                  rx={f(e.rx * 0.36)}
                  ry={f(e.ry * 0.25)}
                  fill="#fff"
                  fillOpacity="0.9"
                  transform={`rotate(14 ${f(e.cx + e.rx * 0.22)} ${f(e.cy - e.ry * 0.5)})`}
                />
              )}
            </g>
          ))}
        </g>
      ))}
    </>
  )
}

function Color({ id, tile, theme, safe }: { id: string; tile: boolean; theme: 'light' | 'dark' | 'auto'; safe?: boolean }) {
  const dark = theme === 'dark'
  return (
    <>
      <defs>
        <radialGradient id={`${id}bg`} cx="0.5" cy="0.42" r="0.75">
          <stop offset="0" className="mm-bg0" stopColor={dark ? '#241D2E' : '#FFFDF6'} />
          <stop offset="1" className="mm-bg1" stopColor={dark ? '#120F17' : '#FAF2DE'} />
        </radialGradient>
        <linearGradient id={`${id}v`} x1="0.3" y1="0" x2="0.62" y2="1">
          <stop offset="0" stopColor="#D2B5FC" />
          <stop offset="0.3" stopColor="#B591FA" />
          <stop offset="0.62" stopColor="#9C74F0" />
          <stop offset="1" stopColor="#7D59D4" />
        </linearGradient>
        <linearGradient id={`${id}c`} x1="0.42" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#FFC4BD" />
          <stop offset="0.32" stopColor="#FE9F9A" />
          <stop offset="0.64" stopColor="#FC8A89" />
          <stop offset="1" stopColor="#F26C70" />
        </linearGradient>
        {/* Where they touch, violet melts into coral. */}
        <linearGradient id={`${id}seam`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#A777EE" stopOpacity="0" />
          <stop offset="0.38" stopColor="#BF74DC" stopOpacity="0.7" />
          <stop offset="0.5" stopColor="#D672C2" stopOpacity="0.85" />
          <stop offset="0.62" stopColor="#E9789C" stopOpacity="0.6" />
          <stop offset="1" stopColor="#FB8A8C" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}seamfade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id={`${id}seammask`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect x="44" y="33" width="12" height="45" fill={`url(#${id}seamfade)`} />
        </mask>
        <radialGradient id={`${id}glowL`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#F2E8FF" stopOpacity="0.75" />
          <stop offset="1" stopColor="#F2E8FF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}glowR`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFF1EC" stopOpacity="0.75" />
          <stop offset="1" stopColor="#FFF1EC" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}u`}>
          <path d={LEFT_D} />
          <path d={RIGHT_D} />
        </clipPath>
        <radialGradient id={`${id}sh`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" className="mm-sh0" stopColor={dark ? '#000' : '#9A6B3E'} stopOpacity={dark ? 0.6 : 0.3} />
          <stop offset="0.6" className="mm-sh1" stopColor={dark ? '#000' : '#9A6B3E'} stopOpacity={dark ? 0.22 : 0.1} />
          <stop offset="1" className="mm-sh2" stopColor={dark ? '#000' : '#9A6B3E'} stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}vol`} x="0" y="0" width="100" height="100" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          {/* Core shadow: the body's own colour, deeper and richer. */}
          <feGaussianBlur in="SourceAlpha" stdDeviation="4.6" result="b1" />
          <feOffset in="b1" dx="-2.6" dy="-4.2" result="o1" />
          <feComposite in="SourceAlpha" in2="o1" operator="out" result="r1" />
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="0.68 0 0 0 -0.02  0 0.5 0 0 -0.03  0 0 0.6 0 0  0 0 0 0.5 0"
            result="c1"
          />
          <feComposite in="c1" in2="r1" operator="in" result="shade" />
          {/* Light bounced up off the floor. */}
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.1" result="b3" />
          <feOffset in="b3" dx="0" dy="-1.6" result="o3" />
          <feComposite in="SourceAlpha" in2="o3" operator="out" result="r3" />
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="0.6 0 0 0 0.42  0 0.6 0 0 0.38  0 0 0.6 0 0.4  0 0 0 0.3 0"
            result="c3"
          />
          <feComposite in="c3" in2="r3" operator="in" result="bounce" />
          {/* A thin key-light rim on the upper left. */}
          <feGaussianBlur in="SourceAlpha" stdDeviation="0.9" result="b2" />
          <feOffset in="b2" dx="0.8" dy="1.3" result="o2" />
          <feComposite in="SourceAlpha" in2="o2" operator="out" result="r2" />
          <feFlood floodColor="#FFFFFF" floodOpacity="0.26" />
          <feComposite in2="r2" operator="in" result="rim" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="shade" />
            <feMergeNode in="bounce" />
            <feMergeNode in="rim" />
          </feMerge>
        </filter>
      </defs>
      {tile && <rect width="100" height="100" fill={`url(#${id}bg)`} />}
      <g transform={safe && tile ? 'translate(11 11) scale(0.78)' : undefined}>
      <ellipse cx="50" cy="76.6" rx="45" ry="5" fill={`url(#${id}sh)`} />
      <ellipse cx="50" cy="75.9" rx="38" ry="1.8" fill={`url(#${id}sh)`} />
      <g filter={`url(#${id}vol)`}>
        <path d={LEFT_D} fill={`url(#${id}v)`} />
        <path d={RIGHT_D} fill={`url(#${id}c)`} />
        <g clipPath={`url(#${id}u)`}>
          <rect x="44" y="30" width="12" height="48" fill={`url(#${id}seam)`} mask={`url(#${id}seammask)`} />
          <ellipse cx="27" cy="31" rx="13" ry="7.5" fill={`url(#${id}glowL)`} transform="rotate(-18 27 31)" />
          <ellipse cx="68" cy="30.5" rx="12" ry="7" fill={`url(#${id}glowR)`} transform="rotate(-14 68 30.5)" />
        </g>
      </g>
      <Eyes ink={['#2E1B46', '#4E1F2A']} />
      </g>
    </>
  )
}

/** Flat and bold for 16–32px: no filters, fatter eyes, a crisp seam. */
function Glyph({ id, eyes }: { id: string; eyes: boolean }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}v`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B997FB" />
          <stop offset="1" stopColor="#8B66E4" />
        </linearGradient>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FEAAA5" />
          <stop offset="1" stopColor="#F7787A" />
        </linearGradient>
      </defs>
      <path d={LEFT_D} fill={`url(#${id}v)`} />
      <path d={RIGHT_D} fill={`url(#${id}c)`} />
      {eyes &&
        [...EYES.left.map((e) => [e, '#2E1B46'] as const), ...EYES.right.map((e) => [e, '#4E1F2A'] as const)].map(
          ([e, ink]) => (
            <ellipse key={e.cx} cx={e.cx} cy={e.cy + 0.6} rx={f(e.rx * 1.45)} ry={f(e.ry * 1.3)} fill={ink} />
          ),
        )}
    </>
  )
}

/** One ink: the two bodies parted by a hairline, eyes knocked out. */
function Mono({ id, tile }: { id: string; tile: boolean }) {
  return (
    <>
      <defs>
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          <path d={RIGHT_D} fill="#000" stroke="#000" strokeWidth="3.2" />
        </mask>
        <mask id={`${id}e`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          {[...EYES.left, ...EYES.right].map((e) => (
            <ellipse key={e.cx} cx={e.cx} cy={e.cy} rx={f(e.rx * 1.12)} ry={f(e.ry * 1.06)} fill="#000" />
          ))}
        </mask>
      </defs>
      {tile && <rect width="100" height="100" rx="0" fill="currentColor" fillOpacity="0.08" />}
      <g mask={`url(#${id}e)`} fill="currentColor">
        <path d={LEFT_D} mask={`url(#${id}m)`} />
        <path d={RIGHT_D} />
      </g>
    </>
  )
}

/**
 * The lockup: mark + "murmur". Lowercase, like the monogram; Inter at 600
 * with display-tight tracking. `size` is the mark's height; the type is
 * sized from it so the lockup always keeps its proportions.
 */
export function MurmurWordmark({
  size = 28,
  mark = true,
  className,
}: {
  size?: number
  /** Show the mark (default) or just the word. */
  mark?: boolean
  className?: string
}) {
  return (
    <span
      className={cn('murmur-wordmark', className)}
      style={{ '--mw': `${size}px` } as CSSProperties}
      role="img"
      aria-label="Murmur"
    >
      {mark && <MurmurMark size={size} label="" className="murmur-wordmark-mark" />}
      <span className="murmur-wordmark-word" aria-hidden>
        murmur
      </span>
    </span>
  )
}

/** The endorsement signature: "Murmur by Umbrel". Quiet, legible, deferential. */
export function ByUmbrel({ className, mark = false }: { className?: string; mark?: boolean }) {
  return (
    <p className={cn('by-umbrel', className)}>
      {/* The flat glyph is the mark drawn for this size: 16px square, an m
          about 10px tall that sits on the caption's x-height. */}
      {mark && <MurmurMark variant="glyph" size={16} label="" />}
      <span className="by-umbrel-name">Murmur</span>
      <span className="by-umbrel-by">by</span>
      <a href="https://umbrel.com" target="_blank" rel="noopener" className="by-umbrel-link">
        Umbrel
      </a>
    </p>
  )
}

/** Umbrel's own mark (umbrelOS's UmbrelLogo), in the current colour, for pointing at the Umbrel itself. */
export function UmbrelMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 47"
      width={size}
      height={(size * 47) / 96}
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M47.416 8.723c10.404-.2 18.594 2.599 24.948 8.11 4.615 4.002 8.475 9.622 11.46 17.045-2.275-.56-4.679-.835-7.196-.835-5.324 0-10.102 1.232-14.083 3.912-4.46-2.722-9.258-4.152-14.34-4.152-5.198 0-10.188 1.495-14.923 4.302-4.571-2.875-9.722-4.302-15.341-4.302-2.03 0-3.97.188-5.802.582 2.684-6.827 6.235-12.09 10.546-15.946 6.16-5.512 14.278-8.516 24.731-8.716ZM7.761 45.613a4.35 4.35 0 0 0 .472-.493c1.901-2.205 4.878-3.604 9.708-3.604 4.557 0 8.466 1.266 11.884 3.768l.135.1a5.446 5.446 0 0 0 6.304.143c4.085-2.764 8.043-4.011 11.94-4.011 3.83 0 7.545 1.202 11.228 3.817l.076.055a5.446 5.446 0 0 0 6.727-.307c2.433-2.1 5.762-3.325 10.393-3.325 4.871 0 8.648 1.358 11.63 3.875a4.38 4.38 0 0 0 1.632.907 4.336 4.336 0 0 0 2.968-.168 4.364 4.364 0 0 0 2.592-4.66 4.39 4.39 0 0 0-.109-.51c-3.456-13.388-9.106-23.87-17.269-30.95C69.822 3.095 59.422-.222 47.25.012 35.124.245 24.874 3.79 16.876 10.945 8.948 18.037 3.639 28.312.633 41.3a4.352 4.352 0 0 0 2.533 5.081 4.352 4.352 0 0 0 4.595-.767Z"
      />
    </svg>
  )
}
