import { useId, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { cn } from '@/lib/cn'
import './icons.css'

// Murmur's own icons, for the places that say what Murmur is: an agent's
// tiles, Settings' rows, the sheets that explain a feature. Utility chrome
// (chevrons, close, send, copy) stays Lucide: crisp and out of the way.
//
// Drawn by hand on a 24-unit grid with a 2-unit margin. Each is two layers of
// currentColor, the way the Buddies are lit: a soft body (.mi-tint, a low
// opacity fill that rises a little in dark mode) under a round-capped line,
// plus the odd solid detail (an eye, a light, a ribbon). So one colour themes
// it: the agent's hue, ink, or white on a chip. Corners are generous on
// purpose; nothing here has a sharp edge a Buddy wouldn't.

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  size?: number
  /** Names it for screen readers; without one it's decoration. */
  title?: string
}

/**
 * The stroke keeps its optical weight across sizes: ~1.7px at 20, 1.8 at 24,
 * 1.9 at 28, so a small row icon doesn't go thin and a big tile doesn't go heavy.
 */
const strokeFor = (size: number) => (24 / size) * (1.26 + size * 0.0222)

function Icon({ size = 24, title, className, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeFor(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn('mi', className)}
      {...rest}
    >
      {children}
    </svg>
  )
}

/** A gap cut around a solid detail, so it reads on top of the body without an outline of its own. */
function useCut() {
  return `mi${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
}

/**
 * An icon on a small lit chip of the agent's colour, the way the Buddies are
 * lit: from the upper left. It sits beside real app icons (Umbrel's, Murmur's
 * own, Telegram's) as one of them. Corners default to the app-icon
 * proportion; `radius` matches a neighbour's, like the Apps folder.
 */
export function IconChip({
  icon: Glyph,
  size = 29,
  radius = Math.round(size * 0.25),
  className,
}: {
  icon: ComponentType<IconProps>
  size?: number
  radius?: number
  className?: string
}) {
  return (
    <span aria-hidden className={cn('mi-chip', className)} style={{ width: size, height: size, borderRadius: radius }}>
      <Glyph size={Math.round(size * 0.64)} />
    </span>
  )
}

// ── Agent ────────────────────────────────────────────────────────────────────

/** A Buddy's arch on the 24 grid: shoulders, a soft foot notch, rounded heels. */
const buddy = (cx: number, top: number, bottom: number, w: number) => {
  const l = cx - w / 2
  const r = cx + w / 2
  const s = top + w * 0.58
  const k = w * 0.5 * 0.56
  const n = Math.max(0.9, w * 0.1)
  const d = n + Math.max(0.8, w * 0.1)
  const f = (v: number) => Math.round(v * 100) / 100
  return [
    `M${f(l)} ${f(s)}`,
    `C${f(l)} ${f(s - (s - top) * 0.9)} ${f(cx - k)} ${f(top)} ${f(cx)} ${f(top)}`,
    `C${f(cx + k)} ${f(top)} ${f(r)} ${f(s - (s - top) * 0.9)} ${f(r)} ${f(s)}`,
    `V${f(bottom - 2)}`,
    `Q${f(r)} ${f(bottom)} ${f(r - 2)} ${f(bottom)}`,
    `H${f(cx + n)}`,
    `V${f(bottom - d + n)}`,
    `A${f(n)} ${f(n)} 0 0 0 ${f(cx - n)} ${f(bottom - d + n)}`,
    `V${f(bottom)}`,
    `H${f(l + 2)}`,
    `Q${f(l)} ${f(bottom)} ${f(l)} ${f(bottom - 2)}`,
    'Z',
  ].join('')
}

/** Two pill eyes, a Buddy's whole face. */
function Eyes({ cx, y, gap = 3.2, h = 2.6 }: { cx: number; y: number; gap?: number; h?: number }) {
  return (
    <g className="mi-solid">
      <rect x={cx - gap / 2 - 0.8} y={y} width={1.6} height={h} rx={0.8} />
      <rect x={cx + gap / 2 - 0.8} y={y} width={1.6} height={h} rx={0.8} />
    </g>
  )
}

/** Edit an agent: its look, not a pencil. A Buddy with a two-tone swatch at its heel, the way an appearance setting looks. */
export function LookIcon(props: IconProps) {
  const id = useCut()
  return (
    <Icon {...props}>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" />
        <circle cx="17.75" cy="17.5" r="5.6" fill="#000" />
      </mask>
      <g mask={`url(#${id})`}>
        <path className="mi-tint" d={buddy(10.5, 3.75, 20.25, 14)} />
        <path d={buddy(10.5, 3.75, 20.25, 14)} />
      </g>
      <Eyes cx={10.5} y={9.25} gap={3.6} />
      <circle className="mi-tint" cx="17.75" cy="17.5" r="3.75" />
      <path className="mi-solid" d="M20.4 14.85a3.75 3.75 0 0 1-5.3 5.3Z" />
      <circle cx="17.75" cy="17.5" r="3.75" />
    </Icon>
  )
}

