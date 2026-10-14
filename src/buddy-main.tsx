// Dev-only design review for the Buddy avatar: /buddy.html
import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUp, ChevronLeft, Dices, Pause, Play, Plus } from 'lucide-react'
import { Buddy, BuddyRow, BuddyStack, type BuddyState } from '@/ui/buddy'
import { Orb } from '@/ui/orb'
import { Segmented } from '@/ui/segmented'
import { Toggle } from '@/ui/toggle'
import { HUES } from '@/lib/hues'
import { cn } from '@/lib/cn'
import { BRAND, ByUmbrel, MurmurMark, MurmurWordmark } from '@/ui/brand'
import './styles.css'

const STATES: { value: BuddyState; label: string; hint: string }[] = [
  { value: 'idle', label: 'Idle', hint: 'Breathes, blinks, looks around' },
  { value: 'listening', label: 'Listening', hint: 'Leans in, eyes on the composer' },
  { value: 'thinking', label: 'Thinking', hint: 'Eyes up, gentle sway, inner light' },
  { value: 'working', label: 'Working', hint: 'Busy hops, eyes scanning' },
  { value: 'waiting', label: 'Needs you', hint: 'Perks up, warm glow, “hey!”' },
  { value: 'speaking', label: 'Speaking', hint: 'Murmurs in syllables' },
  { value: 'done', label: 'Done', hint: 'Happy eyes, a joyful hop' },
  { value: 'error', label: 'Error', hint: 'Flat, worried eyes, slumps' },
  { value: 'offline', label: 'Offline', hint: 'Grey and fast asleep' },
]

const AGENTS = [
  { name: 'Atlas', hue: 278, seed: 'atlas' },
  { name: 'Juniper', hue: 28, seed: 'juniper' },
  { name: 'Wren', hue: 192, seed: 'wren' },
  { name: 'Nova', hue: 250, seed: 'nova' },
  { name: 'Pip', hue: 82, seed: 'pip' },
  { name: 'Sage', hue: 160, seed: 'sage' },
  { name: 'Milo', hue: 338, seed: 'milo' },
  { name: 'Iris', hue: 128, seed: 'iris' },
]

type Theme = 'system' | 'light' | 'dark'

function Section({ title, kicker, children, className }: { title: string; kicker?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mt-20', className)}>
      <div className="mb-6">
        {kicker && <p className="text-caption font-semibold tracking-[0.08em] text-ink-3 uppercase">{kicker}</p>}
        <h2 className="mt-1 text-title font-semibold tracking-[-0.02em]">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl bg-elevated shadow-[0_0_0_0.5px_var(--line-strong)]', className)}>{children}</div>
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'pressable h-8 rounded-full px-3.5 text-footnote font-medium transition-colors duration-150',
        active ? 'bg-ink text-bg' : 'bg-fill-2 text-ink-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function useFps(on: boolean) {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    if (!on) return
    let raf = 0
    let frames = 0
    let last = performance.now()
    const tick = (now: number) => {
      frames++
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)))
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [on])
  return fps
}

function Phone({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div>
      <p className="mb-3 text-footnote font-medium text-ink-3">{label}</p>
      <div className="overflow-hidden rounded-[32px] bg-bg shadow-[0_0_0_0.5px_var(--line-strong),0_24px_60px_-24px_hsl(var(--shadow-color)/0.35)]">
        {children}
      </div>
    </div>
  )
}

