import { useId, useMemo, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import './buddy.css'

// The Buddy: every agent's face, drawn as one half of Murmur's "m". A plump
// soft-3D arch with two little pill eyes, lit from the upper left, standing on
// a soft contact shadow. Pure vector (one inline SVG for the body, a few spans
// for the parts that move), so it's crisp from 20px to 200px and every agent
// gets its own colour from `hue`. All motion is CSS transform/opacity on
// composited layers; the SVG itself never repaints while animating.
//
// Drop-in for the Orb: same props, same states (see BuddyState).

export type BuddyState =
  'idle' | 'listening' | 'speaking' | 'thinking' | 'working' | 'waiting' | 'done' | 'error' | 'offline'

type Props = {
  hue: number
  size?: number
  state?: BuddyState
  /** Stable seed: each agent gets its own proportions, quirks and rhythm. */
  seed?: string
  className?: string
  label?: string
}

// ── Per-agent individuality ─────────────────────────────────────────────────
// Everything a seed decides, kept inside a narrow, always-cute range so the
// family reads as one species.

type Accessory = 'none' | 'sprout' | 'tuft' | 'antenna'

type Traits = {
  /** Body width / height in a 100-unit box. */
  w: number
  h: number
  /** Arch height as a share of the half-width (1 = semicircle). */
  arch: number
  /** Shoulder fullness: 0.55 is a circle, higher is plumper. */
  full: number
  notchW: number
  notchD: number
  tilt: number
  side: 1 | -1
  eyeGap: number
  eyeY: number
  eyeScale: number
  acc: Accessory
  accX: number
  rosy: boolean
  breath: number
  blink: number
  doubleBlink: boolean
  glance: number
  phase: number
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function rng(seed: string) {
  let a = hash(seed || 'buddy')
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cache = new Map<string, Traits>()

function traitsFor(seed: string): Traits {
  const hit = cache.get(seed)
  if (hit) return hit
  const r = rng(seed)
  const between = (a: number, b: number) => a + (b - a) * r()
  const pick = r()
  const acc: Accessory = pick < 0.5 ? 'none' : pick < 0.67 ? 'sprout' : pick < 0.84 ? 'tuft' : 'antenna'
  const t: Traits = {
    w: between(62, 67),
    h: between(79, 83),
    arch: between(0.98, 1.1),
    full: between(0.62, 0.68),
    notchW: between(10, 12),
    notchD: between(14, 17),
    tilt: between(-2.2, 2.2),
    side: r() < 0.5 ? -1 : 1,
    eyeGap: between(0.25, 0.3),
    eyeY: between(0.3, 0.35),
    eyeScale: between(0.94, 1.08),
    acc,
    accX: between(-7, 7),
    rosy: r() < 0.3,
    breath: between(4.4, 5.8),
    blink: between(3.8, 6.8),
    doubleBlink: r() < 0.35,
    glance: between(11, 17),
    phase: r(),
  }
  // A sprout or antenna needs a little headroom.
  if (acc !== 'none') t.h = Math.min(t.h, 79)
  cache.set(seed, t)
  return t
}

// ── Geometry (100 × 100 box, feet on y = 91) ─────────────────────────────────

const FLOOR = 91

const f = (n: number) => Math.round(n * 100) / 100

/** A soft lowercase "n": a plump arch with a little gap between two stubby feet. */
function bodyPath(t: Traits, tiny: boolean) {
  const cx = 50
  const hw = t.w / 2
  const L = cx - hw
  const R = cx + hw
  const B = FLOOR
  const T = B - t.h
  const S = T + hw * t.arch
  const k = t.full
  const r = t.w * 0.27
  // At 20px the gap would be a smudge: make it a shallow, wider dimple.
  const nw = tiny ? 12 : t.notchW
  const nd = tiny ? 9 : t.notchD
  const nr = nw / 2
  const fr = nr * 0.9
  const bulge = 0.9
  const s1 = S + (B - r - S) * 0.35
  const s2 = S + (B - r - S) * 0.78
  return [
    `M${f(L)} ${f(S)}`,
    `C${f(L)} ${f(S - (S - T) * k)} ${f(cx - hw * k)} ${f(T)} ${cx} ${f(T)}`,
    `C${f(cx + hw * k)} ${f(T)} ${f(R)} ${f(S - (S - T) * k)} ${f(R)} ${f(S)}`,
    `C${f(R + bulge)} ${f(s1)} ${f(R + bulge)} ${f(s2)} ${f(R)} ${f(B - r)}`,
    `C${f(R)} ${f(B - r * 0.42)} ${f(R - r * 0.42)} ${B} ${f(R - r)} ${B}`,
    `L${f(cx + nr + fr)} ${B}`,
    `Q${f(cx + nr)} ${B} ${f(cx + nr)} ${f(B - fr)}`,
    `L${f(cx + nr)} ${f(B - nd + nr)}`,
    `A${f(nr)} ${f(nr)} 0 0 0 ${f(cx - nr)} ${f(B - nd + nr)}`,
    `L${f(cx - nr)} ${f(B - fr)}`,
    `Q${f(cx - nr)} ${B} ${f(cx - nr - fr)} ${B}`,
    `L${f(L + r)} ${B}`,
    `C${f(L + r * 0.42)} ${B} ${f(L)} ${f(B - r * 0.42)} ${f(L)} ${f(B - r)}`,
    `C${f(L - bulge)} ${f(s2)} ${f(L - bulge)} ${f(s1)} ${f(L)} ${f(S)}`,
    'Z',
  ].join('')
}

const maskCache = new Map<string, string>()
function maskFor(key: string, d: string) {
  let m = maskCache.get(key)
  if (!m) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='${d}'/></svg>`
    m = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    maskCache.set(key, m)
  }
  return m
}

function Accessory({ kind, x, top }: { kind: Accessory; x: number; top: number }) {
  if (kind === 'none') return null
  // Each accessory lives in its own little 20 × 20 box whose bottom-centre is
  // planted just inside the top of the head, so it can sway on its own layer.
  const style = { left: `${f(50 + x - 10)}%`, top: `${f(top - 17)}%` } as CSSProperties
  return (
    <span className="buddy-acc" style={style}>
      <svg viewBox="0 0 20 20" width="100%" height="100%" overflow="visible">
        {kind === 'sprout' && (
          <g>
            <path d="M10 20 C10 16 10.3 13 10.8 10.5" className="bd-stalk" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            <path d="M10.6 11.6 C7.6 12.4 4.4 11 3.4 7.6 C6.8 6.6 9.8 8 10.6 11.6Z" className="bd-leaf" />
            <path d="M10.9 10.4 C11.6 7.4 14.4 5.2 17.8 5.6 C17.4 9 14.6 11 10.9 10.4Z" className="bd-leaf bd-leaf-2" />
          </g>
        )}
        {kind === 'tuft' && (
          <path
            d="M7.2 20 C6.4 15.6 7.6 11.6 11.4 9 C13.6 7.5 15.6 7.6 16.4 6.2 C17 9.6 15.6 12.4 13.4 14 C12.2 15 12.4 17.6 13 20Z"
            className="bd-tuft"
          />
        )}
        {kind === 'antenna' && (
          <g>
            <path d="M10 20 C10 15.5 10.4 12.5 11 9.6" className="bd-stalk" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <circle cx="11.2" cy="7.2" r="3.2" className="bd-bulb" />
            <circle cx="10.2" cy="6.1" r="1" className="bd-bulb-shine" />
          </g>
        )}
      </svg>
    </span>
  )
}

/** The body: one gradient fill, then a filter that bakes in soft volume
 *  (bottom-right core shadow, upper-left rim light, light bounced up off the
 *  floor) and a gentle specular sheen. Painted once; never repaints while the
 *  layers above it animate. */
function BuddyBody({ id, d, t, top }: { id: string; d: string; t: Traits; top: number }) {
  const sx = 50 - t.w * 0.16
  const sy = top + t.h * 0.19
  return (
    <svg className="buddy-body" viewBox="0 0 100 100" width="100%" height="100%" overflow="visible">
      <defs>
        <path id={`${id}p`} d={d} />
        <clipPath id={`${id}c`}>
          <use href={`#${id}p`} />
        </clipPath>
        <radialGradient id={`${id}base`} cx="0.36" cy="0.14" r="1.02" fx="0.34" fy="0.08">
          <stop offset="0" className="bd-hi" />
          <stop offset="0.52" className="bd-mid" />
          <stop offset="1" className="bd-lo" />
        </radialGradient>
        <radialGradient id={`${id}spec`}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter
          id={`${id}v`}
          x="-5"
          y="-5"
          width="110"
          height="110"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceAlpha" stdDeviation="7.5" result="b1" />
          <feOffset in="b1" dx="-5" dy="-7" result="o1" />
          <feComposite in="SourceAlpha" in2="o1" operator="out" result="r1" />
          <feFlood className="bd-f-shade" result="c1" />
          <feComposite in="c1" in2="r1" operator="in" result="shade" />
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.8" result="b3" />
          <feOffset in="b3" dx="-0.4" dy="-2.6" result="o3" />
          <feComposite in="SourceAlpha" in2="o3" operator="out" result="r3" />
          <feFlood className="bd-f-bounce" result="c3" />
          <feComposite in="c3" in2="r3" operator="in" result="bounce" />
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.8" result="b2" />
          <feOffset in="b2" dx="1.6" dy="2.6" result="o2" />
          <feComposite in="SourceAlpha" in2="o2" operator="out" result="r2" />
          <feFlood className="bd-f-rim" result="c2" />
          <feComposite in="c2" in2="r2" operator="in" result="rim" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="shade" />
            <feMergeNode in="bounce" />
            <feMergeNode in="rim" />
          </feMerge>
        </filter>
      </defs>
      <use href={`#${id}p`} fill={`url(#${id}base)`} filter={`url(#${id}v)`} />
      <g clipPath={`url(#${id}c)`}>
        <ellipse
          className="bd-spec"
          cx={f(sx)}
          cy={f(sy)}
          rx={f(t.w * 0.3)}
          ry={f(t.h * 0.17)}
          transform={`rotate(-30 ${f(sx)} ${f(sy)})`}
          fill={`url(#${id}spec)`}
        />
      </g>
    </svg>
  )
}

export function Buddy({ hue, size = 44, state = 'idle', seed = '', className, label }: Props) {
  // Remember where we came from (not on mount), so CSS can play a one-off
  // transition moment: settling back to idle, waking up, perking up.
  const [track, setTrack] = useState<{ state: BuddyState; from?: BuddyState }>({ state })
  if (track.state !== state) setTrack({ state, from: track.state })
  const raw = useId()
  const id = 'bd' + raw.replace(/[^a-zA-Z0-9_-]/g, '')
  const t = traitsFor(seed)
  const tiny = size < 24
  const d = useMemo(() => bodyPath(t, tiny), [t, tiny])

  const top = FLOOR - t.h
  const ew = t.w * 0.102 * t.eyeScale
  const eh = ew * 1.85
  // Under 24px the eyes would vanish: give them a 2px × 4px floor.
  const ewPx = Math.max((ew / 100) * size, tiny ? 2.2 : 1.6)
  const ehPx = Math.max((eh / 100) * size, tiny ? 4.2 : 3)
  const eyeW = (ewPx / size) * 100
  const eyeH = (ehPx / size) * 100
  const eyeCy = top + t.h * t.eyeY
  const gap = t.w * t.eyeGap
  const eye = (cx: number) =>
    ({ left: `${f(cx - eyeW / 2)}%`, top: `${f(eyeCy - eyeH / 2)}%`, width: `${f(eyeW)}%`, height: `${f(eyeH)}%` }) as CSSProperties
  const cheek = (cx: number) =>
    ({ left: `${f(cx - 7)}%`, top: `${f(eyeCy + eyeH * 0.55)}%`, width: '14%', height: '8%' }) as CSSProperties

  const style = {
    '--s': `${size}px`,
    '--h': hue,
    '--bd-tilt': `${f(t.tilt)}deg`,
    '--bd-side': t.side,
    '--bd-breath': `${f(t.breath)}s`,
    '--bd-blink': `${f(t.blink)}s`,
    '--bd-glance': `${f(t.glance)}s`,
    '--bd-delay': `${f(-t.phase * 10)}s`,
    '--bd-w': `${f(t.w)}%`,
    '--bd-top': `${f(top)}%`,
    '--bd-mid': `${f(top + t.h * 0.52)}%`,
    '--bd-mask': maskFor(`${seed}|${tiny}`, d),
  } as CSSProperties

  const size_ = size < 24 ? 'xs' : size < 40 ? 'sm' : size >= 80 ? 'lg' : 'md'

  return (
    <span
      className={cn('buddy', className)}
      data-state={state}
      data-from={track.from}
      data-size={size_}
      data-acc={t.acc}
      data-rosy={t.rosy || undefined}
      data-blink={t.doubleBlink ? 'double' : undefined}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="buddy-glow" />
      <span className="buddy-shadow" />
      <span className="buddy-pose">
        <span className="buddy-act">
          <span className="buddy-breath">
            {!tiny && <Accessory kind={t.acc} x={t.accX} top={top} />}
            <BuddyBody id={id} d={d} t={t} top={top} />
            <span className="buddy-sheen">
              <span />
            </span>
            <span className="buddy-cheek" style={cheek(50 - gap / 2 - eyeW * 0.6)} />
            <span className="buddy-cheek" style={cheek(50 + gap / 2 + eyeW * 0.6)} />
            <span className="buddy-face">
              <span className="buddy-look">
                <span className="buddy-eye buddy-eye-l" style={eye(50 - gap / 2)}>
                  <span className="buddy-blink">
                    <span className="buddy-pill" />
                    <span className="buddy-arc" />
                  </span>
                </span>
                <span className="buddy-eye buddy-eye-r" style={eye(50 + gap / 2)}>
                  <span className="buddy-blink">
                    <span className="buddy-pill" />
                    <span className="buddy-arc" />
                  </span>
                </span>
              </span>
            </span>
          </span>
        </span>
      </span>
    </span>
  )
}

// ── Groups ───────────────────────────────────────────────────────────────────
// Buddies in a group lean on one another. Leaning and gazing are driven by two
// inherited custom properties, so Buddy keeps the Orb's exact props:
//   --bd-lean    extra rotation about the feet (deg; + leans right)
//   --bd-gaze-x  extra eye shift (fraction of the buddy's size; + looks right)

type Slot = { left: number; top: number; size: number; lean: number; gaze: number; z: number }

function stackSlots(n: number, size: number): Slot[] {
  if (n === 2) {
    // Two halves of the "m", like the mark: shoulder to shoulder, side by side
    // (not one in front of the other), heads tipped together.
    const b = size * 0.78
    const top = size / 2 - b * 0.5
    return [
      { left: size / 2 - b * 0.296 - b / 2, top, size: b, lean: 3, gaze: 0.035, z: 1 },
      { left: size / 2 + b * 0.296 - b / 2, top, size: b, lean: -3, gaze: -0.035, z: 2 },
    ]
  }
  // Three: two peek over the shoulders of the one in front. The front one's
  // head sits just below the others' eyes, so all three faces read even at 40px.
  const back = size * 0.54
  const front = size * 0.64
  const top = size * 0.085
  return [
    { left: size * 0.29 - back / 2, top, size: back, lean: 3, gaze: 0.03, z: 1 },
    { left: size * 0.71 - back / 2, top, size: back, lean: -3, gaze: -0.03, z: 1 },
    { left: size / 2 - front / 2, top: top + size * 0.193, size: front, lean: 0, gaze: 0, z: 2 },
  ]
}

/** A small cluster for group chats: two buddies make the "m", three huddle. */
export function BuddyStack({
  hues,
  size = 44,
  seeds = [],
  states = [],
}: {
  hues: number[]
  size?: number
  seeds?: string[]
  /** Optional per-member state, same order as `hues`. */
  states?: BuddyState[]
}) {
  const shown = hues.slice(0, 3)
  if (shown.length < 2) {
    return <Buddy hue={shown[0] ?? 278} size={size} seed={seeds[0]} state={states[0]} />
  }
  const slots = stackSlots(shown.length, size)
  return (
    <span className="buddy-group" style={{ width: size, height: size }} aria-hidden>
      {shown.map((hue, i) => {
        const s = slots[i]
        const style = {
          left: s.left,
          top: s.top,
          zIndex: s.z,
          '--bd-lean': `${s.lean}deg`,
          '--bd-gaze-x': s.gaze,
        } as CSSProperties
        return (
          <span key={i} className="buddy-slot" style={style}>
            <Buddy hue={hue} size={Math.round(s.size)} seed={seeds[i] ?? String(i)} state={states[i]} />
          </span>
        )
      })}
    </span>
  )
}

export type BuddyMember = { hue: number; seed?: string; state?: BuddyState; label?: string }

/**
 * A group header row. Whoever has the floor perks up (grows, takes the
 * `speaking` state unless told otherwise); everyone else relaxes a touch and
 * leans and looks toward them. Changing `speaking` springs between poses.
 */
export function BuddyRow({
  members,
  speaking,
  size = 36,
  className,
}: {
  members: BuddyMember[]
  /** Index of the member who has the floor, if anyone. */
  speaking?: number
  size?: number
  className?: string
}) {
  const has = speaking !== undefined && speaking >= 0 && speaking < members.length
  return (
    <span className={cn('buddy-row', className)} style={{ height: size }}>
      {members.map((m, i) => {
        const me = has && i === speaking
        const dir = !has || me ? 0 : i < speaking! ? 1 : -1
        const style = {
          width: size * 0.7,
          height: size,
          zIndex: me ? 3 : 1,
          '--bd-lean': `${dir * 6}deg`,
          '--bd-gaze-x': dir * 0.045,
          '--bd-row-scale': me ? 1.12 : has ? 0.92 : 1,
        } as CSSProperties
        return (
          <span
            key={m.seed ?? i}
            className="buddy-row-slot"
            data-floor={me || undefined}
            data-seed={m.seed}
            style={style}
          >
            <Buddy
              hue={m.hue}
              size={size}
              seed={m.seed ?? String(i)}
              state={m.state ?? (me ? 'speaking' : 'idle')}
              label={m.label}
            />
          </span>
        )
      })}
    </span>
  )
}