/** Agents: two Buddies, one a step behind the other. */
export function AgentsIcon(props: IconProps) {
  const id = useCut()
  const front = buddy(9, 7.5, 21, 12)
  const back = buddy(16, 3, 16.75, 10.5)
  return (
    <Icon {...props}>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" />
        <path d={front} fill="#000" stroke="#000" strokeWidth="4" />
      </mask>
      <g mask={`url(#${id})`}>
        <path className="mi-tint" d={back} />
        <path d={back} />
        <Eyes cx={17.6} y={7} gap={2.7} h={2.2} />
      </g>
      <path className="mi-tint" d={front} />
      <path d={front} />
      <Eyes cx={9} y={12.25} gap={3.2} h={2.4} />
    </Icon>
  )
}

/** A new agent: a Buddy with a plus beside it. */
export function AgentAddIcon(props: IconProps) {
  const id = useCut()
  return (
    <Icon {...props}>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" />
        <circle cx="18.25" cy="17.25" r="5.25" fill="#000" />
      </mask>
      <g mask={`url(#${id})`}>
        <path className="mi-tint" d={buddy(10.5, 3.75, 20.25, 13)} />
        <path d={buddy(10.5, 3.75, 20.25, 13)} />
      </g>
      <Eyes cx={10.5} y={9.25} gap={3.4} />
      <path d="M18.25 14.25v6M15.25 17.25h6" />
    </Icon>
  )
}

/** Its own bot (Telegram): a Buddy with the little antenna some of them grow. */
export function BotIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path className="mi-tint" d={buddy(12, 6.75, 21, 14)} />
      <path d={buddy(12, 6.75, 21, 14)} />
      <path d="M12 6.75V4.5" />
      <circle className="mi-solid" cx="12" cy="3.25" r="1.6" />
      <Eyes cx={12} y={12} gap={3.8} />
    </Icon>
  )
}

// ── What an agent does ───────────────────────────────────────────────────────

/** Routines: a little alarm clock on its feet, bells for ears. Things that happen on time. */
export function RoutinesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle className="mi-tint" cx="12" cy="13" r="7.25" />
      <circle cx="12" cy="13" r="7.25" />
      <path className="mi-solid" d="M3.66 8.54A2.6 2.6 0 0 1 7.54 4.66Z" stroke="currentColor" strokeWidth="0.6" />
      <path className="mi-solid" d="M20.34 8.54A2.6 2.6 0 0 0 16.46 4.66Z" stroke="currentColor" strokeWidth="0.6" />
      <path d="M12 9.75V13l2.25 1.5" />
      <path d="M7.4 18.75 6.25 20.25M16.6 18.75l1.15 1.5" />
    </Icon>
  )
}

