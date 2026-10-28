import type { CSSProperties } from 'react'
import { Mail } from 'lucide-react'
import { cn } from '@/lib/cn'
import { MARKS } from './marks'

// An app's icon, the way a phone shows one: in a rounded square, its real
// icon where Murmur has it (icons/, full colour, from the maker's own logo),
// else its mark on its own colour (marks.ts). Hermes's catalog has no icons,
// so they ship with Murmur, never fetched; an app with neither gets its
// initial, never a broken image.

/** The icon name for email that isn't one company's (an agent's own account, the Email tile). */
export const EMAIL_ICON = 'email'

/** Each app's real icon, by its MARKS key: a 100×100 full-bleed square the tile rounds. */
const ART: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>('./icons/*.svg', { eager: true, query: '?url', import: 'default' })).map(
    ([path, url]) => [path.slice('./icons/'.length, -'.svg'.length), url],
  ),
)

/** The app's name the way its maker writes it. */
export function appName(name: string) {
  if (name === EMAIL_ICON) return 'Email'
  return MARKS[name]?.[0] ?? name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Light colours (Hugging Face's yellow, Robinhood's lime) take a dark mark. */
export function isLight(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6
}

/** A steady colour for an app nobody's coloured: the same every time. */
function hueOf(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export function AppIcon({
  name,
  size = 56,
  className,
  style,
}: {
  name: string
  size?: number
  className?: string
  style?: CSSProperties
}) {
  if (name === EMAIL_ICON) return <EmailIcon size={size} className={className} style={style} />
  const art = ART[name]
  if (art) {
    return (
      <span
        aria-hidden
        className={cn(
          'relative block flex-none overflow-hidden select-none',
          'shadow-[inset_0_0_0_0.5px_var(--line-strong)]',
          className,
        )}
        style={{ width: size, height: size, borderRadius: size * 0.2237, ...style }}
      >
        <img src={art} alt="" draggable={false} decoding="async" className="block size-full" />
        {/* The light from above and the hairline lie over the artwork, as over a drawn mark. */}
        <span className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(180deg,rgb(255_255_255/0.14),transparent_55%)] [box-shadow:inherit]" />
      </span>
    )
  }
  const mark = MARKS[name]
  const background = mark ? `#${mark[1]}` : `oklch(0.6 0.13 ${hueOf(name)})`
  const ink = mark && isLight(mark[1]) ? '#1d1626' : '#fff'
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid flex-none place-items-center overflow-hidden select-none',
        // A hairline keeps a black icon on a dark sheet (or a white one on a light sheet) from melting into it.
        'shadow-[inset_0_0_0_0.5px_var(--line-strong)]',
        className,
      )}
      style={{ width: size, height: size, borderRadius: size * 0.2237, background, ...style }}
    >
      {/* A soft light from above, like a phone's icons. */}
      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgb(255_255_255/0.14),transparent_55%)]" />
      {mark?.[2] ? (
        <svg
          viewBox="0 0 24 24"
          width={Math.round(size * 0.54)}
          height={Math.round(size * 0.54)}
          fill={ink}
          className="relative"
        >
          <path d={mark[2]} />
        </svg>
      ) : (
        <span
          className="relative font-semibold tracking-[-0.03em]"
          style={{ color: ink, fontSize: Math.round(size * 0.46), lineHeight: 1 }}
        >
          {appName(name).charAt(0)}
        </span>
      )}
    </span>
  )
}

/** Email that isn't one company's: an envelope on a calm blue, drawn like the other app icons. */
function EmailIcon({ size, className, style }: { size: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid flex-none place-items-center overflow-hidden select-none',
        'shadow-[inset_0_0_0_0.5px_var(--line-strong)]',
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.2237,
        background: 'linear-gradient(180deg, oklch(0.72 0.14 235), oklch(0.58 0.17 252))',
        ...style,
      }}
    >
      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgb(255_255_255/0.16),transparent_55%)]" />
      <Mail size={Math.round(size * 0.5)} strokeWidth={size < 24 ? 2.2 : 1.9} color="#fff" className="relative" />
    </span>
  )
}