function Roster() {
  const rows: { lead: ReactNode; name: string; sub: string; live?: boolean; time: string; badge?: boolean }[] = [
    { lead: <Buddy hue={28} size={52} seed="juniper" state="waiting" />, name: 'Juniper', sub: 'Needs you · Add the dentist to Calendar?', time: 'now', badge: true },
    { lead: <Buddy hue={278} size={52} seed="atlas" state="working" />, name: 'Atlas', sub: 'Searching the web', live: true, time: 'now' },
    { lead: <BuddyStack hues={[278, 28]} seeds={['atlas', 'juniper']} size={52} />, name: 'Weekend plan', sub: 'Juniper: Saturday works for both of us', time: '9:41' },
    { lead: <Buddy hue={192} size={52} seed="wren" state="idle" />, name: 'Wren', sub: 'Sure, I’ll draft it tonight.', time: '9:12' },
    { lead: <BuddyStack hues={[160, 250, 338]} seeds={['sage', 'nova', 'milo']} size={52} />, name: 'Studio crew', sub: 'Milo: Pushed the new cut', time: 'Tue' },
    { lead: <Buddy hue={82} size={52} seed="pip" state="offline" />, name: 'Pip', sub: 'Asleep', time: 'Mon' },
  ]
  return (
    <div className="px-4 pt-5 pb-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-large font-bold tracking-[-0.03em]">Chats</h3>
        <span className="flex size-9 items-center justify-center rounded-full bg-fill-2 text-ink-2">
          <Plus size={20} strokeWidth={2} />
        </span>
      </div>
      <ul className="mt-3">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-3 rounded-xl px-1 py-2.5">
            {r.lead}
            <div className="min-w-0 flex-1 border-b border-line pb-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-body font-semibold tracking-[-0.01em]">{r.name}</span>
                <span className="text-caption text-ink-3">{r.time}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('truncate text-footnote', r.live ? 'text-shimmer' : 'text-ink-2')}>{r.sub}</span>
                {r.badge && <span className="ml-auto size-2.5 flex-none rounded-full bg-warning" />}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChatMock({ state }: { state: BuddyState }) {
  const subtitle: Record<BuddyState, string> = {
    idle: 'Online',
    listening: 'Listening',
    thinking: 'Thinking…',
    working: 'Reading notes.md',
    waiting: 'Needs you',
    speaking: 'Speaking',
    done: 'Done',
    error: 'Couldn’t finish',
    offline: 'Asleep',
  }
  return (
    <div className="hue-scope flex h-[560px] flex-col" style={{ ['--hue' as string]: 278 }}>
      <div className="flex items-center gap-1 border-b border-line px-2 py-2">
        <ChevronLeft size={26} className="text-accent" />
        <Buddy hue={278} size={34} seed="atlas" state={state} />
        <div className="ml-2 min-w-0">
          <p className="text-subhead leading-5 font-semibold">Atlas</p>
          <p className={cn('text-caption', state === 'idle' || state === 'offline' ? 'text-ink-3' : 'text-accent')}>
            {subtitle[state]}
          </p>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-3 px-4 py-4">
        <div className="ml-auto max-w-[75%] rounded-[20px] bg-user-bubble px-3.5 py-2 text-body">
          Can you find a quiet café near the office for Friday?
        </div>
        <div className="flex gap-2.5">
          <Buddy hue={278} size={20} seed="atlas" state={state} className="mt-0.5" />
          <div className="max-w-[80%] text-body text-ink">
            Three good options within a 5 minute walk. Mornings are calmest at <b>Fold</b>; it has big tables and decent Wi‑Fi.
          </div>
        </div>
      </div>
      <div className="px-3 pb-4">
        <div className="flex items-center gap-2 rounded-full bg-fill-2 py-1.5 pr-1.5 pl-4 text-body text-ink-3">
          Message Atlas
          <span className="ml-auto flex size-8 items-center justify-center rounded-full bg-accent text-accent-ink">
            <ArrowUp size={18} strokeWidth={2.4} />
          </span>
        </div>
      </div>
    </div>
  )
}

function GroupMock() {
  const members = [
    { hue: 278, seed: 'atlas', name: 'Atlas' },
    { hue: 28, seed: 'juniper', name: 'Juniper' },
    { hue: 192, seed: 'wren', name: 'Wren' },
  ]
  const [speaker, setSpeaker] = useState(1)
  useEffect(() => {
    const id = setInterval(() => setSpeaker((s) => (s + 1) % 4), 2600)
    return () => clearInterval(id)
  }, [])
  const sp = speaker === 3 ? undefined : speaker
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-2.5">
        <ChevronLeft size={26} className="text-accent" />
        <BuddyStack hues={[278, 28]} seeds={['atlas', 'juniper']} size={40} />
        <div className="ml-2">
          <p className="text-subhead leading-5 font-semibold">Weekend plan</p>
          <p className="text-caption text-ink-3">Atlas, Juniper</p>
        </div>
      </div>
      <div className="flex items-center gap-1 border-b border-line px-2 py-2.5">
        <ChevronLeft size={26} className="text-accent" />
        <BuddyStack hues={[160, 250, 338]} seeds={['sage', 'nova', 'milo']} size={40} />
        <div className="ml-2">
          <p className="text-subhead leading-5 font-semibold">Studio crew</p>
          <p className="text-caption text-ink-3">Sage, Nova, Milo</p>
        </div>
      </div>
      <div className="flex flex-col items-center border-b border-line px-4 pt-6 pb-4">
        <BuddyRow members={members.map((m) => ({ hue: m.hue, seed: m.seed, label: m.name }))} speaking={sp} size={48} />
        <p className="mt-3 text-subhead font-semibold">Trip crew</p>
        <p className="h-4 text-caption text-ink-3">{sp === undefined ? 'Everyone’s here' : `${members[sp].name} is replying…`}</p>
      </div>
      <div className="px-4 py-4 text-footnote text-ink-3">
        Group header (BuddyRow): whoever has the floor perks up and talks; the others lean in and look at them.
      </div>
    </div>
  )
}