/** Memory: a notebook it keeps about you, with a ribbon holding its place. */
export function MemoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect className="mi-tint" x="4.75" y="3" width="14.5" height="18" rx="3" />
      <rect x="4.75" y="3" width="14.5" height="18" rx="3" />
      <path d="M8.5 3.5v17" />
      <path className="mi-solid" d="M12.75 2.25h3.5v8.6a.4.4 0 0 1-.64.32L14.5 10.3l-1.11.87a.4.4 0 0 1-.64-.32Z" />
    </Icon>
  )
}

/** Apps: a few blocks of different shapes, one of them still to add. */
export function AppsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect className="mi-tint" x="3.75" y="3.75" width="7" height="7" rx="2.25" />
      <rect x="3.75" y="3.75" width="7" height="7" rx="2.25" />
      <circle className="mi-tint" cx="16.75" cy="7.25" r="3.5" />
      <circle cx="16.75" cy="7.25" r="3.5" />
      <rect className="mi-tint" x="3.75" y="13.25" width="7" height="7" rx="3.5" />
      <rect x="3.75" y="13.25" width="7" height="7" rx="3.5" />
      <path d="M16.75 13.75v6M13.75 16.75h6" />
    </Icon>
  )
}

/** Something it says: a speech bubble with a Buddy's eyes in it. */
export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        className="mi-tint"
        d="M12 4c4.7 0 8.25 3.03 8.25 7.1s-3.55 7.1-8.25 7.1c-.86 0-1.69-.1-2.46-.3L5.5 20l.68-3.78C4.66 14.97 3.75 13.1 3.75 11.1 3.75 7.03 7.3 4 12 4Z"
      />
      <path d="M12 4c4.7 0 8.25 3.03 8.25 7.1s-3.55 7.1-8.25 7.1c-.86 0-1.69-.1-2.46-.3L5.5 20l.68-3.78C4.66 14.97 3.75 13.1 3.75 11.1 3.75 7.03 7.3 4 12 4Z" />
      <Eyes cx={12} y={9.6} gap={3.6} />
    </Icon>
  )
}

// ── Where it runs ────────────────────────────────────────────────────────────

/** Models: the crystal ball it thinks with, lit from the upper left like a Buddy. */
export function ModelsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle className="mi-tint" cx="12" cy="10" r="7" />
      <circle cx="12" cy="10" r="7" />
      <path d="M8.5 9.25a3.75 3.75 0 0 1 2.75-2.75" />
      <path className="mi-tint" d="M8.25 18.5h7.5l1.25 2.25H7Z" />
      <path d="M8.25 18.5h7.5l1.25 2.25H7Z" />
    </Icon>
  )
}

/** Where Hermes runs: a small, soft home server with its light on. */
export function ServerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect className="mi-tint" x="3.5" y="5" width="17" height="14" rx="4.5" />
      <rect x="3.5" y="5" width="17" height="14" rx="4.5" />
      <path d="M3.75 12h16.5" />
      <circle className="mi-solid" cx="7.75" cy="15.5" r="1.15" />
      <circle className="mi-solid" cx="7.75" cy="8.5" r="1.15" />
    </Icon>
  )
}

/** This computer. */
export function ComputerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect className="mi-tint" x="3" y="4.25" width="18" height="12.5" rx="3" />
      <rect x="3" y="4.25" width="18" height="12.5" rx="3" />
      <path d="M12 16.75v3.25M8.75 20h6.5" />
    </Icon>
  )
}

/** An API key. */
export function KeyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle className="mi-tint" cx="8" cy="12" r="4.75" />
      <circle cx="8" cy="12" r="4.75" />
      <circle className="mi-solid" cx="7.25" cy="12" r="1.25" />
      <path d="M12.75 12h7.5v2.75M17 12v2" />
    </Icon>
  )
}

/** Private: only you. */
export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <rect className="mi-tint" x="4.75" y="10.5" width="14.5" height="10.25" rx="3.25" />
      <rect x="4.75" y="10.5" width="14.5" height="10.25" rx="3.25" />
      <rect className="mi-solid" x="11.1" y="13.75" width="1.8" height="3.75" rx=".9" />
    </Icon>
  )
}

// ── Settings ─────────────────────────────────────────────────────────────────

/** Notifications: a soft bell. */
export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        className="mi-tint"
        d="M12 3.75a6 6 0 0 1 6 6v3.6c0 .7.25 1.38.7 1.92l.62.74c.55.65.09 1.64-.76 1.64H5.44c-.85 0-1.31-.99-.76-1.64l.62-.74c.45-.54.7-1.22.7-1.92v-3.6a6 6 0 0 1 6-6Z"
      />
      <path d="M12 3.75a6 6 0 0 1 6 6v3.6c0 .7.25 1.38.7 1.92l.62.74c.55.65.09 1.64-.76 1.64H5.44c-.85 0-1.31-.99-.76-1.64l.62-.74c.45-.54.7-1.22.7-1.92v-3.6a6 6 0 0 1 6-6Z" />
      <path className="mi-solid" d="M9.75 19.5h4.5a2.25 2.25 0 0 1-4.5 0Z" />
    </Icon>
  )
}

/** Pictures: a photo, its sun and its hills. */
export function PicturesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect className="mi-tint" x="3.5" y="4.5" width="17" height="15" rx="3.5" />
      <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
      <circle className="mi-solid" cx="9" cy="9.75" r="1.75" />
      <path d="m4 17.25 4.4-3.9a1 1 0 0 1 1.3-.02l2.55 2.17 2.3-1.9a1 1 0 0 1 1.27 0l4.18 3.55" />
    </Icon>
  )
}

/** Sign out: through the door. */
export function SignOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path className="mi-tint" d="M7.5 4H13v16H7.5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" />
      <path d="M13 4H7.5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3H13" />
      <path d="M10.5 12h9.5M17 8.75 20.25 12 17 15.25" />
    </Icon>
  )
}

/** Bring one in: a tray with an arrow landing in it. */
export function ImportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path className="mi-tint" d="M3.75 13.5h4.1l1.4 2.25h5.5l1.4-2.25h4.1V17a3 3 0 0 1-3 3H6.75a3 3 0 0 1-3-3Z" />
      <path d="M3.75 13.5h4.1l1.4 2.25h5.5l1.4-2.25h4.1V17a3 3 0 0 1-3 3H6.75a3 3 0 0 1-3-3Z" />
      <path d="M12 3.75v8.5M8.75 9 12 12.25 15.25 9" />
    </Icon>
  )
}

/** A local model's chip. */
export function ChipIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect className="mi-tint" x="5.5" y="5.5" width="13" height="13" rx="3.25" />
      <rect x="5.5" y="5.5" width="13" height="13" rx="3.25" />
      <rect className="mi-solid" x="9.5" y="9.5" width="5" height="5" rx="1.25" />
      <path d="M9.5 2.75v2.5M14.5 2.75v2.5M9.5 18.75v2.5M14.5 18.75v2.5M2.75 9.5h2.5M2.75 14.5h2.5M18.75 9.5h2.5M18.75 14.5h2.5" />
    </Icon>
  )
}

/** A phone of its own (WhatsApp's spare number). */
export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect className="mi-tint" x="6" y="2.75" width="12" height="18.5" rx="3.25" />
      <rect x="6" y="2.75" width="12" height="18.5" rx="3.25" />
      <path d="M10.5 18h3" />
    </Icon>
  )
}

/** You: a person's shoulders and head, in the same soft hand. */
export function PersonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle className="mi-tint" cx="12" cy="8.25" r="4" />
      <circle cx="12" cy="8.25" r="4" />
      <path
        className="mi-tint"
        d="M4.75 19.25c0-3.3 3.25-5.5 7.25-5.5s7.25 2.2 7.25 5.5a1 1 0 0 1-1 1H5.75a1 1 0 0 1-1-1Z"
      />
      <path d="M4.75 19.25c0-3.3 3.25-5.5 7.25-5.5s7.25 2.2 7.25 5.5a1 1 0 0 1-1 1H5.75a1 1 0 0 1-1-1Z" />
    </Icon>
  )
}