function EmptyMock({ state }: { state: BuddyState }) {
  return (
    <div className="flex h-[560px] flex-col items-center justify-center px-8 text-center">
      <Buddy hue={278} size={112} seed="atlas" state={state} />
      <p className="mt-5 text-title font-semibold tracking-[-0.02em]">Hi, I’m Atlas</p>
      <p className="mt-1.5 text-subhead text-ink-2">I can look things up, plan your week and keep notes. What’s on your mind?</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {['Plan my Saturday', 'Summarise my notes', 'Find a recipe'].map((s) => (
          <span key={s} className="rounded-full bg-fill-2 px-3.5 py-2 text-footnote font-medium text-ink-2">
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}

const SWATCHES = [
  { name: 'Violet', hex: BRAND.violet, oklch: 'oklch(0.658 0.18 296)', role: 'The left buddy. Brand primary.' },
  { name: 'Coral', hex: BRAND.coral, oklch: 'oklch(0.764 0.136 21)', role: 'The right buddy. Warmth.' },
  { name: 'Cream', hex: BRAND.cream, oklch: 'oklch(0.985 0.018 93)', role: 'Icon ground. Paper.' },
  { name: 'Ink', hex: BRAND.ink, oklch: 'oklch(0.2 0.025 305)', role: 'Wordmark, eyes, type.' },
  { name: 'Night', hex: BRAND.night, oklch: 'oklch(0.18 0.018 305)', role: 'Dark icon ground.' },
]

function HomeTile({ size, dark }: { size: number; dark?: boolean }) {
  return (
    <span className="inline-flex flex-col items-center gap-1.5">
      <span
        className="block overflow-hidden"
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.2237,
          boxShadow: dark ? '0 0 0 0.5px rgb(255 255 255 / 0.08)' : '0 0 0 0.5px rgb(0 0 0 / 0.06), 0 2px 8px -2px rgb(0 0 0 / 0.12)',
        }}
      >
        <MurmurMark tile size={size} theme={dark ? 'dark' : 'light'} />
      </span>
      {size >= 56 && <span className={cn('text-caption', dark ? 'text-white/80' : 'text-black/70')}>Murmur</span>}
    </span>
  )
}

function Brand() {
  return (
    <Section kicker="Brand" title="The mark, the word, the family">
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Card className="flex flex-col items-center justify-center gap-8 overflow-hidden py-12" >
          <div className="flex items-end gap-6">
            <span className="block overflow-hidden rounded-[22.37%] shadow-[0_0_0_0.5px_rgb(0_0_0/0.06),0_24px_48px_-20px_rgb(80_50_20/0.35)]">
              <MurmurMark tile size={220} theme="light" />
            </span>
            <span className="block overflow-hidden rounded-[22.37%] shadow-[0_0_0_0.5px_rgb(255_255_255/0.06),0_24px_48px_-20px_rgb(0_0_0/0.5)]">
              <MurmurMark tile size={140} theme="dark" />
            </span>
          </div>
          <p className="max-w-[420px] text-center text-footnote text-ink-3">
            Two buddies lean together and spell a lowercase m. A murmur is a quiet conversation; a murmuration is many voices moving as one.
          </p>
        </Card>
        <div className="grid gap-4">
          <Card className="flex items-center justify-center gap-8 px-6 py-8" >
            <MurmurWordmark size={48} />
          </Card>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-center rounded-2xl px-4 py-7" style={{ background: BRAND.cream, color: BRAND.ink }}>
              <MurmurWordmark size={26} />
            </div>
            <div className="flex items-center justify-center rounded-2xl px-4 py-7" style={{ background: BRAND.night, color: '#F5F1FA' }}>
              <MurmurWordmark size={26} />
            </div>
            <div className="flex items-center justify-center gap-4 rounded-2xl bg-fill-1 px-4 py-6 text-ink">
              <MurmurMark size={30} variant="mono" />
              <MurmurMark size={20} variant="mono" />
              <MurmurMark size={14} variant="mono" />
            </div>
            <div className="flex items-center justify-center gap-4 rounded-2xl px-4 py-6" style={{ background: BRAND.violet, color: '#fff' }}>
              <MurmurMark size={30} variant="mono" />
              <span className="text-[28px] font-semibold tracking-[-0.042em]">murmur</span>
            </div>
          </div>
        </div>
      </div>

      {/* Home screens */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="flex flex-wrap items-end justify-center gap-6 rounded-2xl px-6 py-8" style={{ background: 'linear-gradient(160deg,#dfe7f5,#f3e6ee)' }}>
          {[120, 76, 60, 40, 29].map((s) => (
            <HomeTile key={s} size={s} />
          ))}
        </div>
        <div className="flex flex-wrap items-end justify-center gap-6 rounded-2xl px-6 py-8" style={{ background: 'linear-gradient(160deg,#141420,#22161f)' }}>
          {[120, 76, 60, 40, 29].map((s) => (
            <HomeTile key={s} size={s} dark />
          ))}
        </div>
      </div>

      {/* Favicon + endorsement */}
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {(['light', 'dark'] as const).map((t) => (
          <div
            key={t}
            className="rounded-2xl p-4"
            style={{ background: t === 'light' ? '#dee1e6' : '#202124' }}
          >
            <div
              className="flex h-9 w-[220px] items-center gap-2 rounded-t-lg px-3 text-[12px]"
              style={{ background: t === 'light' ? '#fff' : '#35363a', color: t === 'light' ? '#1f1f1f' : '#e8eaed' }}
            >
              <MurmurMark variant="glyph" size={16} label="" />
              Murmur
            </div>
            <div className="mt-4 flex items-end gap-4">
              <MurmurMark variant="glyph" size={16} />
              <MurmurMark variant="glyph" size={32} />
              <MurmurMark variant="glyph" size={48} />
              <span className={cn('ml-auto text-caption', t === 'light' ? 'text-black/50' : 'text-white/50')}>favicon 16 · 32 · 48</span>
            </div>
          </div>
        ))}
        <Card className="flex flex-col items-center justify-center gap-3 py-6">
          <ByUmbrel />
          <ByUmbrel mark />
          <span className="text-caption text-ink-3">Endorsement · ByUmbrel</span>
        </Card>
      </div>

      {/* Colour */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {SWATCHES.map((c) => (
          <Card key={c.name} className="overflow-hidden">
            <div className="h-20" style={{ background: c.hex, boxShadow: 'inset 0 -0.5px 0 var(--line)' }} />
            <div className="px-3.5 py-3">
              <p className="text-subhead font-semibold">{c.name}</p>
              <p className="font-mono text-caption text-ink-2">{c.hex}</p>
              <p className="font-mono text-[11px] text-ink-3">{c.oklch}</p>
              <p className="mt-1 text-caption text-ink-3">{c.role}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Clear space & minimums */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="flex items-center justify-center py-10">
          <span className="relative p-[22px] outline-1 outline-dashed outline-[color:var(--line-strong)]">
            <span className="absolute inset-[22px] outline-1 outline-[color:var(--accent-soft)]" />
            <MurmurMark size={88} />
            <span className="absolute -top-px left-1/2 h-[22px] w-px -translate-x-1/2 bg-[color:var(--accent)]" />
            <span className="absolute top-0 left-1/2 ml-1.5 font-mono text-[10px] text-accent">¼h</span>
          </span>
        </Card>
        <Card className="flex flex-col justify-center gap-2 px-6 py-6 text-footnote text-ink-2">
          <p><b className="text-ink">Clear space:</b> a quarter of the mark’s height on every side (about the height of a foot gap).</p>
          <p><b className="text-ink">Minimum sizes:</b> colour mark 24px tall; app tile 29px; below 24px use the glyph; the glyph bottoms out at 16px.</p>
          <p><b className="text-ink">Never:</b> recolour one buddy, separate them, add a third, outline, rotate, or put the colour mark on a busy photo.</p>
        </Card>
      </div>
    </Section>
  )
}

/** Bare render modes used by the screenshot/export scripts. */
function Bare() {
  const q = new URLSearchParams(location.search)
  const px = Number(q.get('px') ?? 1024)
  if (q.has('icon')) {
    return <MurmurMark tile still size={px} safe={q.has('safe')} theme={q.get('icon') === 'dark' ? 'dark' : 'light'} />
  }
  if (q.has('glyph')) return <MurmurMark variant="glyph" size={px} />
  if (q.has('mono')) return <MurmurMark variant="mono" size={px} />
  if (q.has('sixty')) {
    const only = q.get('sixty') as BuddyState | ''
    const mix = ['idle', 'working', 'thinking', 'speaking', 'waiting', 'listening'] as const
    return (
      <div className="grid grid-cols-10 gap-3 p-5">
        {Array.from({ length: 60 }, (_, i) => (
          <Buddy key={i} hue={HUES[i % HUES.length]} size={44} seed={'s' + i} state={only || mix[i % 6]} />
        ))}
      </div>
    )
  }
  return <Strip />
}

function Strip() {
  const q = new URLSearchParams(location.search)
  const strip = q.get('strip') as BuddyState
  const [state, setState] = useState<BuddyState>((q.get('from') as BuddyState) || strip)
  useEffect(() => {
    // The frame-capture script dispatches `strip` to switch at a known time.
    const on = (e: Event) => setState((e as CustomEvent<BuddyState>).detail)
    addEventListener('strip', on)
    return () => removeEventListener('strip', on)
  }, [])
  return (
    <div className="flex items-end gap-6 p-6" id="strip">
      {[160, 96, 52, 28, 20].map((s, i) => (
        <Buddy key={s} hue={[278, 28, 192, 160, 338][i]} seed={['atlas', 'juniper', 'wren', 'sage', 'milo'][i]} size={s} state={state} />
      ))}
      <BuddyStack hues={[278, 28]} seeds={['atlas', 'juniper']} size={96} states={[state, state]} />
    </div>
  )
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => (new URLSearchParams(location.search).get('theme') as Theme) || 'system')
  const [reduce, setReduce] = useState(() => new URLSearchParams(location.search).has('still'))
  const [state, setState] = useState<BuddyState>(() => (new URLSearchParams(location.search).get('state') as BuddyState) || 'idle')
  const [cycle, setCycle] = useState(() => !new URLSearchParams(location.search).has('state'))
  const [hue, setHue] = useState(278)
  const [seed, setSeed] = useState('atlas')
  const [follow, setFollow] = useState(false)
  const [stress, setStress] = useState(() => new URLSearchParams(location.search).has('stress'))
  const fps = useFps(stress)
  const seeds = useRef(0)

  useEffect(() => {
    const el = document.documentElement
    if (theme === 'system') delete el.dataset.theme
    else el.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const el = document.documentElement
    if (reduce) el.dataset.motion = 'reduce'
    else delete el.dataset.motion
  }, [reduce])
  useEffect(() => {
    if (!cycle) return
    const id = setInterval(() => {
      setState((s) => STATES[(STATES.findIndex((x) => x.value === s) + 1) % STATES.length].value)
    }, 3200)
    return () => clearInterval(id)
  }, [cycle])

  const current = STATES.find((s) => s.value === state)!
  const name = seed === 'atlas' ? 'Atlas' : seed.replace(/^\w/, (c) => c.toUpperCase())

  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-24 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BuddyStack hues={[278, 28]} seeds={['atlas', 'juniper']} size={40} />
          <div>
            <h1 className="text-title leading-6 font-semibold tracking-[-0.02em]">Buddy</h1>
            <p className="text-footnote text-ink-3">Murmur’s agent character · design review</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Segmented
            label="Appearance"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            className="w-[240px]"
          />
          <label className="flex items-center gap-2.5 text-footnote font-medium text-ink-2">
            Reduce motion
            <Toggle checked={reduce} onChange={setReduce} label="Reduce motion" />
          </label>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background: `radial-gradient(60% 55% at 50% 40%, oklch(0.75 0.1 ${hue} / 0.16), transparent 70%)`,
            }}
          />
          <div className="relative flex flex-col items-center px-6 pt-14 pb-8">
            <Buddy hue={hue} size={160} seed={seed} state={state} label={`${name}, ${current.label}`} />
            <p className="mt-6 text-title font-semibold tracking-[-0.02em]">{name}</p>
            <p className="mt-0.5 h-5 text-subhead text-ink-3">
              {current.label} · {current.hint}
            </p>
          </div>
          <div className="relative flex flex-col gap-4 border-t border-line px-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              {STATES.map((s) => (
                <Chip
                  key={s.value}
                  active={s.value === state}
                  onClick={() => {
                    setCycle(false)
                    setState(s.value)
                  }}
                >
                  {s.label}
                </Chip>
              ))}
              <button
                type="button"
                onClick={() => setCycle((c) => !c)}
                className="pressable ml-auto flex h-8 items-center gap-1.5 rounded-full px-3 text-footnote font-medium text-accent"
              >
                {cycle ? <Pause size={14} /> : <Play size={14} />}
                {cycle ? 'Auto-cycling' : 'Auto-cycle'}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Hue">
                {HUES.map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-label={`Hue ${h}`}
                    aria-checked={h === hue}
                    role="radio"
                    onClick={() => setHue(h)}
                    className={cn(
                      'pressable size-7 rounded-full transition-shadow duration-150',
                      h === hue && 'shadow-[0_0_0_2px_var(--bg-elevated),0_0_0_4px_var(--ink)]',
                    )}
                    style={{ background: `oklch(0.7 0.16 ${h})` }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  seeds.current++
                  setSeed(Math.random().toString(36).slice(2, 7))
                }}
                className="pressable ml-auto flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-footnote font-medium"
              >
                <Dices size={15} />
                New seed <span className="font-mono text-ink-3">{seed}</span>
              </button>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col">
          <p className="px-5 pt-5 text-caption font-semibold tracking-[0.08em] text-ink-3 uppercase">Before · the Orb</p>
          <div className="flex flex-1 items-center justify-center py-10">
            <Orb hue={hue} size={160} seed={seed} state={state} />
          </div>
          <div className="grid grid-cols-2 border-t border-line">
            <div className="flex flex-col items-center gap-2 py-5">
              <Orb hue={hue} size={52} seed={seed} state={state} />
              <span className="text-caption text-ink-3">Orb 52</span>
            </div>
            <div className="flex flex-col items-center gap-2 border-l border-line py-5">
              <Buddy hue={hue} size={52} seed={seed} state={state} />
              <span className="text-caption text-ink-3">Buddy 52</span>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Family ─────────────────────────────────────────────────────── */}
      <Section kicker="One family" title="Every agent, their own little self">
        <div className="mb-4 flex items-center gap-3 text-footnote text-ink-2">
          <Toggle checked={follow} onChange={setFollow} label="Match the hero's state" />
          Match the hero’s state
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {AGENTS.map((a) => (
            <Card key={a.seed} className="flex flex-col items-center gap-3 py-6">
              <Buddy hue={a.hue} size={52} seed={a.seed} state={follow ? state : 'idle'} label={a.name} />
              <span className="text-subhead font-semibold">{a.name}</span>
            </Card>
          ))}
        </div>
      </Section>

      <Brand />

      {/* ── Sizes ──────────────────────────────────────────────────────── */}
      <Section kicker="Every state, every size" title="Reads without motion, down to 20px">
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <th className="w-16" />
                {STATES.map((s) => (
                  <th key={s.value} className="px-2 pt-5 pb-2 text-caption font-medium text-ink-3">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[96, 52, 40, 28, 20].map((size, r) => (
                <tr key={size} className={cn(r > 0 && 'border-t border-line')}>
                  <td className="pl-5 font-mono text-caption text-ink-3">{size}</td>
                  {STATES.map((s, i) => (
                    <td key={s.value} className="px-2 py-4">
                      <span className="flex justify-center">
                        <Buddy hue={AGENTS[i % AGENTS.length].hue} size={size} seed={AGENTS[i % AGENTS.length].seed} state={s.value} />
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      {/* ── The m ──────────────────────────────────────────────────────── */}
      <Section kicker="Groups" title="Two buddies make the m">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="flex flex-col items-center justify-center gap-4 py-12" >
            <BuddyStack hues={[278, 28]} seeds={['atlas', 'juniper']} size={240} />
            <span className="text-footnote text-ink-3">BuddyStack · 2</span>
          </Card>
          <Card className="flex flex-col items-center justify-center gap-4 py-12">
            <BuddyStack hues={[160, 250, 338]} seeds={['sage', 'nova', 'milo']} size={240} />
            <span className="text-footnote text-ink-3">BuddyStack · 3</span>
          </Card>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-6 rounded-2xl bg-fill-1 px-6 py-5">
          {[64, 52, 40, 28].map((s) => (
            <BuddyStack key={s} hues={[278, 28]} seeds={['atlas', 'juniper']} size={s} />
          ))}
          {[64, 52, 40, 28].map((s) => (
            <BuddyStack key={'3' + s} hues={[192, 82, 338]} seeds={['wren', 'pip', 'milo']} size={s} />
          ))}
        </div>
      </Section>

      {/* ── In context ─────────────────────────────────────────────────── */}
      <Section kicker="In context" title="In the app">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <Phone label="Roster · 52px">
            <Roster />
          </Phone>
          <Phone label="Chat header · 34px, inline 20px">
            <ChatMock state={state} />
          </Phone>
          <Phone label="Group headers">
            <GroupMock />
          </Phone>
          <Phone label="Empty state · 112px">
            <EmptyMock state={state} />
          </Phone>
        </div>
      </Section>

      {/* ── Perf ───────────────────────────────────────────────────────── */}
      <Section kicker="Performance" title="Sixty at once">
        <div className="mb-4 flex items-center gap-3 text-footnote text-ink-2">
          <Toggle checked={stress} onChange={setStress} label="Show sixty buddies" />
          Show 60 animating buddies
          {stress && <span className="ml-2 rounded-full bg-fill-2 px-2.5 py-1 font-mono text-caption" data-fps={fps}>{fps} fps</span>}
        </div>
        {stress && (
          <Card className="grid grid-cols-6 gap-3 p-5 sm:grid-cols-10">
            {Array.from({ length: 60 }, (_, i) => (
              <span key={i} className="flex justify-center">
                <Buddy
                  hue={HUES[i % HUES.length]}
                  size={44}
                  seed={'s' + i}
                  state={(['idle', 'working', 'thinking', 'speaking', 'waiting', 'listening'] as const)[i % 6]}
                />
              </span>
            ))}
          </Card>
        )}
      </Section>

      <footer className="mt-24 flex flex-col items-center gap-3 border-t border-line pt-10">
        <MurmurWordmark size={22} />
        <ByUmbrel />
      </footer>
    </div>
  )
}

const bare = /[?&](icon|glyph|mono|strip|sixty)=/.test(location.search)
if (bare) document.documentElement.style.background = 'transparent'
createRoot(document.getElementById('root')!).render(<StrictMode>{bare ? <Bare /> : <App />}</StrictMode>)
